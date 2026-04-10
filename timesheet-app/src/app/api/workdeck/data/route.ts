import { NextRequest, NextResponse } from 'next/server'
import { processLeaveRequests, processUserEvents, extractNonWorkingDays, WorkdeckLeaveRequest } from '@/lib/workdeck'
import { getWorkingDays, matchName } from '@/lib/processor'

export const runtime = 'nodejs'
export const maxDuration = 120

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wd_token')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { month, year, employeeNames } = await req.json() as {
    month: number; year: number; employeeNames: string[]
  }

  const auth = { Authorization: `Bearer ${token}` }
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const workingDaySet = new Set(getWorkingDays(year, month))

  // Fetch users, leave requests, and non-working days in parallel
  const [usersRes, leaveRes, nonWorkingRes] = await Promise.all([
    fetch(`${API}/queries/users-summary`, { headers: auth }),
    fetch(`${API}/queries/leave-requests?start=${start}&end=${end}`, { headers: auth }),
    fetch(`${API}/queries/non-working-days?start=${start}&end=${end}`, { headers: auth }).catch(() => null),
  ])

  const usersText = await usersRes.text()
  const leaveText = await leaveRes.text()
  if (!usersRes.ok) return NextResponse.json({ error: 'Failed to fetch users: ' + usersText.slice(0, 100) }, { status: 502 })
  if (!leaveRes.ok) return NextResponse.json({ error: 'Failed to fetch leave: ' + leaveText.slice(0, 100) }, { status: 502 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let usersRaw: any, leaveRaw: any
  try { usersRaw = JSON.parse(usersText) } catch { usersRaw = {} }
  try { leaveRaw = JSON.parse(leaveText) } catch { leaveRaw = {} }

  // Workdeck wraps responses in { result: [...] }
  const users: { id: string; firstName: string; lastName: string }[] =
    Array.isArray(usersRaw) ? usersRaw : (usersRaw?.result ?? usersRaw?.data ?? [])
  const leaveRequests = Array.isArray(leaveRaw) ? leaveRaw : (leaveRaw?.result ?? leaveRaw?.data ?? [])

  // Parse non-working days (public holidays) for the month
  let publicHolidays: number[] = []
  if (nonWorkingRes?.ok) {
    try {
      const raw = await nonWorkingRes.json()
      const items = Array.isArray(raw) ? raw : (raw?.result ?? raw?.data ?? [])
      publicHolidays = extractNonWorkingDays(items, year, month)
    } catch { /* leave empty */ }
  }

  // Build UUID → full name map
  const uuidToName = new Map<string, string>()
  for (const u of users) uuidToName.set(u.id, `${u.firstName} ${u.lastName}`)
  const wdNames = Array.from(uuidToName.values())

  // Match REPORTS names → Workdeck UUIDs
  const repNameToUUID = new Map<string, string>()
  for (const repName of employeeNames) {
    const matched = matchName(repName, wdNames)
    if (!matched) continue
    const uuid = Array.from(uuidToName.entries()).find(([, n]) => n === matched)?.[0]
    if (uuid) repNameToUUID.set(repName, uuid)
  }

  // Diagnostic: capture raw leave structure before processing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sampleLeave: any = leaveRequests[0] ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaveTypeNames = Array.from(new Set((leaveRequests as any[]).map(r =>
    r.leaveType?.name ?? r.type?.name ?? r.leave_type?.name ?? '?'
  ))).slice(0, 20)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaveStateValues = Array.from(new Set((leaveRequests as any[]).map(r => r.state ?? r.status ?? '?'))).slice(0, 10)

  // Process leave requests → per-employee holiday days
  const holidaysByWdName = processLeaveRequests(leaveRequests, year, month, workingDaySet)

  // Map Workdeck name → REPORTS name
  const holidays: Record<string, number[]> = {}
  for (const [repName, uuid] of Array.from(repNameToUUID.entries())) {
    const wdName = uuidToName.get(uuid)!
    if (holidaysByWdName[wdName]?.length) holidays[repName] = Array.from(new Set(holidaysByWdName[wdName]))
  }

  // Build debug payload (also captures the raw response wrapper keys so we can see the data structure)
  const leaveDebug = {
    total: leaveRequests.length,
    leaveTypeNames,
    leaveStateValues,
    // Keys at the raw response level (to detect wrapper like { result: [] } vs { items: [] })
    rawLeaveKeys: leaveRaw ? Object.keys(leaveRaw).slice(0, 15) : [],
    sampleLeaveKeys: sampleLeave ? Object.keys(sampleLeave).slice(0, 20) : [],
    sampleLeave,
    matchedCount: Object.keys(holidays).length,
  }

  // Fetch calendar events for matched UUIDs in batches of 10
  const matchedUUIDs = Array.from(new Set(Array.from(repNameToUUID.values())))
  const eventsByUUID = new Map<string, unknown[]>()
  for (let i = 0; i < matchedUUIDs.length; i += 10) {
    const batch = matchedUUIDs.slice(i, i + 10)
    const results = await Promise.all(batch.map(async uuid => {
      try {
        const r = await fetch(`${API}/queries/events/user/${uuid}?start=${start}&end=${end}`, { headers: auth })
        const raw = r.ok ? await r.json() : []
        return { uuid, events: Array.isArray(raw) ? raw : (raw?.data ?? []) }
      } catch { return { uuid, events: [] } }
    }))
    for (const { uuid, events } of results) eventsByUUID.set(uuid, events)
  }

  // Process events per employee (meeting/task hours)
  const meetings: Record<string, Record<string, Record<number, number>>> = {}
  for (const [repName, uuid] of Array.from(repNameToUUID.entries())) {
    const events = eventsByUUID.get(uuid) ?? []
    const processed = processUserEvents(events as Parameters<typeof processUserEvents>[0], year, month, workingDaySet)
    if (Object.keys(processed).length > 0) meetings[repName] = processed
  }

  return NextResponse.json({ holidays, meetings, publicHolidays, leaveDebug })
}
