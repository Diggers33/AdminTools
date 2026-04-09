import * as XLSX from 'xlsx'

export interface EmployeeMonth {
  name: string
  projects: { project: string; hours: number }[]
  totalHours: number
  // Travel: map of project -> set of day numbers (within the selected month) that are travel days
  travelDays: Record<string, Set<number>>
  // Holiday (annual leave) days: set of day numbers the employee is off
  holidayDays: Set<number>
  // Company-wide public holidays from Workdeck working calendar (excluded from working days entirely)
  publicHolidays: Set<number>
  // Sick leave / suspension / maternity days
  sickDays: Set<number>
  // Meeting hours from Workdeck: project (REPORTS name) → day → hours
  meetingHours: Record<string, Record<number, number>>
  // First day of the month the employee is active (undefined = from day 1)
  startDay?: number
  // Max hours assignable per working day (default 8; less for reduced schedules)
  dailyCap: number
}

// Spanish public holidays (month 1-indexed, day)
const SPANISH_HOLIDAYS: Record<number, number[]> = {
  1:  [1, 6],
  4:  [2, 21],
  5:  [1],
  8:  [15],
  10: [12],
  11: [1],
  12: [6, 8, 25],
}

export function getWorkingDays(year: number, month: number, extraHolidays?: Set<number>): number[] {
  const holidays = new Set<number>(SPANISH_HOLIDAYS[month] || [])
  if (extraHolidays) extraHolidays.forEach(d => holidays.add(d))
  const days: number[] = []
  const daysInMonth = new Date(year, month, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6 && !holidays.has(d)) days.push(d)
  }
  return days
}

