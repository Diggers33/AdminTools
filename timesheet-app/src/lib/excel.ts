import ExcelJS from 'exceljs'
import { EmployeeMonth, getWorkingDays, distributeHours } from './processor'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const HEADER_FILL: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1F3C' } }  // IRIS navy
const MONTH_FILL: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066CC' } }  // IRIS blue
const LEAVES_FILL: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }
const OTHER_FILL: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }
const TOTAL_FILL: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFF8' } }  // IRIS light blue
const WEEKEND_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
const TRAVEL_FILL: ExcelJS.Fill        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC80' } } // amber
const TRAVEL_LEAVES_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFAA40' } } // darker amber for T cells
const HOLIDAY_FILL: ExcelJS.Fill       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } } // soft green for holiday days
const SICK_FILL: ExcelJS.Fill          = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } // soft red for sick days
const PARTIAL_LEAVE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2D0F0' } } // soft purple for partial leave (paternity/maternity)
const PROJECT_FILL: ExcelJS.Fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
const ALT_PROJECT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
const META_LABEL_FILL: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAE3F3' } }

const WHITE_FONT: Partial<ExcelJS.Font>  = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9, name: 'Calibri' }
const BOLD_FONT: Partial<ExcelJS.Font>   = { bold: true, size: 9, name: 'Calibri' }
const NORMAL_FONT: Partial<ExcelJS.Font> = { size: 9, name: 'Calibri' }
const TOTAL_FONT: Partial<ExcelJS.Font>  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF0D1F3C' } }  // IRIS navy

const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const ALL_BORDERS: Partial<ExcelJS.Borders> = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER }
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }
const LEFT: Partial<ExcelJS.Alignment>   = { horizontal: 'left', vertical: 'middle', indent: 1 }

function cell(
  ws: ExcelJS.Worksheet, row: number, col: number,
  value: ExcelJS.CellValue,
  fill: ExcelJS.Fill,
  font: Partial<ExcelJS.Font>,
  alignment: Partial<ExcelJS.Alignment>,
  numFmt?: string
) {
  const c = ws.getCell(row, col)
  c.value = value
  c.fill = fill
  c.font = font
  c.alignment = alignment
  c.border = ALL_BORDERS
  if (numFmt) c.numFmt = numFmt
}

function colLetter(col: number): string {
  let letter = ''
  while (col > 0) {
    const rem = (col - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    col = Math.floor((col - 1) / 26)
  }
  return letter
}

function getWeekendDays(year: number, month: number): Set<number> {
  const daysInMonth = new Date(year, month, 0).getDate()
  const weekends = new Set<number>()
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow === 0 || dow === 6) weekends.add(d)
  }
  return weekends
}

function buildMonthBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  month: number,
  year: number,
  projects: Array<{ project: string; dailyHours: Record<number, number>; travelDays?: Set<number> }>,
  allTravelDays?: Set<number>,
  numProjectRows?: number,
  holidayDays?: Set<number>,
  sickDays?: Set<number>,
  publicHolidays?: Set<number>,
  startDay?: number,
  dailyCap?: number,
  endDay?: number,
  partialLeaveDays?: Map<number, number>
): number {
  const PROJECT_ROWS_PER_BLOCK = numProjectRows ?? Math.max(12, projects.length)
  const daysInMonth = new Date(year, month, 0).getDate()
  const weekends = getWeekendDays(year, month)

  // Row 1: Month label
  ws.getRow(startRow).height = 18
  ws.mergeCells(startRow, 1, startRow, 34)
  cell(ws, startRow, 1, `${MONTHS[month - 1]} ${year}`, MONTH_FILL, { ...WHITE_FONT, size: 10 }, CENTER)

  // Row 2: Column headers
  ws.getRow(startRow + 1).height = 16
  cell(ws, startRow + 1, 1, 'PROJECT NAME', HEADER_FILL, WHITE_FONT, CENTER)
  cell(ws, startRow + 1, 2, 'ID',           HEADER_FILL, WHITE_FONT, CENTER)
  for (let d = 1; d <= 31; d++) {
    const col = d + 2
    const isWknd = weekends.has(d)
    const isInactive = d <= daysInMonth && !isWknd && ((!!startDay && d < startDay) || (!!endDay && d > endDay))
    const isTravelCol = !isInactive && (allTravelDays?.has(d) ?? false)
    const isSickCol = !isWknd && !isInactive && !isTravelCol && (sickDays?.has(d) ?? false)
    const isHolidayCol = !isWknd && !isInactive && !isTravelCol && !isSickCol && (holidayDays?.has(d) ?? false)
    const isPublicHol = !isWknd && !isInactive && !isTravelCol && !isSickCol && !isHolidayCol && (publicHolidays?.has(d) ?? false)
    const label = d <= daysInMonth ? d : null
    const headerFill = (isWknd || isInactive || isPublicHol) ? WEEKEND_FILL : isTravelCol ? TRAVEL_LEAVES_FILL : isSickCol ? SICK_FILL : isHolidayCol ? HOLIDAY_FILL : HEADER_FILL
    const headerFont = (isWknd || isInactive || isPublicHol || isTravelCol || isSickCol || isHolidayCol)
      ? { ...BOLD_FONT, color: { argb: (isWknd || isInactive || isPublicHol) ? 'FF666666' : isTravelCol ? 'FF7D4000' : isSickCol ? 'FF9C0006' : 'FF375623' } }
      : WHITE_FONT
    cell(ws, startRow + 1, col, label, headerFill, headerFont, CENTER)
  }
  cell(ws, startRow + 1, 34, 'TOTAL', HEADER_FILL, WHITE_FONT, CENTER)

  // Row 3: LEAVES
  const leavesRow = startRow + 2
  ws.getRow(leavesRow).height = 15
  cell(ws, leavesRow, 1, 'LEAVES', LEAVES_FILL, BOLD_FONT, LEFT)
  cell(ws, leavesRow, 2, 'LEAVE', LEAVES_FILL, NORMAL_FONT, CENTER)
  for (let d = 1; d <= 31; d++) {
    const col = d + 2
    const isInactive = d <= daysInMonth && !weekends.has(d) && ((!!startDay && d < startDay) || (!!endDay && d > endDay))
    const isTravel = !isInactive && (allTravelDays?.has(d) ?? false)
    const isSick = !isInactive && !isTravel && (sickDays?.has(d) ?? false)
    const isHoliday = !isInactive && !isTravel && !isSick && (holidayDays?.has(d) ?? false)
    const isPublicHol = !isInactive && !isTravel && !isSick && !isHoliday && (publicHolidays?.has(d) ?? false)
    const partialCap = !isInactive && !isTravel && !isSick && !isHoliday ? (partialLeaveDays?.get(d)) : undefined
    const isPartialLeave = partialCap !== undefined
    // Partial leave value is the leave fraction (e.g. 0.5 for 50% paternity)
    const partialLeaveVal = isPartialLeave ? Math.round((1 - partialCap / 8) * 100) / 100 : undefined
    const leaveVal = d <= daysInMonth ? (isTravel ? 'T' : isSick ? 'S' : isHoliday ? 1 : isPartialLeave ? partialLeaveVal! : 0) : null
    const leaveFill = (weekends.has(d) || isInactive || isPublicHol) ? WEEKEND_FILL : isTravel ? TRAVEL_LEAVES_FILL : isSick ? SICK_FILL : isHoliday ? HOLIDAY_FILL : isPartialLeave ? PARTIAL_LEAVE_FILL : LEAVES_FILL
    const leaveFont = isTravel
      ? { ...BOLD_FONT, color: { argb: 'FF7D4000' } }
      : isSick
        ? { ...BOLD_FONT, color: { argb: 'FF9C0006' } }
        : isHoliday
          ? { ...BOLD_FONT, color: { argb: 'FF375623' } }
          : isPartialLeave
            ? { ...BOLD_FONT, color: { argb: 'FF4B0082' } }
            : NORMAL_FONT
    cell(ws, leavesRow, col, leaveVal, leaveFill, leaveFont, CENTER)
  }
  const holidayDayCount = holidayDays ? Array.from(holidayDays).filter(d => d <= daysInMonth).length : 0
  const sickDayCount = sickDays ? Array.from(sickDays).filter(d => d <= daysInMonth).length : 0
  const partialLeaveFrac = partialLeaveDays
    ? Array.from(partialLeaveDays.entries())
        .filter(([d]) => d <= daysInMonth)
        .reduce((s, [, c]) => s + Math.round((1 - c / 8) * 100) / 100, 0)
    : 0
  ws.getCell(leavesRow, 34).value = Math.round((holidayDayCount + sickDayCount + partialLeaveFrac) * 100) / 100
  ws.getCell(leavesRow, 34).fill = LEAVES_FILL
  ws.getCell(leavesRow, 34).font = BOLD_FONT
  ws.getCell(leavesRow, 34).alignment = CENTER
  ws.getCell(leavesRow, 34).border = ALL_BORDERS

  // Rows 4–15: Projects
  for (let i = 0; i < PROJECT_ROWS_PER_BLOCK; i++) {
    const rowNum = startRow + 3 + i
    ws.getRow(rowNum).height = 15
    const proj = projects[i]
    const rowFill = i % 2 === 0 ? PROJECT_FILL : ALT_PROJECT_FILL

    cell(ws, rowNum, 1, proj ? proj.project : '', rowFill, NORMAL_FONT, LEFT)
    cell(ws, rowNum, 2, proj ? proj.project : '', rowFill, NORMAL_FONT, CENTER)

    for (let d = 1; d <= 31; d++) {
      const col = d + 2
      const isInactive = d <= daysInMonth && !weekends.has(d) && ((!!startDay && d < startDay) || (!!endDay && d > endDay))
      const isMyTravel = !isInactive && (proj?.travelDays?.has(d) ?? false)
      const isOtherTravel = !isInactive && !isMyTravel && (allTravelDays?.has(d) ?? false)
      const isSick = !isInactive && (sickDays?.has(d) ?? false)
      const isHoliday = !isInactive && !isSick && (holidayDays?.has(d) ?? false)
      const isPublicHol = !isInactive && !isSick && !isHoliday && (publicHolidays?.has(d) ?? false)
      const fill = weekends.has(d) ? WEEKEND_FILL : isInactive ? WEEKEND_FILL : isMyTravel ? TRAVEL_FILL : isSick ? SICK_FILL : (isOtherTravel || isHoliday || isPublicHol) ? WEEKEND_FILL : rowFill
      const rawVal = proj && d <= daysInMonth ? ((isHoliday || isSick || isPublicHol || isInactive) ? 0 : proj.dailyHours[d] ?? 0) : null
      const val = rawVal
      const font = isMyTravel ? { ...BOLD_FONT, color: { argb: 'FF7D4000' } } : NORMAL_FONT
      cell(ws, rowNum, col, val, fill, font, CENTER, val && val > 0 ? '0.##;-0.##;0' : undefined)
    }

    const tc = ws.getCell(rowNum, 34)
    const projTotal = proj ? Object.values(proj.dailyHours).reduce((s, h) => s + h, 0) : 0
    tc.value = projTotal
    tc.fill = rowFill; tc.font = BOLD_FONT; tc.alignment = CENTER; tc.border = ALL_BORDERS
  }

  // Row 16: Other Activities — fills to cap on working days (cap - project hours, min 0)
  const otherRow = startRow + 3 + PROJECT_ROWS_PER_BLOCK
  const cap = dailyCap ?? 8
  const dayCapFor = (d: number) => partialLeaveDays?.get(d) ?? cap
  const workingDaySet = new Set(
    getWorkingDays(year, month, publicHolidays?.size ? publicHolidays : undefined)
      .filter(d => (!startDay || d >= startDay) && (!endDay || d <= endDay))
  )
  ws.getRow(otherRow).height = 15
  cell(ws, otherRow, 1, 'OTHER ACTIVITIES', OTHER_FILL, BOLD_FONT, LEFT)
  cell(ws, otherRow, 2, '', OTHER_FILL, NORMAL_FONT, CENTER)
  let otherTotal = 0
  for (let d = 1; d <= 31; d++) {
    let val: number | null = null
    const isHoliday = holidayDays?.has(d) ?? false
    const isSick = sickDays?.has(d) ?? false
    const isPublicHol = publicHolidays?.has(d) ?? false
    const isInactive = d <= daysInMonth && !weekends.has(d) && ((!!startDay && d < startDay) || (!!endDay && d > endDay))
    if (d <= daysInMonth && !weekends.has(d)) {
      if (workingDaySet.has(d) && !isHoliday && !isSick) {
        const projSum = projects.reduce((s, p) => s + (p.dailyHours[d] ?? 0), 0)
        val = Math.max(0, dayCapFor(d) - projSum)
        otherTotal += val
      } else {
        val = 0 // public holiday, sick leave, annual leave, or inactive day
      }
    } else if (d <= daysInMonth) {
      val = 0 // weekend
    }
    const otherFill = (weekends.has(d) || isPublicHol || isInactive) ? WEEKEND_FILL : isSick && d <= daysInMonth ? SICK_FILL : isHoliday && d <= daysInMonth ? HOLIDAY_FILL : OTHER_FILL
    cell(ws, otherRow, d + 2, val, otherFill, NORMAL_FONT, CENTER)
  }
  const otc = ws.getCell(otherRow, 34)
  otc.value = otherTotal
  otc.fill = OTHER_FILL; otc.font = BOLD_FONT; otc.alignment = CENTER; otc.border = ALL_BORDERS

  // Row 17: Total
  const totalRow = startRow + 3 + PROJECT_ROWS_PER_BLOCK + 1
  ws.getRow(totalRow).height = 16
  cell(ws, totalRow, 1, 'Total hours (including overtime)', TOTAL_FILL, TOTAL_FONT, LEFT)
  cell(ws, totalRow, 2, '', TOTAL_FILL, TOTAL_FONT, CENTER)
  // Compute daily totals: project hours + other activities (no formulas — avoids numFmt dot bug)
  let grandTotal = 0
  for (let d = 1; d <= 31; d++) {
    const col = d + 2
    const tc = ws.getCell(totalRow, col)
    const isHoliday = holidayDays?.has(d) ?? false
    const isSick = sickDays?.has(d) ?? false
    const isPublicHol = publicHolidays?.has(d) ?? false
    const isInactive = d <= daysInMonth && !weekends.has(d) && ((!!startDay && d < startDay) || (!!endDay && d > endDay))
    if (d <= daysInMonth) {
      const projSum = (isHoliday || isSick || isPublicHol || isInactive) ? 0 : projects.reduce((s, p) => s + (p.dailyHours[d] ?? 0), 0)
      const otherVal = (!weekends.has(d) && workingDaySet.has(d) && !isHoliday && !isSick) ? Math.max(0, dayCapFor(d) - projSum) : 0
      const daySum = projSum + otherVal
      tc.value = daySum
      grandTotal += daySum
    }
    tc.fill = (weekends.has(d) || isPublicHol || isInactive) ? WEEKEND_FILL : isSick ? SICK_FILL : isHoliday ? HOLIDAY_FILL : TOTAL_FILL
    tc.font = TOTAL_FONT; tc.alignment = CENTER; tc.border = ALL_BORDERS
  }
  const gtc = ws.getCell(totalRow, 34)
  gtc.value = grandTotal
  gtc.fill = TOTAL_FILL; gtc.font = TOTAL_FONT; gtc.alignment = CENTER; gtc.border = ALL_BORDERS

  return totalRow + 2 // next block start (one blank row gap)
}

