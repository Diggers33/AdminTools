import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export interface ApprovalRow {
  id: string
  type: 'expense' | 'purchase'
  requestNumber: string
  projectName: string
  description: string
  submittedBy: string
  approvedBy: string
  approvedDate: string
}

async function safeJson(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fullName(u: any): string {
  if (!u) return ''
  if (typeof u === 'string') return u
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim()
}

async function getApprovalInfo(id: string, type: 'expense' | 'purchase', auth: Record<string, string>): Promise<{ date: string; approvedBy: string }> {
  try {
    const endpoint = type === 'expense'
      ? `${API}/queries/expense-stream/${id}`
      : `${API}/queries/purchase-stream/${id}`
    const res = await fetch(endpoint, { headers: auth })
    if (!res.ok) return { date: '', approvedBy: '' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await safeJson(res)
    if (!raw) return { date: '', approvedBy: '' }
    const result = raw?.result ?? raw
    for (const key of ['updatedStatusApproved', 'updatedStatusAutoApproved', 'updatedStatusProcessed']) {
      const arr = result?.[key]
      if (Array.isArray(arr) && arr.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const last: any = arr[arr.length - 1]
        const date = last?.date ?? last?.createdAt ?? last?.timestamp ?? ''
        const approvedBy = fullName(last?.user)
        if (date) return { date, approvedBy }
      }
    }
    return { date: '', approvedBy: '' }
  } catch {
    return { date: '', approvedBy: '' }
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wd_token')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { year, months } = await req.json() as { year: number; months: number[] }
  if (!year || !months?.length) return NextResponse.json({ error: 'year and months required' }, { status: 400 })
  const monthSet = new Set(months)

  const auth = { Authorization: `Bearer ${token}` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchItems(paths: string[]): Promise<any[]> {
    for (const path of paths) {
      const res = await fetch(`${API}${path}`, { headers: auth })
      if (!res.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await safeJson(res)
      if (!raw) continue
      const items = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? [])
      if (Array.isArray(items)) return items
    }
    return []
  }

  const [expenses, purchases] = await Promise.all([
    fetchItems(['/queries/expenses', '/queries/me/expenses']),
    fetchItems(['/queries/purchases', '/queries/me/purchases']),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isApproved = (item: any) => {
    const s = item?.status ?? item?.state
    if (typeof s === 'number') return s === 6 || s === 3
    const str = String(s ?? '').toLowerCase()
    return str === 'approved' || str === 'accepted' || str === 'approved_by_manager'
  }

  const inPeriod = (dateStr: string) => {
    const d = parseWdDate(dateStr)
    if (!d || isNaN(d.getTime())) return false
    return d.getUTCFullYear() === year && monthSet.has(d.getUTCMonth() + 1)
  }

  const approvedExpenses = expenses.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => isApproved(e) && inPeriod(e.createdAt ?? '')
  )
  const approvedPurchases = purchases.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => isApproved(p) && inPeriod(p.createdAt ?? '')
  )

  const rows: ApprovalRow[] = []

  for (let i = 0; i < approvedExpenses.length; i += 10) {
    const batch = approvedExpenses.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => ({
      item,
      approval: await getApprovalInfo(item.id, 'expense', auth),
    })))
    for (const { item, approval } of results) {
      rows.push({
        id: item.id,
        type: 'expense',
        requestNumber: item.expenseNumber ?? item.id,
        projectName: item.project?.name ?? '',
        description: item.purpose ?? item.title ?? item.name ?? '',
        submittedBy: fullName(item.creator),
        approvedBy: approval.approvedBy,
        approvedDate: approval.date,
      })
    }
  }

  for (let i = 0; i < approvedPurchases.length; i += 10) {
    const batch = approvedPurchases.slice(i, i + 10)
    const results = await Promise.all(batch.map(async item => ({
      item,
      approval: await getApprovalInfo(item.id, 'purchase', auth),
    })))
    for (const { item, approval } of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supplierName = Array.isArray(item.suppliers) && item.suppliers.length > 0
        ? item.suppliers.map((s: any) => s.name).join(', ')
        : ''
      rows.push({
        id: item.id,
        type: 'purchase',
        requestNumber: item.purchaseNumber ?? item.id,
        projectName: item.project?.name ?? '',
        description: supplierName || (item.purpose ?? item.name ?? ''),
        submittedBy: fullName(item.creator),
        approvedBy: approval.approvedBy,
        approvedDate: approval.date,
      })
    }
  }

  rows.sort((a, b) => {
    if (!a.approvedDate) return 1
    if (!b.approvedDate) return -1
    return a.approvedDate.localeCompare(b.approvedDate)
  })

  return NextResponse.json({
    rows, total: rows.length,
    _debug: {
      purchaseCount: purchases.length,
      purchaseSample: purchases.slice(0, 3).map((p: any) => ({
        id: p.id, status: p.status, state: p.state,
        createdAt: p.createdAt, date: p.date, submittedAt: p.submittedAt, updatedAt: p.updatedAt,
        purchaseNumber: p.purchaseNumber,
      })),
      approvedPurchaseCount: approvedPurchases.length,
    }
  })
}