export function distributeHours(
  totalHours: number,
  workingDays: number[],
  year?: number,
  month?: number,
): Record<number, number> {
  const result: Record<number, number> = {}
  const n = workingDays.length
  if (n === 0 || totalHours <= 0) return result

  // Deterministic seeded pseudo-random (no Math.random — reproducible per employee/month)
  function seededRand(seed: number): number {
    const x = Math.sin(seed + 1) * 10000
    return x - Math.floor(x)
  }

  // Day-of-week weight: Mon=1.10 tapering to Fri=0.90
  const DOW_WEIGHT: Record<number, number> = { 1: 1.10, 2: 1.05, 3: 1.00, 4: 0.95, 5: 0.90 }

  // Preferred block sizes: 60% chance of 8 or 4, 40% chance of 1/2/3
  // Also ~20% chance a day is skipped entirely (hours redistributed)
  const BLOCK_VALUES = [8, 4, 4, 3, 2, 1]  // weighted pool

  // Build a slot-filling plan:
  // 1. Pick which days are "active" (not all days need an entry)
  // 2. Assign block sizes from the preferred pool
  // 3. Reconcile to match totalHours exactly

  // For small projects (≤15h), cluster into a consecutive window of days
  // rather than spreading across the month — more realistic
  const activeDays: number[] = []

  if (totalHours <= 15) {
    // Estimate how many days needed (given blocks of 1-4h)
    const avgBlockSize = totalHours <= 6 ? 2 : 3
    const daysNeeded = Math.ceil(totalHours / avgBlockSize)
    // Pick a start offset deterministically — somewhere in first 2/3 of month
    const maxStart = Math.max(0, n - daysNeeded - 1)
    const startIdx = Math.floor(seededRand((month ?? 1) * 17 + (year ?? 2026)) * maxStart)
    for (let i = startIdx; i < n && activeDays.length < daysNeeded + 1; i++) {
      activeDays.push(workingDays[i])
    }
  } else {
    // Larger projects: skip ~15-20% of days spread across month
    const skipRate = totalHours < 30 ? 0.20 : 0.15
    for (let i = 0; i < n; i++) {
      const r = seededRand(workingDays[i] * 31 + (month ?? 1) * 7 + (year ?? 2026))
      if (r > skipRate) activeDays.push(workingDays[i])
    }
  }

  // Guarantee at least 1 active day
  if (activeDays.length === 0) activeDays.push(workingDays[Math.floor(n / 2)])

  // Assign block values to each active day
  const blocks: Record<number, number> = {}
  for (const day of activeDays) {
    const r = seededRand(day * 13 + (month ?? 1) * 3)
    const dow = (year && month) ? new Date(year, month - 1, day).getDay() : 3
    const dowWeight = DOW_WEIGHT[dow] ?? 1.0

    // 60% chance: pick 8 or 4 (weighted by dow — Mon more likely 8, Fri more likely 4)
    // 40% chance: pick 1, 2, or 3
    let block: number
    if (r < 0.60) {
      // Block day: 8 or 4 — use dow to bias
      block = (dowWeight >= 1.05 || r < 0.35) ? 8 : 4
    } else {
      // Fractional day: 1, 2, or 3
      const r2 = seededRand(day * 7 + (month ?? 1))
      block = r2 < 0.33 ? 1 : r2 < 0.66 ? 2 : 3
    }
    blocks[day] = block
  }

  // Reconcile sum to match totalHours exactly
  // First scale: if total is way off, adjust all blocks proportionally then re-snap
  let current = Object.values(blocks).reduce((s, h) => s + h, 0)

  // If we assigned too much, reduce some 8→4 or 4→3 etc
  // If too little, increase some 4→8 or add hours to smaller blocks
  let diff = Math.round((totalHours - current) * 10) / 10

  // Sort active days for adjustment: prefer mid-week (Wed/Thu) to absorb changes
  const sortedDays = [...activeDays].sort((a, b) => {
    const dowA = (year && month) ? new Date(year, month - 1, a).getDay() : 3
    const dowB = (year && month) ? new Date(year, month - 1, b).getDay() : 3
    return Math.abs(dowA - 3) - Math.abs(dowB - 3)
  })

  // Reconcile in 0.5h steps — keep looping until exact match
  // Expand available days if needed by adding from all working days
  const allAdjustDays = [...sortedDays]
  // Add any remaining working days not yet in activeDays, sorted by mid-week preference
  for (const d of workingDays) {
    if (!allAdjustDays.includes(d)) allAdjustDays.push(d)
  }

  let iters = 0
  while (Math.abs(diff) >= 0.45 && iters++ < allAdjustDays.length * 40) {
    let progress = false
    for (const day of allAdjustDays) {
      if (Math.abs(diff) < 0.45) break
      const cur = blocks[day] ?? 0
      if (diff > 0) {
        // Need to add hours — increase this day if under 8
        if (cur < 8) {
          const add = Math.min(diff >= 1 ? 1 : 0.5, 8 - cur)
          blocks[day] = Math.round((cur + add) * 10) / 10
          diff = Math.round((diff - add) * 10) / 10
          progress = true
        }
      } else {
        // Need to remove hours — decrease if above 0
        if (cur > 0) {
          const sub = Math.min(diff <= -1 && cur >= 1 ? 1 : 0.5, cur)
          blocks[day] = Math.round((cur - sub) * 10) / 10
          diff = Math.round((diff + sub) * 10) / 10
          if (blocks[day] <= 0) delete blocks[day]
          progress = true
        }
      }
    }
    if (!progress) break
  }

  // Final safety: if any diff remains, force it onto the first available day
  const finalSum = Math.round(Object.values(blocks).reduce((s, h) => s + h, 0) * 10) / 10
  const finalDiff = Math.round((totalHours - finalSum) * 10) / 10
  if (Math.abs(finalDiff) >= 0.1) {
    // Find a day that can absorb it
    const target = allAdjustDays.find(d => finalDiff > 0 ? (blocks[d] ?? 0) < 8 : (blocks[d] ?? 0) > 0)
      ?? allAdjustDays[0]
    blocks[target] = Math.round(((blocks[target] ?? 0) + finalDiff) * 10) / 10
    if ((blocks[target] ?? 0) <= 0) delete blocks[target]
  }

  for (const [day, h] of Object.entries(blocks)) {
    if (h > 0) result[Number(day)] = h
  }
  return result
}

// ── Fuzzy name matching ────────────────────────────────────────────────────
// VIAJES has "Jose Angulo", REPORTS has "Jose Angulo" (Nombre + Apellido joined)
// Normalise: lowercase, remove accents, sort tokens, compare
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ')
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' '))
  const tb = new Set(b.split(' '))
  let matches = 0
  for (const t of Array.from(ta)) if (tb.has(t)) matches++
  return matches / Math.max(ta.size, tb.size)
}