export async function generateTimesheet(
  employee: EmployeeMonth,
  month: number,
  year: number
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'IRIS Timesheet Generator'
  workbook.created = new Date()

  const ws = workbook.addWorksheet(employee.name.substring(0, 31), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }]
  })

  ws.getColumn(1).width = 30
  ws.getColumn(2).width = 10
  for (let d = 1; d <= 31; d++) ws.getColumn(d + 2).width = 4.2
  ws.getColumn(34).width = 7

  // ── Header block ──────────────────────────────────
  ws.getRow(1).height = 8

  ws.getRow(2).height = 24
  ws.mergeCells(2, 1, 2, 34)
  cell(ws, 2, 1, 'IRIS Technology Solutions — Monthly Timesheet', HEADER_FILL, { ...WHITE_FONT, size: 12 }, CENTER)

  ws.getRow(3).height = 18
  ws.mergeCells(3, 1, 3, 4)
  cell(ws, 3, 1, 'Employee', META_LABEL_FILL, BOLD_FONT, LEFT)
  ws.mergeCells(3, 5, 3, 17)
  cell(ws, 3, 5, employee.name, PROJECT_FILL, { ...BOLD_FONT, color: { argb: 'FF1F3864' } }, LEFT)
  ws.mergeCells(3, 18, 3, 22)
  cell(ws, 3, 18, 'Approved By', META_LABEL_FILL, BOLD_FONT, LEFT)
  ws.mergeCells(3, 23, 3, 34)
  cell(ws, 3, 23, 'Colm Digby', PROJECT_FILL, BOLD_FONT, LEFT)

  ws.getRow(4).height = 18
  ws.mergeCells(4, 1, 4, 4)
  cell(ws, 4, 1, 'Year', META_LABEL_FILL, BOLD_FONT, LEFT)
  ws.mergeCells(4, 5, 4, 17)
  cell(ws, 4, 5, year, PROJECT_FILL, { ...BOLD_FONT, color: { argb: 'FF1F3864' } }, LEFT)

  ws.getRow(5).height = 8

  // ── Distribute hours with travel awareness ────────────
  const publicHolidays = employee.publicHolidays?.size ? employee.publicHolidays : undefined
  const dailyCap = employee.dailyCap ?? 8
  const startDay = employee.startDay
  const endDay = employee.endDay
  // Exclude public holidays and days outside the employee's active range
  const workingDays = getWorkingDays(year, month, publicHolidays)
    .filter(d => (!startDay || d >= startDay) && (!endDay || d <= endDay))
  const workingDaySet = new Set(workingDays)
  const PROJECT_ROWS_PER_BLOCK = Math.max(12, employee.projects.length)
  const capped = employee.projects.slice(0, PROJECT_ROWS_PER_BLOCK)
  const travelDays = employee.travelDays || {}
  const holidayDays = employee.holidayDays || new Set<number>()
  const sickDays = employee.sickDays || new Set<number>()
  const partialLeaveDays = employee.partialLeaveDays

  // Collect ALL travel days across all projects — employee is unavailable for other projects on these days
  const allTravelDays = new Set<number>()
  for (const days of Object.values(travelDays)) {
    for (const d of Array.from(days)) if (workingDaySet.has(d)) allTravelDays.add(d)
  }

  // Step 1: pin travel days at dailyCap on the travel project; zero out all other projects on those days.
  // If multiple projects claim the same travel day (data error), only the first project wins.
  const travelDayOwner = new Map<number, number>()
  const dayCapFor = (d: number) => partialLeaveDays?.get(d) ?? dailyCap

  for (let i = 0; i < capped.length; i++) {
    const myTravelDays = travelDays[capped[i].project]
    if (!myTravelDays) continue
    for (const d of Array.from(myTravelDays)) {
      if (workingDaySet.has(d) && !travelDayOwner.has(d)) travelDayOwner.set(d, i)
    }
  }
  const projectDailyHours: Array<Record<number, number>> = capped.map((p, i) => {
    const pinned: Record<number, number> = {}
    const myTravelDays = travelDays[p.project]
    if (myTravelDays) {
      for (const d of Array.from(myTravelDays)) {
        if (workingDaySet.has(d) && travelDayOwner.get(d) === i) pinned[d] = dayCapFor(d)
      }
    }
    // Zero out all travel days not owned by this project
    for (const d of Array.from(allTravelDays)) {
      if (pinned[d] === undefined) pinned[d] = 0
    }
    return pinned
  })

  // Step 2: spread remaining hours across non-travel working days only
  // Process projects one at a time, tracking how many hours each free day already has
  // so we never exceed 8h/day and never lose hours.
  // Holiday days are blocked from project distribution (like travel days)
  const freeDays = workingDays.filter(d => !allTravelDays.has(d) && !holidayDays.has(d) && !sickDays.has(d))
  // Track daily capacity remaining across all projects
  const dayRemaining: Record<number, number> = {}
  for (const d of freeDays) dayRemaining[d] = dayCapFor(d)

  const meetingHours = employee.meetingHours || {}

  // Pre-pin meeting hours to specific project/day combos before hour distribution
  const freeDaySet = new Set(freeDays)
  for (let i = 0; i < capped.length; i++) {
    const projMeetings = meetingHours[capped[i].project]
    if (!projMeetings) continue
    for (const [dayStr, hrs] of Object.entries(projMeetings)) {
      const day = Number(dayStr)
      if (!freeDaySet.has(day)) continue
      projectDailyHours[i][day] = Math.round(((projectDailyHours[i][day] ?? 0) + hrs) * 10) / 10
      dayRemaining[day] = Math.round((Math.max(0, (dayRemaining[day] ?? dailyCap) - hrs)) * 10) / 10
    }
  }

  for (let i = 0; i < capped.length; i++) {
    const { hours } = capped[i]
    const pinned = projectDailyHours[i]

    // Pre-allocated travel hours for this project
    const travelHours = Object.entries(pinned)
      .filter(([, h]) => h >= dailyCap)
      .reduce((s, [, h]) => s + h, 0)
    const pinnedMeetingHrs = Object.entries(meetingHours[capped[i].project] || {})
      .filter(([d]) => freeDaySet.has(Number(d)))
      .reduce((s, [, h]) => s + h, 0)
    let remaining = Math.max(0, Math.round((hours - travelHours - pinnedMeetingHrs) * 10) / 10)

    if (remaining <= 0 || freeDays.length === 0) continue

    // Pass 1: use distributeHours for realistic pattern, respecting per-day capacity
    const availableDays = freeDays.filter(d => (dayRemaining[d] ?? 0) > 0)
    if (availableDays.length > 0) {
      const spread = distributeHours(remaining, availableDays, year, month)
      for (const d of availableDays) {
        const want = spread[d] ?? 0
        if (want <= 0) continue
        const cap = dayRemaining[d] ?? 0
        const assign = Math.min(want, cap)
        if (assign > 0) {
          pinned[d] = Math.round(((pinned[d] ?? 0) + assign) * 10) / 10
          dayRemaining[d] = Math.round((dayRemaining[d] - assign) * 10) / 10
          remaining = Math.round((remaining - assign) * 10) / 10
        }
      }
    }

    // Pass 2: mop up any remaining hours — iterate days sorted by most capacity first
    // Keep looping until remaining is zero or no capacity left
    let safetyIter = 0
    while (remaining >= 0.5 && safetyIter++ < freeDays.length * 4) {
      const sorted = [...freeDays].sort((a, b) => (dayRemaining[b] ?? 0) - (dayRemaining[a] ?? 0))
      let progress = false
      for (const d of sorted) {
        if (remaining < 0.5) break
        const cap = dayRemaining[d] ?? 0
        if (cap < 0.5) continue
        const assign = Math.min(remaining, cap)
        pinned[d] = Math.round(((pinned[d] ?? 0) + assign) * 10) / 10
        dayRemaining[d] = Math.round((dayRemaining[d] - assign) * 10) / 10
        remaining = Math.round((remaining - assign) * 10) / 10
        progress = true
      }
      if (!progress) break
    }

    // Pass 3: absolute last resort — if days are all at 8h, allow stacking beyond 8 on the first day
    // (would indicate data error: more hours assigned than working days × 8h can hold)
    if (remaining >= 0.5) {
      const firstDay = freeDays[0]
      pinned[firstDay] = Math.round(((pinned[firstDay] ?? 0) + remaining) * 10) / 10
    }
  }

  const projectsWithHours = capped.map((p, i) => ({
    project: p.project,
    dailyHours: projectDailyHours[i],
    travelDays: travelDays[p.project] instanceof Set ? travelDays[p.project] as Set<number> : new Set<number>(Array.from(travelDays[p.project] || []))
  }))
  buildMonthBlock(ws, 6, month, year, projectsWithHours, allTravelDays, PROJECT_ROWS_PER_BLOCK, holidayDays, sickDays, publicHolidays, startDay, dailyCap, endDay, partialLeaveDays)

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}
