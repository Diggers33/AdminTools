import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export interface ApprovalRow {
  id: string
  type: 'expense' | 'purchase'
  title: string
  amount: number
  currency: string
  submittedBy: string
  submittedDate: string
  approvedDate: string
}

async function safeJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wd_token')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { year, month } = await req.json() as { year: number; month: number }
  if (!year || !month) return NextResponse.json({ error: 'year and month required' }, { status: 400 })

  const auth = { Authorization: `Bearer ${token}` }
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch expenses and purchases in parallel
  const [expRes, purRes] = await Promise.all([
    fetch(`${API}/queries/me/expenses?start=${start}&end=${end}`, { headers: auth }),
    fetch(`${API}/queries/me/purchases?start=${start}&end=${end}`, { headers: auth }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expRaw: any = expRes.ok ? await safeJson(expRes) : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const purRaw: any = purRes.ok ? await safeJson(purRes) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expenses: any[] = expRaw ? (Array.isArray(expRaw) ? expRaw : (expRaw?.result ?? expRaw?.data ?? [])) : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const purchases: any[] = purRaw ? (Array.isArray(purRaw) ? purRaw : (purRaw?.result ?? purRaw?.data ?? [])) : []

  // Probe: fetch detail + stream for first expense and first purchase
  const firstExp = expenses[0]
  const firstPur = purchases[0]

  const [expDetailRes, expStreamMeRes, expStreamRootRes, purDetailRes, purStreamMeRes] = await Promise.all([
    firstExp ? fetch(`${API}/queries/me/expenses/${firstExp.id}`, { headers: auth }) : Promise.resolve(null),
    firstExp ? fetch(`${API}/queries/me/expense-stream/${firstExp.id}`, { headers: auth }) : Promise.resolve(null),
    firstExp ? fetch(`${API}/queries/expense-stream/${firstExp.id}`, { headers: auth }) : Promise.resolve(null),
    firstPur ? fetch(`${API}/queries/me/purchases/${firstPur.id}`, { headers: auth }) : Promise.resolve(null),
    firstPur ? fetch(`${API}/queries/me/purchase-stream/${firstPur.id}`, { headers: auth }) : Promise.resolve(null),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe: Record<string, any> = {
    expDetail:       expDetailRes    ? { status: expDetailRes.status,    body: await safeJson(expDetailRes)    } : null,
    expStreamMe:     expStreamMeRes  ? { status: expStreamMeRes.status,  body: await safeJson(expStreamMeRes)  } : null,
    expStreamRoot:   expStreamRootRes? { status: expStreamRootRes.status, body: await safeJson(expStreamRootRes)} : null,
    purDetail:       purDetailRes    ? { status: purDetailRes.status,    body: await safeJson(purDetailRes)    } : null,
    purStreamMe:     purStreamMeRes  ? { status: purStreamMeRes.status,  body: await safeJson(purStreamMeRes)  } : null,
    purchaseSample:  firstPur ?? null,
  }

  return NextResponse.json({ _probe: probe })
}