export function matchName(viajeName: string, reportNames: string[]): string | null {
  const norm = normaliseName(viajeName)
  let best: string | null = null
  let bestScore = 0
  for (const rn of reportNames) {
    const score = tokenOverlap(norm, normaliseName(rn))
    if (score > bestScore) { bestScore = score; best = rn }
  }
  return bestScore >= 0.6 ? best : null
}

// ── Parse Leave / Holiday file ─────────────────────────────────────────────
const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

export function parseLeaveFile(buffer: ArrayBuffer): { employeeName: string; year: number; month: number; days: number }[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets['data']
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 0, defval: null })
  const entries: { employeeName: string; year: number; month: number; days: number }[] = []
  for (const row of rows) {
    const leaveType = String(row['Leave type'] || '').trim().toLowerCase()
    if (leaveType !== 'holidays') continue
    const empName = String(row['Employee'] || '').trim()
    if (!empName) continue
    const year = Number(row['Year'])
    const month = MONTH_NAMES[String(row['Month'] || '').toLowerCase().trim()]
    const days = Number(row['Days']) || 0
    if (!month || !year || days <= 0) continue
    entries.push({ employeeName: empName, year, month, days })
  }
  return entries
}

// ── Parse VIAJES file ──────────────────────────────────────────────────────
export interface TravelEntry {
  employeeName: string   // raw name from VIAJES
  project: string
  startDate: Date
  endDate: Date
}

export function parseTravelFile(buffer: ArrayBuffer): TravelEntry[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const entries: TravelEntry[] = []

  for (const sheetName of ['TRAVEL', 'EXPENSES']) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 0, defval: null })

    for (const row of rows) {
      // Employee name — col EMPLEADO
      const empRaw = String(row['EMPLEADO'] || '').trim()
      if (!empRaw || empRaw === 'EMPLEADO') continue

      // Project — prefer PROJECT column, fall back to PROJECT EU
      const project = String(row['PROJECT'] || row['PROJECT EU'] || '').trim()
      if (!project || project === 'PROJECT' || project === 'NaN' || project.toLowerCase().includes('no es')) continue

      // Dates
      const startRaw = row['FECHA INICIAL']
      const endRaw   = row['FECHA FINAL']
      if (!(startRaw instanceof Date)) continue
      const endDate = endRaw instanceof Date ? endRaw : startRaw

      // Skip rows explicitly marked as not travel
      const col1 = String(row['Columna1'] || row['EMPRESA'] || '').toLowerCase()
      if (col1.includes('no es travel')) continue

      // Skip if TIMESHEET says NO PROCEDE
      const ts = String(row['TIMESHEET'] || '').toLowerCase()
      if (ts.includes('no procede')) continue

      entries.push({ employeeName: empRaw, project, startDate: startRaw, endDate })
    }
  }

  return entries
}

// ── Parse sick leave file (LISTA ALTAS_BAJAS) ─────────────────────────────
function excelSerialToDate(serial: number): Date {
  // Excel serial days since Jan 1, 1900 (with Lotus 1-2-3 leap-year bug)
  return new Date(Math.round((serial - 25569) * 86400 * 1000))
}

// Normalize a Date from SheetJS cellDates to UTC midnight.
// Excel dates have no timezone; SheetJS with cellDates:true returns them as
// ~23:00 UTC when the file was saved in UTC+1/+2 (Spain). Rounding to the
// nearest UTC day recovers the intended calendar date.
function normalizeExcelDate(d: Date): Date {
  return new Date(Math.round(d.getTime() / 86400000) * 86400000)
}

