'use client'

import { useState } from 'react'
import type { ApprovalRow } from '@/app/api/workdeck/approvals/route'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatAmount(amount: number | null, currency: string) {
  if (amount === null) return '—'
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export default function ApprovalsSection() {
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'expense' | 'purchase'>('all')
  const [sortKey, setSortKey] = useState<'approvedDate' | 'submittedBy' | 'amount' | 'type'>('approvedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const years = Array.from({ length: 4 }, (_, i) => currentYear - i)

  const handleFetch = async () => {
    setLoading(true)
    setError(null)
    setRows(null)
    try {
      const res = await fetch('/api/workdeck/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error(`Server error: ${text.slice(0, 120)}`) }
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`)
      setRows(data.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch approvals')
    } finally {
      setLoading(false)
    }
  }

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const displayed = rows
    ? [...rows]
        .filter(r => filter === 'all' || r.type === filter)
        .sort((a, b) => {
          let cmp = 0
          if (sortKey === 'approvedDate') cmp = (a.approvedDate ?? '').localeCompare(b.approvedDate ?? '')
          else if (sortKey === 'submittedBy') cmp = a.submittedBy.localeCompare(b.submittedBy)
          else if (sortKey === 'amount') cmp = (a.amount ?? 0) - (b.amount ?? 0)
          else if (sortKey === 'type') cmp = a.type.localeCompare(b.type)
          return sortDir === 'asc' ? cmp : -cmp
        })
    : null

  const totalAmount = displayed?.reduce((s, r) => s + (r.amount ?? 0), 0) ?? 0

  const SortIcon = ({ col }: { col: typeof sortKey }) =>
    sortKey === col
      ? <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
      : <span style={{ marginLeft: 4, fontSize: 9, color: '#3a5a8a' }}>⇅</span>

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '44px 24px' }}>
      {/* Controls */}
      <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 10, padding: '24px', marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#1a4a8a', marginBottom: 16 }}>Select Period</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Year selector */}
          <div style={{ display: 'flex', gap: 6 }}>
            {years.map(y => (
              <button key={y} onClick={() => setYear(y)} style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid',
                borderColor: year === y ? '#0066cc' : '#c8d8ed',
                background: year === y ? '#0066cc' : 'transparent',
                color: year === y ? '#fff' : '#5a7a9a',
                cursor: 'pointer', fontSize: 13, fontFamily: 'Georgia, serif',
                transition: 'all 0.15s'
              }}>{y}</button>
            ))}
          </div>

          <div style={{ width: 1, height: 28, background: '#c8d8ed' }} />

          {/* Month selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MONTH_NAMES.map((name, i) => {
              const mo = i + 1
              const isFuture = year === currentYear && mo > currentMonth
              return (
                <button key={mo} onClick={() => !isFuture && setMonth(mo)} disabled={isFuture} style={{
                  padding: '5px 10px', borderRadius: 16, border: '1px solid',
                  borderColor: month === mo ? '#0066cc' : '#c8d8ed',
                  background: month === mo ? '#0066cc' : isFuture ? '#f4f7fc' : 'transparent',
                  color: month === mo ? '#fff' : isFuture ? '#c8d8ed' : '#5a7a9a',
                  cursor: isFuture ? 'not-allowed' : 'pointer', fontSize: 11, fontFamily: 'Georgia, serif',
                  transition: 'all 0.15s'
                }}>{name.slice(0, 3)}</button>
              )
            })}
          </div>

          <button onClick={handleFetch} disabled={loading} style={{
            marginLeft: 'auto', padding: '9px 22px', borderRadius: 6, border: '1px solid',
            borderColor: loading ? '#c8d8ed' : '#0066cc',
            background: loading ? '#f0f4fa' : '#0066cc',
            color: loading ? '#8aaac8' : '#ffffff',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13, fontFamily: 'Georgia, serif', transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}>
            {loading && (
              <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            )}
            {loading ? 'Loading…' : 'Fetch Approvals'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff5f0', border: '1px solid #f0c8b8', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#ff7070', fontSize: 14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Results */}
      {displayed !== null && (
        <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 10, overflow: 'hidden' }}>
          {/* Table header bar */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #c8d8ed', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#1a4a8a' }}>
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <span style={{ fontSize: 12, color: '#5a7a9a' }}>
              {displayed.length} approval{displayed.length !== 1 ? 's' : ''}
              {displayed.length > 0 && ` · ${formatAmount(totalAmount, displayed[0]?.currency ?? 'EUR')} total`}
            </span>

            {/* Filter tabs */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['all', 'expense', 'purchase'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '4px 12px', borderRadius: 12, border: '1px solid',
                  borderColor: filter === f ? '#0066cc' : '#c8d8ed',
                  background: filter === f ? '#eaf0fa' : 'transparent',
                  color: filter === f ? '#0066cc' : '#5a7a9a',
                  cursor: 'pointer', fontSize: 11, fontFamily: 'Georgia, serif',
                  textTransform: 'capitalize'
                }}>{f}</button>
              ))}
            </div>
          </div>

          {displayed.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#5a7a9a', fontSize: 13 }}>
              No approved {filter === 'all' ? 'expenses or purchases' : filter + 's'} found for this period
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #c8d8ed' }}>
                    {[
                      { key: 'type' as const, label: 'Type', align: 'left' },
                      { key: null, label: 'Title', align: 'left' },
                      { key: 'submittedBy' as const, label: 'Submitted By', align: 'left' },
                      { key: null, label: 'Submitted', align: 'right' },
                      { key: 'amount' as const, label: 'Amount', align: 'right' },
                      { key: 'approvedDate' as const, label: 'Approved', align: 'right' },
                    ].map(({ key, label, align }) => (
                      <th key={label}
                        onClick={() => key && handleSort(key)}
                        style={{
                          padding: '10px 16px', fontWeight: 400, textAlign: align as 'left' | 'right',
                          fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5a7a9a',
                          cursor: key ? 'pointer' : 'default',
                          userSelect: 'none',
                          background: '#f8fafd',
                        }}>
                        {label}{key && <SortIcon col={key} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((row, i) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #e8eef8', background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10,
                          letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'monospace',
                          background: row.type === 'expense' ? '#eaf4ff' : '#f0f8ee',
                          color: row.type === 'expense' ? '#0055aa' : '#1a7a3a',
                          border: `1px solid ${row.type === 'expense' ? '#b0d0f0' : '#a0d4b0'}`,
                        }}>
                          {row.type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', color: '#1a2a3a', maxWidth: 280 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>
                          {row.title}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', color: '#3a5a8a' }}>{row.submittedBy}</td>
                      <td style={{ padding: '10px 16px', color: '#5a7a9a', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                        {formatDate(row.submittedDate)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#1a2a3a', fontSize: 12 }}>
                        {formatAmount(row.amount, row.currency)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#1da35a', fontSize: 12, fontWeight: 600 }}>
                        {formatDate(row.approvedDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {displayed.length > 1 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #c8d8ed', background: '#f4f8fd' }}>
                      <td colSpan={4} style={{ padding: '10px 16px', fontSize: 11, color: '#5a7a9a', letterSpacing: 1, textTransform: 'uppercase' }}>Total</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#1a2a3a', fontWeight: 600 }}>
                        {formatAmount(totalAmount, displayed[0]?.currency ?? 'EUR')}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
