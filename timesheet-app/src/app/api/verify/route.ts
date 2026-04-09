import { NextRequest, NextResponse } from 'next/server'
import { extractEmployeeData, ParsedReportsRow } from '@/lib/processor'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const maxDuration = 120

interface ProjectResult { project: string; expected: number; actual: number; passed: boolean }
interface EmployeeResult { name: string; passed: boolean; expectedTotal: number; actualTotal: number; projects: ProjectResult[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readTimesheetTotals(buffer: any): Promise<Map<string, number>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return new Map()
  const totals = new Map<string, number>()
  ws.eachRow((row) => {
    const nameCell = row.getCell(1).value
    const name = nameCell ? String(nameCell).trim() : ''
    if (!name || ['PROJECT NAME','LEAVES','OTHER ACTIVITIES'].includes(name) || name.startsWith('Total hours')) return
    // Sum day columns 3..33 directly (avoid formula resolution issues)
    let total = 0
    for (let col = 3; col <= 33; col++) {
      const v = row.getCell(col).value
      if (typeof v === 'number' && v > 0) total += v
    }
    total = Math.round(total * 100) / 100
    if (total > 0) totals.set(name, (totals.get(name) || 0) + total)
  })
  return totals
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const reportsFile    = formData.get('reports') as File | null
    const parsedRowsStr  = formData.get('parsedReports') as string | null
    const zipFile        = formData.get('zip') as File | null
    const monthStr       = formData.get('month') as string | null
    const yearStr        = formData.get('year') as string | null
    if (!reportsFile && !parsedRowsStr)
      return NextResponse.json({ error: 'reports or parsedReports required' }, { status: 400 })
    if (!zipFile || !monthStr || !yearStr)
      return NextResponse.json({ error: 'zip, month and year required' }, { status: 400 })

    const month = parseInt(monthStr)
    const year  = parseInt(yearStr)
    const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long' })

    const reportsInput: ArrayBuffer | ParsedReportsRow[] = parsedRowsStr
      ? (JSON.parse(parsedRowsStr) as ParsedReportsRow[])
      : await reportsFile!.arrayBuffer()
    const employees = extractEmployeeData(reportsInput, month, year)
    const expectedMap = new Map<string, { totalHours: number; projects: Map<string, number> }>()
    for (const emp of employees) {
      const pm = new Map<string, number>()
      for (const p of emp.projects) pm.set(p.project, p.hours)
      expectedMap.set(emp.name, { totalHours: emp.totalHours, projects: pm })
    }

    const zipBuffer = await zipFile.arrayBuffer()
    const zip = await JSZip.loadAsync(zipBuffer)
    const results: EmployeeResult[] = []
    let passCount = 0

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (!filename.endsWith('.xlsx') || zipEntry.dir) continue
      const baseName = filename.split('/').pop()!
        .replace(`_Timesheet_${monthLabel}_${year}.xlsx`, '')
        .replace(/_/g, ' ').trim()

      const matched = Array.from(expectedMap.keys()).find(k =>
        k.replace(/\s+/g, ' ').trim().toLowerCase() === baseName.toLowerCase()
      )
      if (!matched) continue

      const expected = expectedMap.get(matched)!
      const xlsBuf = Buffer.from(await zipEntry.async('arraybuffer'))
      const actualTotals = await readTimesheetTotals(xlsBuf)

      const projectResults: ProjectResult[] = []
      let actualTotal = 0
      for (const [proj, expHours] of Array.from(expected.projects.entries())) {
        const actHours = Math.round((actualTotals.get(proj) || 0) * 100) / 100
        actualTotal += actHours
        projectResults.push({ project: proj, expected: expHours, actual: actHours, passed: Math.abs(actHours - expHours) < 0.1 })
      }
      actualTotal = Math.round(actualTotal * 100) / 100
      const passed = Math.abs(actualTotal - expected.totalHours) < 0.1
      if (passed) passCount++
      results.push({ name: matched, passed, expectedTotal: expected.totalHours, actualTotal, projects: projectResults })
    }

    results.sort((a, b) => (a.passed === b.passed ? a.name.localeCompare(b.name) : a.passed ? 1 : -1))
    return NextResponse.json({ total: results.length, passed: passCount, failed: results.length - passCount, allPassed: passCount === results.length, results })
  } catch (err) {
    console.error('Verify error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Verification failed' }, { status: 500 })
  }
}
