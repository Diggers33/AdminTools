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

// Parse Workdeck date format: "DD/MM/YYYY HH:mm:ss+TZ" or ISO
function parseWdDate(s: string): Date | null {
  if (!s) return null
  // DD/MM/YYYY HH:mm:ss+TZ
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
  return new Date(s)
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
    const result = raw?.result ?? raw
    // Try approved → auto-approved → processed in that order
    const candidates = [
      result?.updatedStatusApproved,
      result?.updatedStatusAutoApproved,
      result?.updatedStatusProcessed,
    ]
    for (const arr of candidates) {
      if (Array.isArray(arr) && arr.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const last: any = arr[arr.length - 1]
        const date = last?.date ?? last?.createdAt ?? last?.timestamp
        if (date) return date
      }
    }
    return null
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExpenseAmount(id: string, auth: Record<string, string>): Promise<{ amount: number; _probe?: any }> {
  // Probe multiple possible endpoints for expense line totals
  const candidates = [
    `${API}/queries/expense-lines/${id}`,
    `${API}/queries/me/expense-lines/${id}`,
    `${API}/queries/expense-lines?expenseId=${id}`,
    `${API}/queries/expenses/${id}`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: auth })
      if (!res.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await safeJson(res)
      if (!raw) continue
      const items = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? raw?.lines ?? raw?.expenseLines ?? [])
      if (Array.isArray(items) && items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const total = items.reduce((s: number, l: any) => s + Number(l?.amount ?? l?.total ?? l?.subtotal ?? 0), 0)
        return { amount: total }
      }
      // Maybe it returned a single object with total
      if (raw?.total !== undefined) return { amount: Number(raw.total) }
      if (raw?.result?.total !== undefined) return { amount: Number(raw.result.total) }
      // Return probe for first working endpoint so we can inspect it
      return { amount: 0, _probe: { url, raw } }
    } catch { continue }
  }
  return { amount: 0 }
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

  // Workdeck uses numeric status: 6 = approved, 3 = approved by manager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isApproved = (item: any) => {
    const s = item?.status ?? item?.state
    if (typeof s === 'number') return s === 6 || s === 3
    const str = String(s ?? '').toLowerCase()
    return str === 'approved' || str === 'accepted' || str === 'approved_by_manager'
  }

  const approvedExpenses = expenses.filter(isApproved)
  const approvedPurchases = purchases.filter(isApproved)

  const rows: ApprovalRow[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let expenseAmountProbe: any = null

  // Process expenses
  for (let i = 0; i < approvedExpenses.length; i += 10) {
    const batch = approvedExpenses.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => {
      const [approvedDate, amountResult] = await Promise.all([
        getApprovalDate(item.id, 'expense', auth),
        getExpenseAmount(item.id, auth),
      ])
      return { item, approvedDate, amountResult }
    }))
    for (const { item, approvedDate, amountResult } of results) {
      if (amountResult._probe && !expenseAmountProbe) expenseAmountProbe = amountResult._probe
      // Filter by approval date falling in the selected month/year
      if (approvedDate) {
        const d = parseWdDate(approvedDate)
        if (d && (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month)) continue
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creator = item.creator ?? {}
      const submittedBy = typeof creator === 'string'
        ? creator
        : `${creator?.firstName ?? ''} ${creator?.lastName ?? ''}`.trim() || 'Unknown'
      rows.push({
        id: item.id,
        type: 'expense',
        title: item.purpose ?? item.title ?? item.name ?? item.expenseNumber ?? item.id,
        amount: amountResult.amount,
        currency: item.currency ?? item.currencyCode ?? 'EUR',
        submittedBy,
        submittedDate: item.createdAt ?? '',
        approvedDate: approvedDate ?? '',
      })
    }
  }

  // Process purchases
  for (let i = 0; i < approvedPurchases.length; i += 10) {
    const batch = approvedPurchases.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => {
      const approvedDate = await getApprovalDate(item.id, 'purchase', auth)
      return { item, approvedDate }
    }))
    for (const { item, approvedDate } of results) {
      // Filter by approval date falling in the selected month/year
      if (approvedDate) {
        const d = parseWdDate(approvedDate)
        if (d && (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month)) continue
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creator = item.creator ?? {}
      const submittedBy = typeof creator === 'string'
        ? creator
        : `${creator?.firstName ?? ''} ${creator?.lastName ?? ''}`.trim() || 'Unknown'
      // Purchase title: use first supplier name, else purchase number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supplierName = Array.isArray(item.suppliers) && item.suppliers.length > 0
        ? item.suppliers.map((s: any) => s.name).join(', ')
        : null
      rows.push({
        id: item.id,
        type: 'purchase',
        title: supplierName ?? item.purpose ?? item.name ?? item.purchaseNumber ?? item.id,
        amount: Number(item.total ?? item.amount ?? item.totalAmount ?? 0),
        currency: item.currency ?? item.currencyCode ?? 'EUR',
        submittedBy,
        submittedDate: item.createdAt ?? '',
        approvedDate: approvedDate ?? '',
      })
    }
  }

  rows.sort((a, b) => {
    if (!a.approvedDate) return 1
    if (!b.approvedDate) return -1
    return a.approvedDate.localeCompare(b.approvedDate)
  })

  return NextResponse.json({
    rows,
    total: rows.length,
    _debug: expenseAmountProbe ? { expenseAmountProbe } : undefined,
  })
}
