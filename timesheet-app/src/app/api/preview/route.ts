import { NextRequest, NextResponse } from 'next/server'
import { parseReportsFile, extractEmployeeData, getWorkingDays, ParsedReportsRow } from '@/lib/processor'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const reportsFile   = formData.get('reports') as File | null
    const travelFile    = formData.get('travel') as File | null
    const leaveFile     = formData.get('leave') as File | null
    const monthStr      = formData.get('month') as string | null
    const yearStr       = formData.get('year') as string | null
    const parsedRowsStr = formData.get('parsedReports') as string | null

    if (!reportsFile && !parsedRowsStr) return NextResponse.json({ error: 'No reports file uploaded' }, { status: 400 })

    const reportsBuffer = reportsFile ? await reportsFile.arrayBuffer() : null

    if (!monthStr || !yearStr) {
      const { employees, months } = parseReportsFile(reportsBuffer!)
      return NextResponse.json({ employees, months })
    }

    const month = parseInt(monthStr)
    const year  = parseInt(yearStr)
    const travelBuffer = travelFile ? await travelFile.arrayBuffer() : null
    const leaveBuffer  = leaveFile  ? await leaveFile.arrayBuffer()  : null
    const sickFile     = formData.get('sick') as File | null
    const sickBuffer   = sickFile   ? await sickFile.arrayBuffer()   : null
    const reportsInput: ArrayBuffer | ParsedReportsRow[] = parsedRowsStr
      ? (JSON.parse(parsedRowsStr) as ParsedReportsRow[])
      : reportsBuffer!

    const employees = extractEmployeeData(reportsInput, month, year, travelBuffer, leaveBuffer, null, sickBuffer)

    if (employees.length === 0) {
      return NextResponse.json({ error: `No employee data found for ${month}/${year}` }, { status: 404 })
    }

    // Summarise travel info for preview (count travel days per employee)
    const workingDayCount = getWorkingDays(year, month).length
    const employeesForPreview = employees.map(e => {
      const blockedDays = e.sickDays.size + e.holidayDays.size
      const maxAvailableHours = Math.max(0, workingDayCount - blockedDays) * 8
      return {
        name: e.name,
        projects: e.projects,
        totalHours: e.totalHours,
        travelDayCount: Object.values(e.travelDays).reduce((s, days) => s + days.size, 0),
        holidayDayCount: e.holidayDays.size,
        sickDayCount: e.sickDays.size,
        maxAvailableHours,
        hoursAnomaly: e.totalHours > maxAvailableHours,
      }
    })

    return NextResponse.json({ employees: employeesForPreview, month, year })
  } catch (err) {
    console.error('Preview error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to process file' }, { status: 500 })
  }
}