export function parseSickLeaveFile(
  buffer: ArrayBuffer,
  month: number,
  year: number,
  workingDaySet: Set<number>
): Record<string, Set<number>> {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets['TABLAS']
  if (!ws) return {}

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const result: Record<string, Set<number>> = {}
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd   = new Date(Date.UTC(year, month, 0))

  const toDate = (v: unknown): Date | null => {
    if (v instanceof Date) return normalizeExcelDate(v)
    if (typeof v === 'number') return excelSerialToDate(v)
    return null
  }

  // TABLA BAJAS is in cols E(4), F(5), G(6), H(7) — data starts at row index 2
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const empRaw  = row[4]
    const bajaRaw = row[5]   // FECHA BAJA — first sick day
    const altaRaw = row[6]   // FECHA ALTA — return date (last sick day inclusive)

    if (!empRaw || !bajaRaw) continue
    const empName = String(empRaw).trim()
    // Skip section header rows
    if (empName === 'EMPLEADO/A' || empName.startsWith('TABLA') || empName.startsWith('HORAS')) continue

    const start = toDate(bajaRaw)
    if (!start) continue
    // If no end date, employee is still on leave — cover through month end
    const end = toDate(altaRaw) ?? monthEnd

    if (start > monthEnd || end < monthStart) continue

    const from = start < monthStart ? new Date(monthStart) : new Date(start)
    const to   = end   > monthEnd   ? new Date(monthEnd)   : new Date(end)

    if (!result[empName]) result[empName] = new Set()
    for (let cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
      if (cur.getUTCFullYear() === year && cur.getUTCMonth() + 1 === month && workingDaySet.has(cur.getUTCDate())) {
        result[empName].add(cur.getUTCDate())
      }
    }
  }

  return result
}

// ── Parse start dates (TABLA ALTA CONTRATO) and reduced hours (JORNADAS REDUCIDAS / HORAS CONVENIO) ──
function parseContractAndJornada(
  buffer: ArrayBuffer,
  month: number,
  year: number
): { startDays: Map<string, number>; dailyCaps: Map<string, number> } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets['TABLAS']
  if (!ws) return { startDays: new Map(), dailyCaps: new Map() }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd   = new Date(Date.UTC(year, month, 0))

  const toDate = (v: unknown): Date | null => {
    if (v instanceof Date) return new Date(Math.round((v as Date).getTime() / 86400000) * 86400000)
    if (typeof v === 'number') return excelSerialToDate(v)
    return null
  }

  // Normalise JORNADA value to a fraction 0–1 (exclusive of 1 = full-time)
  const parseJornadaFrac = (v: unknown): number | null => {
    let n: number
    if (typeof v === 'number') {
      n = v <= 1.5 ? v : v / 100  // ≤1.5 already a fraction; otherwise a percentage
    } else if (typeof v === 'string') {
      const cleaned = v.replace(',', '.').replace('%', '').trim()
      n = parseFloat(cleaned)
      if (isNaN(n) || n <= 0) return null
      n = v.includes('%') || n > 1.5 ? n / 100 : n
    } else return null
    if (n <= 0 || n >= 1) return null  // skip 0% (invalid) and 100% (full-time)
    return n
  }

  const startDays = new Map<string, number>()
  const dailyCaps = new Map<string, number>()

  // ── TABLA ALTA CONTRATO (cols A-C, rows 2 until "TABLA BAJA CONTRATO") ────
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const empRaw = row[0]
    if (!empRaw) continue
    const cell = String(empRaw).trim()
    if (cell.startsWith('TABLA')) break
    if (cell === 'EMPLEADO/A') continue
    const d = toDate(row[1])
    // Only record if the employee started mid-month (after day 1) in the selected month
    if (d && d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() > 1) {
      startDays.set(cell, d.getUTCDate())
    }
  }

  // ── TABLA JORNADAS REDUCIDAS (cols J-N = indices 9-13) ────────────────────
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] as unknown[]
    const empRaw = row[9]
    if (!empRaw) continue
    const cell = String(empRaw).trim()
    if (cell === 'EMPLEADO' || cell.startsWith('TABLA')) continue

    const frac = parseJornadaFrac(row[10])
    if (frac === null) continue

    const startDate = toDate(row[11])
    const endDate   = toDate(row[12])  // null = ongoing

    if (!startDate || startDate > monthEnd) continue
    if (endDate && endDate < monthStart) continue

    const cap = Math.round(frac * 8 * 10) / 10
    const existing = dailyCaps.get(cell)
    if (existing === undefined || cap < existing) dailyCaps.set(cell, cap)
  }

  // ── TABLA HORAS CONVENIO (cols E-G detected by header in col E) ───────────
  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r][4] ?? '').trim() !== 'TABLA HORAS CONVENIO') continue
    for (let dr = r + 2; dr < rows.length; dr++) {
      const dataRow = rows[dr] as unknown[]
      const empRaw = dataRow[4]
      if (!empRaw) break
      const cell = String(empRaw).trim()
      if (cell === 'EMPLEADO/A' || cell.startsWith('TABLA')) break
      const weeklyHours = typeof dataRow[6] === 'number' ? dataRow[6] : parseFloat(String(dataRow[6] ?? ''))
      if (isNaN(weeklyHours) || weeklyHours <= 0 || weeklyHours >= 40) continue
      const cap = Math.round((weeklyHours / 5) * 10) / 10
      const existing = dailyCaps.get(cell)
      if (existing === undefined || cap < existing) dailyCaps.set(cell, cap)
    }
    break
  }

  return { startDays, dailyCaps }
}

