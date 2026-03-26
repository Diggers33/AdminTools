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

async function getApprovalDate(id: string, type: 'expense' | 'purchase', auth: Record<string, string>): Promise<string | null> {
  try {
    const endpoint = type === 'expense'
      ? `${API}/queries/expense-stream/${id}`
      : `${API}/queries/purchase-stream/${id}`
    const res = await fetch(endpoint, { headers: auth })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await safeJson(res)
    if (!raw) return null
    const events: unknown[] = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? raw?.events ?? [])
    // Find last status-approved/accepted event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approvedEvents = (events as any[]).filter((e: any) => {
      const t = (e?.type ?? e?.eventType ?? e?.action ?? '').toString().toLowerCase()
      const s = (e?.status ?? e?.state ?? '').toString().toLowerCase()
      return t.includes('approv') || t.includes('accept') || s === 'approved' || s === 'accepted'
    })
    if (approvedEvents.length === 0) {
      // Fallback: look for approvedAt / acceptedAt fields on any event
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const ev of events as any[]) {
        if (ev?.approvedAt) return ev.approvedAt
        if (ev?.acceptedAt) return ev.acceptedAt
        if (ev?.approvedDate) return ev.approvedDate
      }
      return null
    }
    const last = approvedEvents[approvedEvents.length - 1]
    return last?.date ?? last?.createdAt ?? last?.timestamp ?? null
  } catch {
    return null
  }
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
    fetch(`${API}/queries/expenses?start=${start}&end=${end}`, { headers: auth }),
    fetch(`${API}/queries/purchases?start=${start}&end=${end}`, { headers: auth }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expRaw: any = expRes.ok ? await safeJson(expRes) : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const purRaw: any = purRes.ok ? await safeJson(purRes) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expenses: any[] = expRaw ? (Array.isArray(expRaw) ? expRaw : (expRaw?.result ?? expRaw?.data ?? [])) : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const purchases: any[] = purRaw ? (Array.isArray(purRaw) ? purRaw : (purRaw?.result ?? purRaw?.data ?? [])) : []

  // Filter to approved/accepted items only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isApproved = (item: any) => {
    const s = (item?.status ?? item?.state ?? '').toString().toLowerCase()
    return s === 'approved' || s === 'accepted' || s === 'approved_by_manager' || s === 'approved_by_finance'
  }

  const approvedExpenses = expenses.filter(isApproved)
  const approvedPurchases = purchases.filter(isApproved)

  // Batch-fetch audit streams (10 at a time) to get exact approval dates
  const rows: ApprovalRow[] = []

  const fetchBatch = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: any[],
    type: 'expense' | 'purchase'
  ) => {
    for (let i = 0; i < items.length; i += 10) {
      const batch = items.slice(i, i + 10)
      const results = await Promise.all(batch.map(async item => {
        const approvedDate = await getApprovalDate(item.id, type, auth)
        return { item, approvedDate }
      }))
      for (const { item, approvedDate } of results) {
        const submitter = item.createdBy ?? item.submittedBy ?? item.user ?? {}
        const submittedBy = typeof submitter === 'string'
          ? submitter
          : `${submitter?.firstName ?? ''} ${submitter?.lastName ?? ''}`.trim() || 'Unknown'
        // Use audit stream date if available, otherwise fall back to item's own approved/updated date
        const resolvedApprovedDate = approvedDate
          ?? item.approvedAt ?? item.acceptedAt ?? item.updatedAt ?? item.updatedStatusApproved ?? ''
        rows.push({
          id: item.id,
          type,
          title: item.title ?? item.description ?? item.name ?? `${type} ${item.id}`,
          amount: Number(item.amount ?? item.total ?? item.totalAmount ?? 0),
          currency: item.currency ?? item.currencyCode ?? 'EUR',
          submittedBy,
          submittedDate: item.createdAt ?? item.submittedAt ?? item.date ?? '',
          approvedDate: resolvedApprovedDate,
        })
      }
    }
  }

  await Promise.all([
    fetchBatch(approvedExpenses, 'expense'),
    fetchBatch(approvedPurchases, 'purchase'),
  ])

  // Sort by approval date ascending
  rows.sort((a, b) => {
    if (!a.approvedDate) return 1
    if (!b.approvedDate) return -1
    return a.approvedDate.localeCompare(b.approvedDate)
  })

  return NextResponse.json({
    rows,
    total: rows.length,
    _debug: {
      expensesFound: expenses.length,
      purchasesFound: purchases.length,
      approvedExpenses: approvedExpenses.length,
      approvedPurchases: approvedPurchases.length,
      expEndpointStatus: expRes.status,
      purEndpointStatus: purRes.status,
    }
  })
}
