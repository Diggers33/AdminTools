export interface WorkdeckLeaveRequest {
  id: string
  startAt: string
  endAt: string
  halfDay: string | null
  // Workdeck encodes state as a number: 0=pending, 1=accepted, 2=denied
  state: number
  user: { id: string; firstName: string; lastName: string }
  leaveType: { id: string; name: string }
}

export interface WorkdeckNonWorkingDay {
  id: string
  name: string
  // Serialised as ISO string in JSON (e.g. "2026-01-01T00:00:00.000Z")
  date: string
  office?: { id: string; name: string }
}

export interface WorkdeckEvent {
  id: string
  startAt: string
  endAt: string
  timesheet: boolean
  leaveRequest: unknown | null
  task: { id: string; name: string } | null
  project: { id: string; name: string; code: string } | null
}

export interface WorkdeckData {
  holidays: Record<string, number[]>
  meetings: Record<string, Record<string, Record<number, number>>>
  publicHolidays: number[]
}

export function parseWdDate(s: string): Date {
  if (!s) return new Date(NaN)
  // DD/MM/YYYY or DD/MM/YYYY HH:mm:ss
  const ddmm = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (ddmm) return new Date(Number(ddmm[3]), Number(ddmm[2]) - 1, Number(ddmm[1]))
  // ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  return new Date(s)
}

// Parse NonWorkingDay entries returned by /queries/non-working-days.
// Returns day numbers (1-31) that fall within the given year/month.
export function extractNonWorkingDays(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
  year: number,
  month: number
): number[] {
  const items: WorkdeckNonWorkingDay[] = Array.isArray(raw)
    ? raw
    : (raw?.result ?? raw?.data ?? [])
  if (!Array.isArray(items)) return []

  const days = new Set<number>()
  for (const item of items) {
    if (!item.date) continue
    const d = new Date(item.date)
    if (isNaN(d.getTime())) continue
    // Use UTC date parts to avoid timezone shifts on midnight timestamps
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) {
      days.add(d.getUTCDate())
    }
  }
  return Array.from(days).sort((a, b) => a - b)
}

export function processLeaveRequests(
  requests: WorkdeckLeaveRequest[],
  year: number,
  month: number,
  workingDaySet: Set<number>
): Record<string, number[]> {
  // Fallback keyword list for leave types that don't use the canonical 'Holidays' name
  const LEAVE_KEYWORDS = [
    'annual leave', 'holiday', 'vacation', 'vacacion', 'conge', 'urlaub', 'pto',
    'festivo', 'puente', 'dia libre', 'día libre', 'permiso retribuido',
    'national', 'bank', 'public', 'oficial', 'official',
  ]

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)

  const result: Record<string, number[]> = {}

  for (const req of requests) {
    // state: 1 = accepted
    if (req.state !== 1) continue

    // Primary: Workdeck canonical leave type name for holidays
    // Fallback: keyword match on normalised name
    const typeName = req.leaveType?.name ?? ''
    const isHoliday =
      typeName === 'Holidays' ||
      LEAVE_KEYWORDS.some(kw =>
        typeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(kw)
      )
    if (!isHoliday) continue

    const fullName = `${req.user.firstName} ${req.user.lastName}`

    // Parse and clamp dates to the selected month
    let start = parseWdDate(req.startAt.split(' ')[0])
    let end = parseWdDate(req.endAt.split(' ')[0])

    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue
    if (end < monthStart || start > monthEnd) continue
    if (start < monthStart) start = new Date(monthStart)
    if (end > monthEnd) end = new Date(monthEnd)

    // Expand range to working day numbers within this month
    const cur = new Date(start)
    while (cur <= end) {
      const day = cur.getDate()
      if (cur.getFullYear() === year && cur.getMonth() + 1 === month && workingDaySet.has(day)) {
        if (!result[fullName]) result[fullName] = []
        if (!result[fullName].includes(day)) result[fullName].push(day)
      }
      cur.setDate(cur.getDate() + 1)
    }
  }

  return result
}

export function processUserEvents(
  events: WorkdeckEvent[],
  year: number,
  month: number,
  workingDaySet: Set<number>
): Record<string, Record<number, number>> {
  const result: Record<string, Record<number, number>> = {}

  for (const event of events) {
    if (event.task === null || event.project === null || event.leaveRequest !== null || event.timesheet === true) continue

    const startDate = parseWdDate(event.startAt.split(' ')[0])
    if (startDate.getFullYear() !== year || startDate.getMonth() + 1 !== month) continue

    const day = startDate.getDate()
    if (!workingDaySet.has(day)) continue

    const endDateStr = event.endAt.split(' ')[0]
    const endTimeStr = (event.endAt.split(' ')[1] || '').split(/[+-]/)[0]
    const startTimeStr = (event.startAt.split(' ')[1] || '').split(/[+-]/)[0]

    const endDateObj = parseWdDate(endDateStr)

    let startMs = startDate.getTime()
    let endMs = endDateObj.getTime()

    if (startTimeStr) {
      const [sh, sm, ss] = startTimeStr.split(':').map(Number)
      startMs += (sh * 3600 + sm * 60 + (ss || 0)) * 1000
    }
    if (endTimeStr) {
      const [eh, em, es] = endTimeStr.split(':').map(Number)
      endMs += (eh * 3600 + em * 60 + (es || 0)) * 1000
    }

    const durationHours = Math.round(((endMs - startMs) / 3600000) * 10) / 10
    if (durationHours <= 0) continue

    const projectName = event.project.name
    if (!result[projectName]) result[projectName] = {}
    result[projectName][day] = Math.round(((result[projectName][day] || 0) + durationHours) * 10) / 10
  }

  return result
}
