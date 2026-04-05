'use client'

import { useState } from 'react'
import type { ApprovalRow } from '@/app/api/workdeck/approvals/route'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function parseDate(s: string): Date | null {
  if (!s) return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  const d = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = parseDate(iso)
  if (!d) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

type SortKey = 'approvedDate' | 'type' | 'requestNumber' | 'projectName' | 'submittedBy' | 'approvedBy'

export default function ApprovalsSection() {
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  const [year, setYear] = useState(currentYear)
  const [selectedMonths, setSelectedMonths] = useState<number[]>([currentMonth])
  const [filter, setFilter] = useState<'all' | 'expense' | 'purchase'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('approvedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const years = Array.from({ length: 4 }, (_, i) => currentYear - i)

  const isFullYear = selectedMonths.length === (year === currentYear ? currentMonth : 12)

  const toggleMonth = (mo: number) => {
    setSelectedMonths(prev =>
      prev.includes(mo) ? (prev.length > 1 ? prev.filter(m => m !== mo) : prev) : [...prev, mo].sort((a, b) => a - b)
    )
  }

  const selectFullYear = () => {
    const max = year === currentYear ? currentMonth : 12
    setSelectedMonths(Array.from({ length: max }, (_, i) => i + 1))
  }

  const handleYearChange = (y: number) => {
    setYear(y)
    // clamp selected months to valid range for the new year
    const max = y === currentYear ? currentMonth : 12
    setSelectedMonths(prev => {
      const clamped = prev.filter(m => m <= max)
      return clamped.length > 0 ? clamped : [Math.min(prev[0] ?? currentMonth, max)]
    })
  }

  const periodLabel = () => {
    if (isFullYear) return `Full Year ${year}`
    if (selectedMonths.length === 1) return `${MONTH_NAMES[selectedMonths[0] - 1]} ${year}`
    const names = selectedMonths.map(m => MONTH_NAMES[m - 1].slice(0, 3))
    return `${names.join(', ')} ${year}`
  }

  const handleDownloadExcel = async () => {
    if (!displayed || displayed.length === 0) return
    const XLSX = await import('xlsx')
    const wsData = [
      ['Type', 'Request No.', 'Project', 'Description', 'Submitted By', 'Approved By', 'Approved Date'],
      ...displayed.map(row => [
        row.type,
        row.requestNumber,
        row.projectName || '',
        row.description || '',
        row.submittedBy || '',
        row.approvedBy || '',
        formatDate(row.approvedDate),
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Approvals')
    XLSX.writeFile(wb, `Approvals ${periodLabel()}.xlsx`)
  }

  const handleFetch = async () => {
    setLoading(true)
    setError(null)
    setRows(null)
    try {
      const res = await fetch('/api/workdeck/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, months: selectedMonths }),
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const displayed = rows
    ? [...rows]
        .filter(r => filter === 'all' || r.type === filter)
        .sort((a, b) => {
          let cmp = 0
          if (sortKey === 'approvedDate') {
            const ta = (parseDate(a.approvedDate || a.createdAt || '') ?? new Date(0)).getTime()
            const tb = (parseDate(b.approvedDate || b.createdAt || '') ?? new Date(0)).getTime()
            cmp = ta - tb
          }
          else if (sortKey === 'type') cmp = a.type.localeCompare(b.type)
          else if (sortKey === 'requestNumber') cmp = a.requestNumber.localeCompare(b.requestNumber)
          else if (sortKey === 'projectName') cmp = (a.projectName ?? '').localeCompare(b.projectName ?? '')
          else if (sortKey === 'submittedBy') cmp = (a.submittedBy ?? '').localeCompare(b.submittedBy ?? '')
          else if (sortKey === 'approvedBy') cmp = (a.approvedBy ?? '').localeCompare(b.approvedBy ?? '')
          return sortDir === 'asc' ? cmp : -cmp
        })
    : null

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col
      ? <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
      : <span style={{ marginLeft: 4, fontSize: 9, color: '#3a5a8a' }}>⇅</span>

  const thStyle = (clickable = true): React.CSSProperties => ({
    padding: '10px 14px', fontWeight: 400, textAlign: 'left',
    fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5a7a9a',
    cursor: clickable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap',
  })

  const tdStyle: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'top' }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '44px 24px' }}>
      {/* Controls */}
      <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 10, padding: '24px', marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#1a4a8a', marginBottom: 16 }}>Select Period</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Year + Full Year */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {years.map(y => (
                <button key={y} onClick={() => handleYearChange(y)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  borderColor: year === y ? '#0066cc' : '#c8d8ed',
                  background: year === y ? '#0066cc' : 'transparent',
                  color: year === y ? '#fff' : '#5a7a9a',
                  cursor: 'pointer', fontSize: 13, fontFamily: 'Georgia, serif', transition: 'all 0.15s'
                }}>{y}</button>
              ))}
            </div>
            <button onClick={selectFullYear} style={{
              padding: '5px 14px', borderRadius: 16, border: '1px solid',
              borderColor: isFullYear ? '#0066cc' : '#c8d8ed',
              background: isFullYear ? '#eaf0fa' : 'transparent',
              color: isFullYear ? '#0066cc' : '#5a7a9a',
              cursor: 'pointer', fontSize: 11, fontFamily: 'Georgia, serif', transition: 'all 0.15s',
              alignSelf: 'flex-start'
            }}>Full Year</button>
          </div>

          <div style={{ width: 1, height: 56, background: '#c8d8ed', alignSelf: 'center' }} />

          {/* Month buttons — multi-select */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {MONTH_NAMES.map((name, i) => {
              const mo = i + 1
              const isFuture = year === currentYear && mo > currentMonth
              const isSelected = selectedMonths.includes(mo)
              return (
                <button key={mo} onClick={() => !isFuture && toggleMonth(mo)} disabled={isFuture} style={{
                  padding: '5px 10px', borderRadius: 16, border: '1px solid',
                  borderColor: isSelected ? '#0066cc' : '#c8d8ed',
                  background: isSelected ? '#0066cc' : isFuture ? '#f4f7fc' : 'transparent',
                  color: isSelected ? '#fff' : isFuture ? '#c8d8ed' : '#5a7a9a',
                  cursor: isFuture ? 'not-allowed' : 'pointer', fontSize: 11, fontFamily: 'Georgia, serif', transition: 'all 0.15s'
                }}>{name.slice(0, 3)}</button>
              )
            })}
          </div>
        </div>

        {/* Second row: type filter + fetch */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid #e8eef8' }}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#5a7a9a' }}>Type</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'expense', 'purchase'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 12px', borderRadius: 12, border: '1px solid',
                borderColor: filter === f ? '#0066cc' : '#c8d8ed',
                background: filter === f ? '#eaf0fa' : 'transparent',
                color: filter === f ? '#0066cc' : '#5a7a9a',
                cursor: 'pointer', fontSize: 11, fontFamily: 'Georgia, serif', textTransform: 'capitalize'
              }}>{f}</button>
            ))}
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
            {loading && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
            {loading ? 'Loading…' : 'Fetch Approvals'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff5f0', border: '1px solid #f0c8b8', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#ff7070', fontSize: 14 }}>
          ⚠ {error}
        </div>
      )}

      {displayed !== null && (
        <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #c8d8ed', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#1a4a8a' }}>{periodLabel()}</span>
            <span style={{ fontSize: 12, color: '#5a7a9a' }}>{displayed.length} approval{displayed.length !== 1 ? 's' : ''}</span>
            {displayed.length > 0 && (
              <button onClick={handleDownloadExcel} style={{
                marginLeft: 'auto', padding: '6px 14px', borderRadius: 6,
                border: '1px solid #c8d8ed', background: '#f8fafd',
                color: '#1a4a8a', fontSize: 12, fontFamily: 'Georgia, serif',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 1v7M3.5 5.5l3 3 3-3M1.5 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download Excel
              </button>
            )}
          </div>

          {displayed.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#5a7a9a', fontSize: 13 }}>
              No approved {filter === 'all' ? 'expenses or purchases' : filter + 's'} found for this period
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #c8d8ed', background: '#f8fafd' }}>
                    <th onClick={() => handleSort('type')} style={thStyle()}>Type<SortIcon col="type" /></th>
                    <th onClick={() => handleSort('requestNumber')} style={thStyle()}>Request No.<SortIcon col="requestNumber" /></th>
                    <th onClick={() => handleSort('projectName')} style={thStyle()}>Project<SortIcon col="projectName" /></th>
                    <th style={thStyle(false)}>Description</th>
                    <th onClick={() => handleSort('submittedBy')} style={thStyle()}>Submitted By<SortIcon col="submittedBy" /></th>
                    <th onClick={() => handleSort('approvedBy')} style={thStyle()}>Approved By<SortIcon col="approvedBy" /></th>
                    <th onClick={() => handleSort('approvedDate')} style={thStyle()}>Approved Date<SortIcon col="approvedDate" /></th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((row, i) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #e8eef8', background: i % 2 === 0 ? '#fff' : '#fafcff' }}>
                      <td style={tdStyle}>
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
                      <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#1a2a3a' }}>{row.requestNumber}</td>
                      <td style={{ ...tdStyle, color: '#2a4a6a', maxWidth: 160 }}>{row.projectName || '—'}</td>
                      <td style={{ ...tdStyle, color: '#4a6a8a', maxWidth: 200 }}>{row.description || '—'}</td>
                      <td style={{ ...tdStyle, color: '#2a4a6a' }}>{row.submittedBy || '—'}</td>
                      <td style={{ ...tdStyle, color: '#2a4a6a' }}>{row.approvedBy || '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#1da35a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {formatDate(row.approvedDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
