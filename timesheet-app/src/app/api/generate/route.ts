import { NextRequest, NextResponse } from 'next/server'
import { extractEmployeeData } from '@/lib/processor'
import { generateTimesheet } from '@/lib/excel'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const reportsFile      = formData.get('reports') as File | null
    const travelFile       = formData.get('travel') as File | null
    const leaveFile        = formData.get('leave') as File | null
    const monthStr         = formData.get('month') as string | null
    const yearStr          = formData.get('year') as string | null
    const selectedStr      = formData.get('selectedEmployees') as string | null

    if (!reportsFile) return NextResponse.json({ error: 'Reports file required' }, { status: 400 })
    if (!monthStr || !yearStr) return NextResponse.json({ error: 'Month and year required' }, { status: 400 })

    const month = parseInt(monthStr)
    const year  = parseInt(yearStr)
    const selected: string[] | null = selectedStr ? JSON.parse(selectedStr) : null

    const reportsBuffer = await reportsFile.arrayBuffer()
    const travelBuffer  = travelFile ? await travelFile.arrayBuffer() : null
    const leaveBuffer   = leaveFile  ? await leaveFile.arrayBuffer()  : null
    const sickFile      = formData.get('sick') as File | null
    const sickBuffer    = sickFile   ? await sickFile.arrayBuffer()   : null
    const workdeckDataStr = formData.get('workdeckData') as string | null
    const workdeckData = workdeckDataStr ? JSON.parse(workdeckDataStr) : null

    let employees = extractEmployeeData(reportsBuffer, month, year, travelBuffer, leaveBuffer, workdeckData, sickBuffer)
    if (selected && selected.length > 0) {
      const sel = new Set(selected)
      employees = employees.filter(e => sel.has(e.name))
    }
    if (employees.length === 0) return NextResponse.json({ error: 'No matching employees found' }, { status: 404 })

    const monthName = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long' })
    const zip = new JSZip()
    const folder = zip.folder(`Timesheets_${monthName}_${year}`)!

    for (const employee of employees) {
      try {
        const buf = await generateTimesheet(employee, month, year)
        const safe = employee.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_')
        folder.file(`${safe}_Timesheet_${monthName}_${year}.xlsx`, buf)
      } catch (e) {
        console.error(`Failed for ${employee.name}:`, e)
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    return new NextResponse(zipBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="Timesheets_${monthName}_${year}.zip"`,
        'Content-Length': String(zipBuffer.length)
      }
    })
  } catch (err) {
    console.error('Generate error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to generate timesheets' }, { status: 500 })
  }
}
