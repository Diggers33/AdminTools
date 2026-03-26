export interface WorkdeckLeaveRequest {
  id: string
  startAt: string
  endAt: string
  halfDay: string | null
  state: 'accepted' | 'pending' | 'denied'
  user: { id: string; firstName: string; lastName: string }
  leaveType: { id: string; name: string }
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
}

export function parseWdDate(s: string): Date {
  const [d, m, y] = s.split('/')
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export function processLeaveRequests(
  requests: WorkdeckLeaveRequest[],
  year: number,
  month: number,
  workingDaySet: Set<number>
): Record<string, number[]> {
  const LEAVE_KEYWORDS = ['annual leave', 'holiday', 'vacation', 'vacacion', 'conge', 'urlaub', 'pto']

  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)

  const result: Record<string, number[]> = {}

  for (const req of requests) {
    if (req.state !== 'accepted') continue

    // Normalize leave type name
    const normalizedType = req.leaveType.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

    const isHoliday = LEAVE_KEYWORDS.some(kw => normalizedType.includes(kw))
    if (!isHoliday) continue

    const fullName = `${req.user.firstName} ${req.user.lastName}`

    // Parse and clamp dates
    let start = parseWdDate(req.startAt.split(' ')[0])
    let end = parseWdDate(req.endAt.split(' ')[0])

    if (end < monthStart || start > monthEnd) continue

    if (start < monthStart) start = new Date(monthStart)
    if (end > monthEnd) end = new Date(monthEnd)

    // Expand to specific day numbers
    const days: number[] = []
    const cur = new Date(start)
    while (cur <= end) {
      const day = cur.getDate()
      if (cur.getFullYear() === year && cur.getMonth() + 1 === month && workingDaySet.has(day)) {
        days.push(day)
      }
      cur.setDate(cur.getDate() + 1)
    }

    if (days.length === 0) continue

    if (!result[fullName]) result[fullName] = []
    for (const d of days) {
      if (!result[fullName].includes(d)) result[fullName].push(d)
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

    // Parse startAt date
    const startDateStr = event.startAt.split(' ')[0]
    const startDate = parseWdDate(startDateStr)

    if (startDate.getFullYear() !== year || startDate.getMonth() + 1 !== month) continue

    const day = startDate.getDate()
    if (!workingDaySet.has(day)) continue

    // Parse endAt for duration calculation
    const endDateStr = event.endAt.split(' ')[0]
    const endTimeStr = (event.endAt.split(' ')[1] || '').split(/[+-]/)[0] // HH:mm:ss before timezone
    const startTimeStr = (event.startAt.split(' ')[1] || '').split(/[+-]/)[0]

    const endDateObj = parseWdDate(endDateStr)
    const startDateObj = parseWdDate(startDateStr)

    // Build full datetime for duration
    let startMs = startDateObj.getTime()
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
