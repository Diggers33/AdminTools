import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export interface ApprovalRow {
  id: string
  type: 'expense' | 'purchase'
  requestNumber: string
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


export async function POST(req: NextRequest) {
  const token = req.cookies.get('wd_token')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { year, month } = await req.json() as { year: number; month: number }
  if (!year || !month) return NextResponse.json({ error: 'year and month required' }, { status: 400 })

  const auth = { Authorization: `Bearer ${token}` }

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

  // Process expenses (amount not available from API)
  for (let i = 0; i < approvedExpenses.length; i += 10) {
    const batch = approvedExpenses.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => ({
      item,
      approvedDate: await getApprovalDate(item.id, 'expense', auth),
    })))
    for (const { item, approvedDate } of results) {
      rows.push({
        id: item.id,
        type: 'expense',
        requestNumber: item.expenseNumber ?? item.id,
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
      rows.push({
        id: item.id,
        type: 'purchase',
        requestNumber: item.purchaseNumber ?? item.id,
        approvedDate,
      })
    }
  }

  rows.sort((a, b) => {
    if (!a.approvedDate) return 1
    if (!b.approvedDate) return -1
    return a.approvedDate.localeCompare(b.approvedDate)
  })

  return NextResponse.json({ rows, total: rows.length })
}
