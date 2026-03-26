import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('wd_token')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const auth = { Authorization: `Bearer ${token}` }

  const candidates = [
    '/queries/expenses',
    '/queries/purchases',
    '/queries/admin/expenses',
    '/queries/admin/purchases',
    '/queries/expense-admin/expenses',
    '/queries/purchase-admin/purchases',
    '/queries/expense-role/expenses',
    '/queries/purchase-role/purchases',
    '/queries/role/expenses',
    '/queries/role/purchases',
    '/queries/company/expenses',
    '/queries/company/purchases',
    '/queries/finance/expenses',
    '/queries/finance/purchases',
    '/queries/all/expenses',
    '/queries/all/purchases',
    '/queries/expenses/all',
    '/queries/purchases/all',
    '/queries/expense-reports',
    '/queries/purchase-orders',
    '/queries/purchase-requests',
    '/queries/expenses?all=true',
    '/queries/purchases?all=true',
  ]

  const results = await Promise.all(candidates.map(async path => {
    try {
      const res = await fetch(`${API}${path}`, { headers: auth })
      const text = await res.text()
      let count = null
      try {
        const json = JSON.parse(text)
        const items = Array.isArray(json) ? json : (json?.result ?? json?.data ?? [])
        if (Array.isArray(items)) count = items.length
      } catch { /* ignore */ }
      return { path, status: res.status, count, preview: text.slice(0, 80) }
    } catch (e) {
      return { path, status: 0, count: null, preview: String(e) }
    }
  }))

  return NextResponse.json(results.filter(r => r.status !== 404))
}