// ── Main extract function ──────────────────────────────────────────────────
export function parseReportsFile(buffer: ArrayBuffer): {
  employees: string[]
  months: { label: string; month: number; year: number }[]
} {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets['DATOS']
  if (!ws) throw new Error('DATOS sheet not found in the uploaded file')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 0, defval: null })

  const employeeSet = new Set<string>()
  const monthSet = new Set<string>()

  for (const row of rows) {
    const nombre   = String(row['Nombre'] || '').trim()
    const apellido = String(row['Apellido'] || '').trim()
    if (nombre && apellido && nombre !== 'Nombre') employeeSet.add(`${nombre} ${apellido}`)
    const fecha = row['Fecha']
    if (fecha instanceof Date) {
      monthSet.add(`${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`)
    }
  }

  const months = Array.from(monthSet).sort().map(k => {
    const [y, m] = k.split('-').map(Number)
    return { label: new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }), month: m, year: y }
  })

  return { employees: Array.from(employeeSet).sort(), months }
}

// Compact row format sent from the browser after client-side parsing
export interface ParsedReportsRow {
  fullName: string
  project: string
  year: number
  month: number
  hours: number
}

export function extractEmployeeData(
  reportsInput: ArrayBuffer | ParsedReportsRow[],
  month: number,
  year: number,
  travelBuffer?: ArrayBuffer | null,
  leaveBuffer?: ArrayBuffer | null,
  workdeckData?: { holidays: Record<string, number[]>; meetings: Record<string, Record<string, Record<number, number>>>; publicHolidays?: number[] } | null,
  sickLeaveBuffer?: ArrayBuffer | null
): EmployeeMonth[] {
  const employeeMap = new Map<string, Map<string, number>>()

  if (Array.isArray(reportsInput)) {
    // Pre-parsed rows supplied by the client (avoids large file upload)
    for (const row of reportsInput) {
      if (row.year !== year || row.month !== month) continue
      if (!row.fullName || !row.project || row.hours <= 0) continue
      if (!employeeMap.has(row.fullName)) employeeMap.set(row.fullName, new Map())
      const projMap = employeeMap.get(row.fullName)!
      projMap.set(row.project, (projMap.get(row.project) || 0) + row.hours)
    }
  } else {
    const wb = XLSX.read(reportsInput, { type: 'array', cellDates: true })
    const ws = wb.Sheets['DATOS']
    if (!ws) throw new Error('DATOS sheet not found')
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 0, defval: null })
    for (const row of rows) {
      const fecha = row['Fecha']
      if (!(fecha instanceof Date)) continue
      if (fecha.getFullYear() !== year || fecha.getMonth() + 1 !== month) continue
      const nombre   = String(row['Nombre'] || '').trim()
      const apellido = String(row['Apellido'] || '').trim()
      if (!nombre || !apellido || nombre === 'Nombre') continue
      const fullName = `${nombre} ${apellido}`
      const project  = String(row['Project'] || '').trim()
      const hours    = Number(row['Hours']) || 0
      if (!project || hours <= 0) continue
      if (!employeeMap.has(fullName)) employeeMap.set(fullName, new Map())
      const projMap = employeeMap.get(fullName)!
      projMap.set(project, (projMap.get(project) || 0) + hours)
    }
  }

  const reportNames = Array.from(employeeMap.keys())
  const publicHolidaySet = workdeckData?.publicHolidays?.length ? new Set(workdeckData.publicHolidays) : undefined

  // ── Parse travel data and match to report employees ──────────────────────
  const travelMap = new Map<string, Record<string, Set<number>>>()
  // key: matched report name → { project → Set<day> }
  const workingDaySet = new Set(getWorkingDays(year, month, publicHolidaySet))

  if (travelBuffer) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const travelEntries = parseTravelFile(travelBuffer)

    for (const entry of travelEntries) {
      const matched = matchName(entry.employeeName, reportNames)
      if (!matched) continue

      // Collect all weekdays within start–end range that fall in selected month
      const start = new Date(entry.startDate); start.setHours(0,0,0,0)
      const end   = new Date(entry.endDate);   end.setHours(0,0,0,0)

      if (!travelMap.has(matched)) travelMap.set(matched, {})
      const empTravel = travelMap.get(matched)!
      if (!empTravel[entry.project]) empTravel[entry.project] = new Set()

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d)
        if (date >= start && date <= end && workingDaySet.has(d)) {
          empTravel[entry.project].add(d)
        }
      }
    }
  }

  // ── Parse leave/holiday data ──────────────────────────────────────────────
  const leaveCountMap = new Map<string, number>()  // matched report name → days off
  if (leaveBuffer) {
    const leaveEntries = parseLeaveFile(leaveBuffer)
    for (const entry of leaveEntries) {
      if (entry.year !== year || entry.month !== month) continue
      const matched = matchName(entry.employeeName, reportNames)
      if (!matched) continue
      leaveCountMap.set(matched, (leaveCountMap.get(matched) || 0) + entry.days)
    }
  }

  // ── Parse sick leave, start dates, and reduced hours from the same file ────
  const rawSickMap: Record<string, Set<number>> = sickLeaveBuffer
    ? parseSickLeaveFile(sickLeaveBuffer, month, year, workingDaySet)
    : {}
  const { startDays, dailyCaps } = sickLeaveBuffer
    ? parseContractAndJornada(sickLeaveBuffer, month, year)
    : { startDays: new Map<string, number>(), dailyCaps: new Map<string, number>() }
  const startDayNames = Array.from(startDays.keys())
  const dailyCapNames = Array.from(dailyCaps.keys())

  // ── Build result ──────────────────────────────────────────────────────────
  const result: EmployeeMonth[] = []
  for (const [name, projMap] of Array.from(employeeMap.entries())) {
    const projects = Array.from(projMap.entries())
      .map(([project, hours]) => ({ project, hours }))
      .sort((a, b) => b.hours - a.hours)
    const totalHours = projects.reduce((s, p) => s + p.hours, 0)
    const rawTravelDays = travelMap.get(name) || {}

    // Fuzzy-match travel project names to REPORTS project names
    // Handles: "HALOTEX" → "HALO-TEX", "DIGINTRACE" → "DIGINTRACE 3", etc.
    const reportProjectNames = projects.map(p => p.project)

    // Normalise: uppercase, remove hyphens, spaces, trailing version numbers
    const normProj = (s: string): string => s.toUpperCase().replace(/[-s]/g, '').replace(/d+$/, '').trim()

    const travelDaysSets: Record<string, Set<number>> = {}
    for (const [travelProj, days] of Object.entries(rawTravelDays)) {
      const normTravel = normProj(travelProj)
      const normTravelFull = travelProj.toUpperCase().replace(/[-\s]/g, '')

      // Match priority:
      // 1. Exact (after normalisation)
      // 2. Report project normalised starts with travel normalised
      // 3. Travel normalised starts with report base normalised
      // 4. Either contains the other (normalised)
      const matched =
        reportProjectNames.find(rp => normProj(rp) === normTravel) ||
        reportProjectNames.find(rp => normProj(rp) === normTravelFull) ||
        reportProjectNames.find(rp => normProj(rp).startsWith(normTravel)) ||
        reportProjectNames.find(rp => normTravel.startsWith(normProj(rp))) ||
        reportProjectNames.find(rp => normProj(rp).includes(normTravel) || normTravel.includes(normProj(rp)))

      const key = matched || travelProj
      const daySet = days instanceof Set ? days : new Set<number>(Array.from(days as Iterable<number>))
      if (!travelDaysSets[key]) travelDaysSets[key] = new Set()
      for (const d of Array.from(daySet)) travelDaysSets[key].add(d)
    }

    // ── Assign holiday days ──────────────────────────────────────────────────
    const holidayDays = new Set<number>()
    if (workdeckData?.holidays[name]) {
      // Use exact dates from Workdeck
      for (const d of workdeckData.holidays[name]) holidayDays.add(d)
    } else {
      // Existing seeded-random fallback from leave file
      const rawHolidayCount = leaveCountMap.get(name) || 0
      const holidayDayCount = Math.round(rawHolidayCount)
      if (holidayDayCount > 0) {
        // Only pick from working days not already blocked by travel
        const empAllTravelDays = new Set<number>()
        for (const days of Object.values(travelDaysSets)) {
          for (const d of Array.from(days)) empAllTravelDays.add(d)
        }
        const available = getWorkingDays(year, month, publicHolidaySet).filter(d => !empAllTravelDays.has(d))
        // Seeded shuffle so output is deterministic
        const nameHash = name.split('').reduce((h, c) => h + c.charCodeAt(0), 0)
        const holidayRand = (seed: number): number => { const x = Math.sin(seed + 1) * 10000; return x - Math.floor(x) }
        const shuffled = [...available].sort((a, b) =>
          holidayRand(nameHash + a * 7 + month * 3 + year) - holidayRand(nameHash + b * 7 + month * 3 + year)
        )
        for (let i = 0; i < Math.min(holidayDayCount, shuffled.length); i++) {
          holidayDays.add(shuffled[i])
        }
      }
    }

    // ── Assign meeting hours from Workdeck ───────────────────────────────────
    const meetingHoursMap: Record<string, Record<number, number>> = {}
    if (workdeckData?.meetings[name]) {
      for (const [wdProj, dayHours] of Object.entries(workdeckData.meetings[name])) {
        const normWd = normProj(wdProj)
        const matched =
          reportProjectNames.find(rp => normProj(rp) === normWd) ||
          reportProjectNames.find(rp => normProj(rp).startsWith(normWd)) ||
          reportProjectNames.find(rp => normWd.startsWith(normProj(rp))) ||
          reportProjectNames.find(rp => normProj(rp).includes(normWd) || normWd.includes(normProj(rp)))
        if (!matched) continue
        if (!meetingHoursMap[matched]) meetingHoursMap[matched] = {}
        for (const [d, hrs] of Object.entries(dayHours)) {
          const day = Number(d)
          meetingHoursMap[matched][day] = Math.round(((meetingHoursMap[matched][day] || 0) + (hrs as number)) * 10) / 10
        }
      }
    }

    // ── Match sick leave to this employee ──────────────────────────────────
    const sickDays = new Set<number>()
    const sickNames = Object.keys(rawSickMap)
    if (sickNames.length > 0) {
      const matchedSickName = matchName(name, sickNames)
      if (matchedSickName && rawSickMap[matchedSickName]) {
        for (const d of Array.from(rawSickMap[matchedSickName])) sickDays.add(d)
      }
    }

    // ── Match start date and daily cap ────────────────────────────────────────
    const matchedStartName = startDayNames.length > 0 ? matchName(name, startDayNames) : null
    const startDay = matchedStartName ? startDays.get(matchedStartName) : undefined

    const matchedCapName = dailyCapNames.length > 0 ? matchName(name, dailyCapNames) : null
    const dailyCap = matchedCapName ? (dailyCaps.get(matchedCapName) ?? 8) : 8

    result.push({ name, projects, totalHours, travelDays: travelDaysSets, holidayDays, publicHolidays: publicHolidaySet ?? new Set(), sickDays, meetingHours: meetingHoursMap, startDay, dailyCap })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}
