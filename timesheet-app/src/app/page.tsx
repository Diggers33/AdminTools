'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import JSZip from 'jszip'
import ApprovalsSection from '@/components/ApprovalsSection'
import LandingPage from '@/components/LandingPage'
import LoginPage from '@/components/LoginPage'

interface Project { project: string; hours: number }
interface Employee { name: string; projects: Project[]; totalHours: number; travelDayCount?: number; holidayDayCount?: number; sickDayCount?: number; meetingCount?: number; maxAvailableHours?: number; hoursAnomaly?: boolean }
interface MonthOption { label: string; month: number; year: number }
type Step = 'upload' | 'configure' | 'preview' | 'generating' | 'done'
interface VerifyProjectResult { project: string; expected: number; actual: number; passed: boolean }
interface VerifyEmployeeResult { name: string; passed: boolean; expectedTotal: number; actualTotal: number; projects: VerifyProjectResult[] }
interface VerifyReport { total: number; passed: number; failed: number; allPassed: boolean; results: VerifyEmployeeResult[] }

// IRIS logo SVG inline (green/olive brand colours)
const IRISLogo = () => (
  <div dangerouslySetInnerHTML={{ __html: `<?xml version="1.0" encoding="UTF-8"?> <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="87px" height="38px" viewBox="0 0 87 38" version="1.1"><title>RGB_NEGATIVO</title><g id="Screens" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="Group-3" transform="translate(-70.000000, -14.000000)"><image id="RGB_NEGATIVO" x="70" y="14" width="87" height="38" xlink:href="data:image/png;base64,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"></image></g></g></svg>` }} style={{ height: 38, display: 'flex', alignItems: 'center' }} />
)

const Spinner = () => {
  const [angle, setAngle] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setAngle(a => (a + 4) % 360), 16)
    return () => clearInterval(id)
  }, [])
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="28" cy="28" r="22" fill="none" stroke="#1a2a3a" strokeWidth="4"/>
      <circle cx="28" cy="28" r="22" fill="none" stroke="#1da35a" strokeWidth="4"
        strokeDasharray="34 104" strokeDashoffset={104 - angle * 0.385}
        strokeLinecap="round"
        style={{ transformOrigin: '28px 28px', transform: `rotate(${angle}deg)` }}/>
      <circle cx="28" cy="28" r="22" fill="none" stroke="#6d8c28" strokeWidth="4"
        strokeDasharray="18 120" strokeDashoffset={120 - angle * 0.2}
        strokeLinecap="round"
        style={{ transformOrigin: '28px 28px', transform: `rotate(${-angle * 0.7}deg)` }}/>
    </svg>
  )
}

