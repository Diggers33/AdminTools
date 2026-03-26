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

// Parse Workdeck date "DD/MM/YYYY HH:mm:ss+TZ" or ISO
function parseWdDate(s: string): Date | null {
  if (!s) return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
  return new Date(s)
}

function inMonth(dateStr: string, year: number, month: number): boolean {
  const d = parseWdDate(dateStr)
  if (!d || isNaN(d.getTime())) return false
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
}

async function getApprovalDate(id: string, type: 'expense' | 'purchase', auth: Record<string, string>): Promise<string> {
  try {
    const endpoint = type === 'expense'
      ? `${API}/queries/expense-stream/${id}`
      : `${API}/queries/purchase-stream/${id}`
    const res = await fetch(endpoint, { headers: auth })
    if (!res.ok) return ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await safeJson(res)
    if (!raw) return ''
    const result = raw?.result ?? raw
    for (const key of ['updatedStatusApproved', 'updatedStatusAutoApproved', 'updatedStatusProcessed']) {
      const arr = result?.[key]
      if (Array.isArray(arr) && arr.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const last: any = arr[arr.length - 1]
        const date = last?.date ?? last?.createdAt ?? last?.timestamp
        if (date) return date
      }
    }
    return ''
  } catch {
    return ''
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExpenseDetail(id: string, auth: Record<string, string>): Promise<{ amount: number; _probe?: any }> {
  const getUrls = [
    `${API}/queries/expenses/${id}`,
    `${API}/queries/expense/${id}`,
    `${API}/queries/expense-lines/${id}`,
    `${API}/queries/expense-line/${id}`,
    `${API}/queries/expense-lines?expenseId=${id}`,
    `${API}/queries/expense-lines?expense=${id}`,
    `${API}/queries/expenses/detail/${id}`,
  ]
  for (const url of getUrls) {
    try {
      const res = await fetch(url, { headers: auth })
      if (!res.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await safeJson(res)
      if (!raw) continue
      if (raw?.total !== undefined) return { amount: Number(raw.total) }
      if (raw?.result?.total !== undefined) return { amount: Number(raw.result.total) }
      const items = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? raw?.lines ?? raw?.expenseLines ?? [])
      if (Array.isArray(items) && items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const total = items.reduce((s: number, l: any) => s + Number(l?.amount ?? l?.total ?? l?.subtotal ?? 0), 0)
        return { amount: total, _probe: { url, sample: items[0] } }
      }
      return { amount: 0, _probe: { url, raw } }
    } catch { continue }
  }
  // Last resort: check stream for amount in finalized/processed events
  try {
    const res = await fetch(`${API}/queries/expense-stream/${id}`, { headers: auth })
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await safeJson(res)
      const result = raw?.result ?? raw
      return { amount: 0, _probe: { streamKeys: Object.keys(result ?? {}), stream: result } }
    }
  } catch { /* ignore */ }
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

  // Try admin/all-user endpoints first, fall back to /me/ if needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchItems(paths: string[]): Promise<{ items: any[] }> {
    for (const path of paths) {
      const res = await fetch(`${API}${path}`, { headers: auth })
      if (!res.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await safeJson(res)
      if (!raw) continue
      const items = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? [])
      if (Array.isArray(items)) return { items }
    }
    return { items: [] }
  }

  const [{ items: expenses }, { items: purchases }] = await Promise.all([
    fetchItems(['/queries/expenses', '/queries/me/expenses']),
    fetchItems(['/queries/purchases', '/queries/me/purchases']),
  ])

  // Workdeck numeric status: 6 = approved, 3 = approved by manager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isApproved = (item: any) => {
    const s = item?.status ?? item?.state
    if (typeof s === 'number') return s === 6 || s === 3
    const str = String(s ?? '').toLowerCase()
    return str === 'approved' || str === 'accepted' || str === 'approved_by_manager'
  }

  // Filter by approved status AND submitted in the selected month
  const approvedExpenses = expenses.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => isApproved(e) && inMonth(e.createdAt ?? '', year, month)
  )
  const approvedPurchases = purchases.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => isApproved(p) && inMonth(p.createdAt ?? '', year, month)
  )

  const rows: ApprovalRow[] = []
  let amountProbe: unknown = undefined

  // Process expenses
  for (let i = 0; i < approvedExpenses.length; i += 10) {
    const batch = approvedExpenses.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => ({
      item,
      approvedDate: await getApprovalDate(item.id, 'expense', auth),
      expenseDetail: await getExpenseDetail(item.id, auth),
    })))
    for (const { item, approvedDate, expenseDetail } of results) {
      if (!amountProbe && expenseDetail._probe) amountProbe = expenseDetail._probe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creator = item.creator ?? {}
      const submittedBy = typeof creator === 'string'
        ? creator
        : `${creator?.firstName ?? ''} ${creator?.lastName ?? ''}`.trim() || 'Unknown'
      rows.push({
        id: item.id,
        type: 'expense',
        title: item.purpose ?? item.title ?? item.name ?? item.expenseNumber ?? item.id,
        amount: expenseDetail.amount,
        currency: item.currency ?? item.currencyCode ?? 'EUR',
        submittedBy,
        submittedDate: item.createdAt ?? '',
        approvedDate,
      })
    }
  }

  // Process purchases
  for (let i = 0; i < approvedPurchases.length; i += 10) {
    const batch = approvedPurchases.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => ({
      item,
      approvedDate: await getApprovalDate(item.id, 'purchase', auth),
    })))
    for (const { item, approvedDate } of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creator = item.creator ?? {}
      const submittedBy = typeof creator === 'string'
        ? creator
        : `${creator?.firstName ?? ''} ${creator?.lastName ?? ''}`.trim() || 'Unknown'
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
        approvedDate,
      })
    }
  }

  rows.sort((a, b) => {
    if (!a.submittedDate) return 1
    if (!b.submittedDate) return -1
    return a.submittedDate.localeCompare(b.submittedDate)
  })

  return NextResponse.json({ rows, total: rows.length, _debug: amountProbe ?? undefined })
}