export default function Home() {
  const [step, setStep] = useState<Step>('upload')
  const [reportsFile, setReportsFile] = useState<File | null>(null)
  const [parsedReportsRows, setParsedReportsRows] = useState<{fullName:string;project:string;year:number;month:number;hours:number}[] | null>(null)
  const [travelFile, setTravelFile] = useState<File | null>(null)
  const [leaveFile, setLeaveFile] = useState<File | null>(null)
  const [sickFile, setSickFile] = useState<File | null>(null)
  const [months, setMonths] = useState<MonthOption[]>([])
  const [selectedMonth, setSelectedMonth] = useState<MonthOption | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [zipName, setZipName] = useState('')
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [expandedVerify, setExpandedVerify] = useState<string | null>(null)
  const [workdeckConnected, setWorkdeckConnected] = useState(false)
  const [workdeckEmail, setWorkdeckEmail] = useState('')
  const [workdeckData, setWorkdeckData] = useState<{ holidays: Record<string, number[]>; meetings: Record<string, Record<string, Record<number, number>>>; publicHolidays?: number[]; leaveDebug?: { total: number; leaveTypeNames: string[]; leaveStateValues: unknown[]; rawLeaveKeys: string[]; sampleLeaveKeys: string[]; sampleLeave: unknown; matchedCount: number } } | null>(null)
  const [workdeckLoading, setWorkdeckLoading] = useState(false)
  const [activeTool, setActiveTool] = useState<'timesheets' | 'approvals' | null>(null)
  const zipBlobRef = useRef<Blob | null>(null)
  const reportsInputRef = useRef<HTMLInputElement>(null)
  const travelInputRef  = useRef<HTMLInputElement>(null)
  const leaveInputRef   = useRef<HTMLInputElement>(null)
  const sickInputRef    = useRef<HTMLInputElement>(null)

  const handleReportsDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.xlsx')) { setReportsFile(f); setError(null) }
  }, [])

  const handleTravelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.xlsx')) { setTravelFile(f); setError(null) }
  }, [])

  const handleLeaveDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.xlsx')) { setLeaveFile(f); setError(null) }
  }, [])

  const handleSickDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.xlsx')) { setSickFile(f); setError(null) }
  }, [])

  const handleWorkdeckLogout = async () => {
    await fetch('/api/workdeck/logout', { method: 'POST' })
    setWorkdeckConnected(false); setWorkdeckEmail(''); setWorkdeckData(null)
  }

  // Parse a fetch Response as JSON; if the body isn't JSON (e.g. Vercel 413 plain-text),
  // throw with the raw text so the user sees a meaningful message.
  const safeJson = async (res: Response) => {
    const text = await res.text()
    try { return JSON.parse(text) } catch {
      throw new Error(res.ok ? text : `Server error ${res.status}: ${text.slice(0, 120)}`)
    }
  }

  const handleLoadMonths = async () => {
    if (!reportsFile) return
    setError(null)
    setStep('generating')
    setStatusMsg('Reading reports file…')
    try {
      // Parse entirely in the browser — avoids uploading the full file to Vercel
      const XLSX = await import('xlsx')
      const buffer = await reportsFile.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      const ws = wb.Sheets['DATOS']
      if (!ws) throw new Error('DATOS sheet not found in the uploaded file')
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 0, defval: null })

      const rows: {fullName:string;project:string;year:number;month:number;hours:number}[] = []
      const monthSet = new Set<string>()
      for (const row of rawRows) {
        const fecha = row['Fecha']
        if (!(fecha instanceof Date)) continue
        const y = fecha.getFullYear(); const m = fecha.getMonth() + 1
        const nombre = String(row['Nombre'] || '').trim()
        const apellido = String(row['Apellido'] || '').trim()
        if (!nombre || !apellido || nombre === 'Nombre') continue
        const project = String(row['Project'] || '').trim()
        const hours = Number(row['Hours']) || 0
        if (!project || hours <= 0) continue
        rows.push({ fullName: `${nombre} ${apellido}`, project, year: y, month: m, hours })
        monthSet.add(`${y}-${String(m).padStart(2, '0')}`)
      }
      const months = Array.from(monthSet).sort().map(k => {
        const [y, mo] = k.split('-').map(Number)
        return { label: new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }), month: mo, year: y }
      })
      setParsedReportsRows(rows)
      setMonths(months)
      setStep('configure')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read file')
      setStep('upload')
    }
  }

  const handlePreview = async () => {
    if (!reportsFile || !selectedMonth) return
    setError(null)
    setStep('generating')
    setStatusMsg('Loading employee data…')
    const fd = new FormData()
    if (parsedReportsRows) {
      const monthRows = parsedReportsRows.filter(r => r.year === selectedMonth.year && r.month === selectedMonth.month)
      fd.append('parsedReports', JSON.stringify(monthRows))
    } else if (reportsFile) {
      fd.append('reports', reportsFile)
    }
    if (travelFile) fd.append('travel', travelFile)
    if (leaveFile) fd.append('leave', leaveFile)
    if (sickFile) fd.append('sick', sickFile)
    fd.append('month', String(selectedMonth.month))
    fd.append('year', String(selectedMonth.year))
    try {
      const res = await fetch('/api/preview', { method: 'POST', body: fd })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error)
      setEmployees(data.employees)
      setSelectedEmployees(new Set(data.employees.map((e: Employee) => e.name)))
      setStep('preview')
      // Non-blocking Workdeck data fetch — augments preview with holiday/meeting badges
      if (workdeckConnected) {
        setWorkdeckLoading(true)
        fetch('/api/workdeck/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: selectedMonth.month, year: selectedMonth.year, employeeNames: data.employees.map((e: Employee) => e.name) }),
        }).then(r => r.ok ? r.json() : null).then(wd => {
          if (!wd) return
          setWorkdeckData(wd)
          setEmployees(prev => prev.map(e => ({
            ...e,
            holidayDayCount: wd.holidays[e.name]?.length || e.holidayDayCount || 0,
            meetingCount: wd.meetings[e.name]
              ? Object.values(wd.meetings[e.name] as Record<string, Record<number, number>>).reduce(
                  (sum: number, dm: Record<number, number>) => sum + Object.values(dm).reduce((s: number, h: number) => s + h, 0), 0)
              : 0,
          })))
        }).catch(() => {}).finally(() => setWorkdeckLoading(false))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load preview')
      setStep('configure')
    }
  }

  const toggleEmployee = (name: string) => {
    setSelectedEmployees(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const toggleAll = () =>
    setSelectedEmployees(selectedEmployees.size === employees.length ? new Set() : new Set(employees.map(e => e.name)))

  const handleGenerate = async () => {
    if (!reportsFile || !selectedMonth) return
    setStep('generating')
    setStatusMsg(`Building ${selectedEmployees.size} timesheets for ${selectedMonth.label}…`)
    setError(null)
    const fd = new FormData()
    if (parsedReportsRows) {
      const monthRows = parsedReportsRows.filter(r => r.year === selectedMonth.year && r.month === selectedMonth.month)
      fd.append('parsedReports', JSON.stringify(monthRows))
    } else if (reportsFile) {
      fd.append('reports', reportsFile)
    }
    if (travelFile) fd.append('travel', travelFile)
    if (leaveFile) fd.append('leave', leaveFile)
    if (sickFile) fd.append('sick', sickFile)
    if (workdeckData) fd.append('workdeckData', JSON.stringify(workdeckData))
    fd.append('month', String(selectedMonth.month))
    fd.append('year', String(selectedMonth.year))
    fd.append('selectedEmployees', JSON.stringify(Array.from(selectedEmployees)))

    // Cycle through status messages to show activity
    const msgs = [
      `Distributing hours across ${selectedMonth.label}…`,
      'Applying travel days…',
      'Formatting Excel files…',
      'Compiling ZIP archive…',
    ]
    let mi = 0
    const msgInterval = setInterval(() => {
      setStatusMsg(msgs[mi % msgs.length])
      mi++
    }, 2200)

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: fd })
      clearInterval(msgInterval)
      if (!res.ok) { const d = await safeJson(res); throw new Error(d.error ?? d) }
      const blob = await res.blob()
      zipBlobRef.current = blob
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      const name = `Timesheets_${selectedMonth.label.replace(' ', '_')}.zip`
      setZipName(name)
      setStep('done')

      // Auto-run verification
      await runVerify(blob, name)
    } catch (e) {
      clearInterval(msgInterval)
      setError(e instanceof Error ? e.message : 'Generation failed')
      setStep('preview')
    }
  }

  const runVerify = async (blob: Blob, name: string) => {
    if (!selectedMonth) return
    setVerifying(true)
    setVerifyReport(null)
    setVerifyError(null)
    try {
      const vfd = new FormData()
      if (parsedReportsRows) {
        const monthRows = parsedReportsRows.filter(r => r.year === selectedMonth.year && r.month === selectedMonth.month)
        vfd.append('parsedReports', JSON.stringify(monthRows))
      } else if (reportsFile) {
        vfd.append('reports', reportsFile)
      }
      vfd.append('zip', new File([blob], name, { type: 'application/zip' }))
      vfd.append('month', String(selectedMonth.month))
      vfd.append('year', String(selectedMonth.year))
      const vres = await fetch('/api/verify', { method: 'POST', body: vfd })
      const vdata = await safeJson(vres)
      if (!vres.ok) throw new Error(vdata.error ?? 'Verification failed')
      setVerifyReport(vdata)
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Verification failed')
    }
    setVerifying(false)
  }

  const handleFix = async () => {
    if (!reportsFile || !selectedMonth || !verifyReport || !zipBlobRef.current) return
    const failedNames = verifyReport.results.filter(r => !r.passed).map(r => r.name)
    if (failedNames.length === 0) return

    setFixing(true)
    const fd = new FormData()
    fd.append('reports', reportsFile)
    if (travelFile) fd.append('travel', travelFile)
    if (sickFile) fd.append('sick', sickFile)
    fd.append('month', String(selectedMonth.month))
    fd.append('year', String(selectedMonth.year))
    fd.append('selectedEmployees', JSON.stringify(failedNames))

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Re-generation failed')
      const fixBlob = await res.blob()

      // Merge fixed files into existing ZIP using JSZip
      const [existingZip, fixZip] = await Promise.all([
        JSZip.loadAsync(zipBlobRef.current),
        JSZip.loadAsync(fixBlob)
      ])
      // Replace files in existing zip with fixed versions
      for (const [path, entry] of Object.entries(fixZip.files)) {
        if (!entry.dir) {
          const buf = await entry.async('arraybuffer')
          existingZip.file(path, buf)
        }
      }
      const mergedBuf = await existingZip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      zipBlobRef.current = mergedBuf
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
      setDownloadUrl(URL.createObjectURL(mergedBuf))

      await runVerify(mergedBuf, zipName)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fix failed')
    }
    setFixing(false)
  }

  const handleReset = () => {
    setStep('upload'); setReportsFile(null); setParsedReportsRows(null); setTravelFile(null); setLeaveFile(null); setMonths([])
    setSelectedMonth(null); setEmployees([]); setSelectedEmployees(new Set())
    setError(null); setVerifyReport(null); setVerifyError(null); setVerifying(false); setFixing(false); setExpandedVerify(null)
    setWorkdeckData(null)
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    setDownloadUrl(null)
  }

  const totalTravelDays = employees.filter(e => selectedEmployees.has(e.name)).reduce((s, e) => s + (e.travelDayCount || 0), 0)
  const STEPS = ['upload', 'configure', 'preview', 'done'] as const

  if (!workdeckConnected) return <LoginPage onLogin={(email) => { setWorkdeckConnected(true); setWorkdeckEmail(email) }} />

  if (activeTool === null) return <LandingPage onSelect={(id) => setActiveTool(id as 'timesheets' | 'approvals')} />

  const toolLabel = activeTool === 'timesheets' ? 'Timesheet Verification Tool' : 'Approval Checker'

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4fa', color: '#8aaac8', fontFamily: "'Georgia', serif" }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid #0a1830', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0d1f3c' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <IRISLogo />
          <div style={{ width: 1, height: 32, background: '#1a3a6a' }} />
          <button onClick={() => setActiveTool(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left',
          }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: '#4a7ab8', textTransform: 'uppercase' }}>
              Internal Admin Tools
            </div>
            <div style={{ fontSize: 15, fontWeight: 400, color: '#ffffff', letterSpacing: 0.5 }}>
              {toolLabel}
            </div>
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Tool nav tabs */}
          {(['timesheets', 'approvals'] as const).map(t => (
            <button key={t} onClick={() => setActiveTool(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
              fontSize: 12, fontFamily: 'Georgia, serif', letterSpacing: 1.5, textTransform: 'uppercase',
              color: activeTool === t ? '#7ab0e8' : '#3a6a9a',
              borderBottom: `2px solid ${activeTool === t ? '#0066cc' : 'transparent'}`,
              transition: 'all 0.2s'
            }}>{t === 'timesheets' ? 'Timesheet Verification Tool' : 'Approval Checker'}</button>
          ))}

          {/* Step indicator — show only in timesheets section, hide during generating */}
          {activeTool === 'timesheets' && step !== 'generating' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 12 }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontFamily: 'monospace',
                    background: step === s ? '#1da35a' : i < STEPS.indexOf(step) ? '#0d3a1a' : '#111118',
                    color: step === s ? '#fff' : i < STEPS.indexOf(step) ? '#1da35a' : '#3a3a5a',
                    border: `1px solid ${step === s ? '#0066cc' : i < STEPS.indexOf(step) ? '#0066cc' : '#c8d8ed'}`,
                    transition: 'all 0.3s'
                  }}>{i + 1}</div>
                  {i < STEPS.length - 1 && <div style={{ width: 16, height: 1, background: '#1a2a1a' }} />}
                </div>
              ))}
            </div>
          )}

          {/* Account */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 16, borderLeft: '1px solid #1a3a6a' }}>
            <span style={{ fontSize: 11, color: '#4a7ab8' }}>{workdeckEmail}</span>
            <button onClick={handleWorkdeckLogout} style={{ fontSize: 11, color: '#3a6a9a', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Logout</button>
          </div>
        </div>
      </header>

      {activeTool === 'approvals' && <ApprovalsSection />}

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '44px 24px', display: activeTool === 'approvals' ? 'none' : undefined }}>
        {error && (
          <div style={{ background: '#fff5f0', border: '1px solid #f0c8b8', borderRadius: 8, padding: '12px 16px', marginBottom: 24, color: '#ff7070', fontSize: 14 }}>
            ⚠ {error}
          </div>
        )}

        {/* GENERATING / LOADING spinner */}
        {step === 'generating' && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <Spinner />
            <p style={{ color: '#6b8a4a', marginTop: 28, fontSize: 15, letterSpacing: 0.3 }}>{statusMsg}</p>
            <p style={{ color: '#8aaac8', fontSize: 12, marginTop: 8 }}>This may take a moment for large teams</p>
          </div>
        )}

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 300, marginBottom: 6, color: '#1a2a3a' }}>Upload Files</h2>
            <p style={{ color: '#5a7a9a', marginBottom: 36, fontSize: 14 }}>
              Upload the monthly REPORTS file. Optionally add VIAJES for travel days and a leave export for holidays.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <DropZone label="REPORTS File" sublabel="Required · DATOS sheet · monthly hours" file={reportsFile}
                onDrop={handleReportsDrop} onBrowse={() => reportsInputRef.current?.click()}
                inputRef={reportsInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) { setReportsFile(f); setError(null) } }} required />
              <DropZone label="VIAJES Travel File" sublabel="Optional · TRAVEL + EXPENSES sheets" file={travelFile}
                onDrop={handleTravelDrop} onBrowse={() => travelInputRef.current?.click()}
                inputRef={travelInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) { setTravelFile(f); setError(null) } }} required={false} icon={'\u2708'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 0 }}>
              <DropZone label="Sick Leave File" sublabel="Optional · ALTAS_BAJAS_CONSULTA · Alta-Baja &amp; Enfermedad sheets" file={sickFile}
                onDrop={handleSickDrop} onBrowse={() => sickInputRef.current?.click()}
                inputRef={sickInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) { setSickFile(f); setError(null) } }} required={false} icon={'\u271A'} iconColor="#c0392b" />
              <div />
            </div>
            <div style={{ marginTop: 28 }}>
            <button onClick={handleLoadMonths} disabled={!reportsFile} style={btn(!reportsFile)}>Continue →</button>
            </div>
          </div>
        )}

        {/* STEP 2: Configure */}
        {step === 'configure' && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 300, marginBottom: 6, color: '#1a2a3a' }}>Select Period</h2>
            <p style={{ color: '#5a7a9a', marginBottom: 28, fontSize: 14 }}>Choose the month to generate timesheets for.</p>
            <MonthPicker months={months} selected={selectedMonth} onSelect={setSelectedMonth} />
            <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
              <button onClick={() => setStep('upload')} style={btn(false, true)}>← Back</button>
              <button onClick={handlePreview} disabled={!selectedMonth} style={btn(!selectedMonth)}>Preview Employees →</button>
            </div>
          </div>
        )}

        {/* STEP 3: Preview */}
        {step === 'preview' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 26, fontWeight: 300, margin: 0, color: '#1a2a3a' }}>Preview</h2>
              <span style={{ color: '#5a7a9a', fontSize: 13 }}>
                {selectedMonth?.label} · {employees.length} employees
                {travelFile && totalTravelDays > 0 ? ` · ✈ ${totalTravelDays} travel days` : ''}
                {workdeckData?.publicHolidays?.length ? ` · 🏛 ${workdeckData.publicHolidays.length} public holiday${workdeckData.publicHolidays.length !== 1 ? 's' : ''}` : ''}
              </span>
              {workdeckLoading && (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: '#1a4a8a', background: '#e8f0fa',
                  border: '1px solid #a8c0e8', borderRadius: 20,
                  padding: '3px 10px', marginLeft: 10,
                  animation: 'wd-pulse 1.4s ease-in-out infinite',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1da35a', display: 'inline-block', animation: 'wd-dot 1.4s ease-in-out infinite' }} />
                  Fetching Workdeck data…
                </span>
                <style>{`@keyframes wd-pulse{0%,100%{opacity:1}50%{opacity:0.4}} @keyframes wd-dot{0%,100%{transform:scale(1)}50%{transform:scale(1.7)}}`}</style>
              </>
            )}
            </div>
            <p style={{ color: '#5a7a9a', marginBottom: 20, fontSize: 14 }}>Click any row to expand. Deselect to skip.</p>

            {workdeckData?.leaveDebug && (
              <details style={{ marginBottom: 16, fontSize: 11, color: '#5a7a9a', background: '#f8faff', border: '1px solid #c8d8ed', borderRadius: 6, padding: '6px 12px' }}>
                <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Workdeck leave debug — {workdeckData.leaveDebug.total} leave requests received, {workdeckData.leaveDebug.matchedCount} employees matched
                </summary>
                <pre style={{ marginTop: 8, fontSize: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(workdeckData.leaveDebug, null, 2)}
                </pre>
              </details>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#f0f4fa', borderRadius: '8px 8px 0 0', border: '1px solid #c8d8ed', borderBottom: 'none' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#5a7a9a' }}>
                <input type="checkbox" checked={selectedEmployees.size === employees.length} onChange={toggleAll} style={{ accentColor: '#1da35a', width: 13, height: 13 }} />
                Select all ({selectedEmployees.size}/{employees.length})
              </label>
              <span style={{ fontSize: 12, color: '#8aaac8' }}>
                {Array.from(selectedEmployees).reduce((s, n) => s + (employees.find(e => e.name === n)?.totalHours || 0), 0).toFixed(1)}h total
              </span>
            </div>

            <div style={{ border: '1px solid #c8d8ed', borderRadius: '0 0 8px 8px', overflow: 'hidden', marginBottom: 28 }}>
              {employees.map((emp, idx) => (
                <div key={emp.name} style={{ borderBottom: idx < employees.length - 1 ? '1px solid #0f180f' : 'none' }}>
                  <div onClick={() => setExpandedEmployee(expandedEmployee === emp.name ? null : emp.name)}
                    style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', cursor: 'pointer', background: selectedEmployees.has(emp.name) ? '#080d08' : '#050805' }}>
                    <input type="checkbox" checked={selectedEmployees.has(emp.name)} onChange={() => toggleEmployee(emp.name)}
                      onClick={e => e.stopPropagation()} style={{ accentColor: '#1da35a', width: 13, height: 13, marginRight: 12, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: selectedEmployees.has(emp.name) ? '#c8d4b8' : '#3a4a3a' }}>{emp.name}</span>
                    {emp.travelDayCount ? (
                      <span style={{ fontSize: 10, color: '#cc8800', marginRight: 10, background: '#1a1000', padding: '2px 7px', borderRadius: 10, border: '1px solid #3a2800' }}>
                        ✈ {emp.travelDayCount}d
                      </span>
                    ) : null}
                    {emp.holidayDayCount ? (
                      <span style={{ fontSize: 10, color: '#375623', marginRight: 10, background: '#0a1a0a', padding: '2px 7px', borderRadius: 10, border: '1px solid #1a3a1a' }}>
                        HOL {emp.holidayDayCount}d
                      </span>
                    ) : null}
                    {emp.sickDayCount ? (
                      <span style={{ fontSize: 10, color: '#9C0006', marginRight: 10, background: '#1a0000', padding: '2px 7px', borderRadius: 10, border: '1px solid #3a0000' }}>
                        SICK {emp.sickDayCount}d
                      </span>
                    ) : null}
                    {emp.meetingCount ? (
                      <span style={{ fontSize: 10, color: '#1a4a8a', marginRight: 10, background: '#0a101a', padding: '2px 7px', borderRadius: 10, border: '1px solid #1a2a4a' }}>
                        📅 {(emp.meetingCount as number).toFixed(1)}h
                      </span>
                    ) : null}
                    {emp.hoursAnomaly && emp.maxAvailableHours !== undefined ? (
                      <span title={`${emp.totalHours.toFixed(1)}h reported but only ${emp.maxAvailableHours}h available after leave`}
                        style={{ fontSize: 10, color: '#fff', marginRight: 10, background: '#c0392b', padding: '2px 7px', borderRadius: 10, border: '1px solid #922b21', fontWeight: 700, letterSpacing: 0.5 }}>
                        ! +{(emp.totalHours - emp.maxAvailableHours).toFixed(1)}h over capacity
                      </span>
                    ) : null}
                    <span style={{ fontSize: 11, color: emp.hoursAnomaly ? '#e74c3c' : '#1da35a', marginRight: 12, fontFamily: 'monospace' }}>{emp.totalHours.toFixed(1)}h</span>
                    <span style={{ fontSize: 11, color: '#5a7a9a' }}>{expandedEmployee === emp.name ? '▲' : '▼'}</span>
                  </div>
                  {expandedEmployee === emp.name && (
                    <div style={{ background: '#030703', padding: '0 16px 10px 42px', borderTop: '1px solid #0f180f' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                        <thead>
                          <tr>
                            {['Project', 'Hours', 'Share'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Project' ? 'left' : 'right', fontSize: 9, color: '#5a7a9a', letterSpacing: 2, textTransform: 'uppercase', padding: '3px 0', fontWeight: 400 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {emp.projects.map(p => (
                            <tr key={p.project}>
                              <td style={{ fontSize: 12, color: '#6a8a4a', padding: '3px 0' }}>{p.project}</td>
                              <td style={{ fontSize: 12, color: '#1a2a3a', textAlign: 'right', fontFamily: 'monospace' }}>{p.hours.toFixed(1)}</td>
                              <td style={{ fontSize: 11, color: '#1da35a', textAlign: 'right', fontFamily: 'monospace' }}>{((p.hours / emp.totalHours) * 100).toFixed(0)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('configure')} style={btn(false, true)}>← Back</button>
              <button onClick={handleGenerate} disabled={selectedEmployees.size === 0} style={btn(selectedEmployees.size === 0)}>
                Generate {selectedEmployees.size} Timesheet{selectedEmployees.size !== 1 ? 's' : ''} →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Done */}
        {step === 'done' && (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 0' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#eaf0fa', border: '2px solid #1da35a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 26, color: '#1da35a' }}>✓</div>
              <h2 style={{ fontWeight: 300, marginBottom: 6, color: '#1a2a3a' }}>Generation Complete</h2>
              <p style={{ color: '#5a7a9a', fontSize: 14 }}>{selectedEmployees.size} timesheets generated for {selectedMonth?.label}</p>
            </div>

            {/* Verification panel */}
            <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 10, marginBottom: 28, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #c8d8ed', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#1a4a8a' }}>Verification</span>
                {verifying && <span style={{ fontSize: 12, color: '#5a7a9a' }}>Running checks…</span>}
                {verifyReport && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontFamily: 'monospace',
                    color: verifyReport.allPassed ? '#1da35a' : '#e07040' }}>
                    {verifyReport.passed}/{verifyReport.total} passed
                    {verifyReport.failed > 0 ? ` · ${verifyReport.failed} failed` : ''}
                  </span>
                )}
              </div>

              {verifying && (
                <div style={{ padding: '24px 20px', textAlign: 'center' }}>
                  <div style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid #1a2a1a', borderTopColor: '#1da35a', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite' }} />
                  <p style={{ fontSize: 12, color: '#5a7a9a', marginTop: 10 }}>Reading generated files and comparing totals…</p>
                  <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              )}

              {verifyError && !verifying && (
                <div style={{ padding: '14px 20px', fontSize: 12, color: '#c0392b', background: '#fff5f2' }}>
                  Verification error: {verifyError}
                </div>
              )}

              {verifyReport && verifyReport.results.map(emp => (
                <div key={emp.name} style={{ borderBottom: '1px solid #e0e8f4' }}>
                  <div onClick={() => setExpandedVerify(expandedVerify === emp.name ? null : emp.name)}
                    style={{ padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      background: emp.passed ? 'transparent' : '#fff5f2' }}>
                    <span style={{ fontSize: 14, color: emp.passed ? '#1da35a' : '#e07040' }}>{emp.passed ? '✓' : '✗'}</span>
                    <span style={{ fontSize: 13, color: emp.passed ? '#c8d4b8' : '#e07040', flex: 1 }}>{emp.name}</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: emp.passed ? '#3a6a2a' : '#e07040' }}>
                      {emp.actualTotal}h / {emp.expectedTotal}h
                      {!emp.passed && ` (${emp.actualTotal > emp.expectedTotal ? '+' : ''}${Math.round((emp.actualTotal - emp.expectedTotal) * 10) / 10}h)`}
                    </span>
                    <span style={{ fontSize: 10, color: '#8aaac8' }}>{expandedVerify === emp.name ? '▲' : '▼'}</span>
                  </div>
                  {expandedVerify === emp.name && (
                    <div style={{ padding: '4px 20px 12px 44px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ color: '#5a7a9a', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                            <th style={{ textAlign: 'left', padding: '3px 0', fontWeight: 400 }}>Project</th>
                            <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 400 }}>Expected</th>
                            <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 400 }}>Actual</th>
                            <th style={{ textAlign: 'right', padding: '3px 0', fontWeight: 400 }}>Diff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {emp.projects.map(p => (
                            <tr key={p.project} style={{ borderTop: '1px solid #0f1a0f' }}>
                              <td style={{ fontSize: 12, color: p.passed ? '#8aaa6a' : '#e07040', padding: '4px 0' }}>{p.project}</td>
                              <td style={{ fontSize: 12, fontFamily: 'monospace', color: '#1a4a8a', textAlign: 'right', padding: '4px 8px' }}>{p.expected}h</td>
                              <td style={{ fontSize: 12, fontFamily: 'monospace', color: p.passed ? '#1da35a' : '#e07040', textAlign: 'right', padding: '4px 8px' }}>{p.actual}h</td>
                              <td style={{ fontSize: 11, fontFamily: 'monospace', textAlign: 'right', padding: '4px 0',
                                color: p.passed ? '#2a4a2a' : Math.abs(p.actual - p.expected) > 1 ? '#e07040' : '#a06030' }}>
                                {p.passed ? '—' : `${p.actual > p.expected ? '+' : ''}${Math.round((p.actual - p.expected) * 10) / 10}h`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {verifyReport && verifyReport.allPassed && (
                <div style={{ padding: '14px 20px', textAlign: 'center', fontSize: 12, color: '#1a4a8a' }}>
                  All hour totals verified ✓
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {verifyReport && verifyReport.failed > 0 && !verifying && (
                <button onClick={handleFix} disabled={fixing} style={{
                  ...btn(fixing) as object,
                  borderColor: fixing ? '#1a2a1a' : '#e07040',
                  color: fixing ? '#2a3a2a' : '#e07040',
                  background: fixing ? '#080d08' : '#1a0a04'
                }}>
                  {fixing ? '⟳ Fixing…' : `⚠ Fix ${verifyReport.failed} Failed`}
                </button>
              )}
              <a href={downloadUrl!} download={zipName} style={{ ...btn(false) as object, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                ↓ Download ZIP
              </a>
              <button onClick={handleReset} style={btn(false, true)}>Process Another Month</button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function DropZone({ label, sublabel, file, onDrop, onBrowse, inputRef, onChange, required, icon, iconColor }: {
  label: string; sublabel: string; file: File | null; required: boolean; icon?: string; iconColor?: string
  onDrop: (e: React.DragEvent) => void; onBrowse: () => void
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div onDrop={onDrop} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onClick={onBrowse}
      style={{
        border: `2px dashed ${file ? '#0066cc' : dragging ? '#1a4a8a' : required ? '#c8d8ed' : '#e0e8f4'}`,
        borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
        background: file ? '#eaf0fa' : dragging ? '#dce8f8' : '#ffffff',
        transition: 'all 0.2s', position: 'relative'
      }}>
      <input ref={inputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={onChange} />
      {!required && !file && (
        <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 9, color: '#5a7a9a', letterSpacing: 1, textTransform: 'uppercase' }}>Optional</div>
      )}
      <div style={{ fontSize: 24, marginBottom: 8, color: file ? undefined : iconColor }}>{file ? '\u2713' : (icon ?? (required ? '\u{1F4C2}' : '\u{1F4C4}'))}</div>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#1a4a8a', marginBottom: 5 }}>{label}</div>
      {file
        ? <div style={{ fontSize: 12, color: '#1da35a', wordBreak: 'break-all' }}>{file.name}</div>
        : <><div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 3 }}>Drop file or click to browse</div><div style={{ fontSize: 11, color: '#8aaac8' }}>{sublabel}</div></>
      }
    </div>
  )
}

function btn(disabled: boolean, secondary = false): React.CSSProperties {
  return {
    padding: '11px 26px', borderRadius: 6, border: '1px solid',
    borderColor: disabled ? '#c8d8ed' : secondary ? '#c8d8ed' : '#0066cc',
    background: disabled ? '#f0f4fa' : secondary ? 'transparent' : '#0066cc',
    color: disabled ? '#8aaac8' : secondary ? '#1a4a8a' : '#ffffff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13, fontFamily: 'Georgia, serif', transition: 'all 0.2s'
  }
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthPicker({ months, selected, onSelect }: {
  months: MonthOption[]
  selected: MonthOption | null
  onSelect: (m: MonthOption) => void
}) {
  const years = Array.from(new Set(months.map(m => m.year))).sort((a, b) => b - a)
  const [activeYear, setActiveYear] = useState<number>(
    selected?.year ?? years[0] ?? new Date().getFullYear()
  )

  // map year → set of available month numbers
  const available: Record<number, Set<number>> = {}
  for (const m of months) {
    if (!available[m.year]) available[m.year] = new Set()
    available[m.year].add(m.month)
  }

  const isSelected = (y: number, mo: number) => selected?.year === y && selected?.month === mo
  const isAvailable = (y: number, mo: number) => available[y]?.has(mo) ?? false

  return (
    <div style={{ display: 'inline-block', background: '#fff', border: '1px solid #c8d8ed', borderRadius: 12, padding: 24, minWidth: 320 }}>
      {/* Year tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #e0e8f4', paddingBottom: 14 }}>
        {years.map(y => (
          <button key={y} onClick={() => setActiveYear(y)} style={{
            padding: '6px 18px', borderRadius: 20, border: '1px solid',
            borderColor: activeYear === y ? '#0066cc' : '#c8d8ed',
            background: activeYear === y ? '#0066cc' : 'transparent',
            color: activeYear === y ? '#fff' : '#5a7a9a',
            cursor: 'pointer', fontSize: 13, fontWeight: activeYear === y ? 600 : 400,
            transition: 'all 0.15s'
          }}>{y}</button>
        ))}
      </div>

      {/* Month grid — 4×3 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {MONTH_NAMES.map((name, i) => {
          const mo = i + 1
          const avail = isAvailable(activeYear, mo)
          const sel = isSelected(activeYear, mo)
          return (
            <button key={mo} disabled={!avail} onClick={() => {
              const m = months.find(m => m.year === activeYear && m.month === mo)
              if (m) onSelect(m)
            }} style={{
              padding: '10px 0', borderRadius: 8, border: '1px solid',
              borderColor: sel ? '#0066cc' : avail ? '#c8d8ed' : '#eef1f5',
              background: sel ? '#0066cc' : avail ? '#f0f4fa' : '#fafbfc',
              color: sel ? '#fff' : avail ? '#1a2a3a' : '#c8d8ed',
              cursor: avail ? 'pointer' : 'default',
              fontSize: 13, fontWeight: sel ? 600 : 400,
              transition: 'all 0.15s'
            }}>{name}</button>
          )
        })}
      </div>

      {/* Selected label */}
      {selected && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #e0e8f4', fontSize: 13, color: '#0066cc', textAlign: 'center', fontWeight: 500 }}>
          ✓ {selected.label} selected
        </div>
      )}
    </div>
  )
}
