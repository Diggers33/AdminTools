# IRIS Timesheet Generator

A web app that auto-populates employee timesheet Excel files from your monthly REPORTS data.

## What it does

1. You upload the monthly REPORTS file (with the DATOS sheet)
2. Select the month/year to process
3. Preview every employee's projects and hours
4. Click Generate — downloads a ZIP with one populated timesheet per employee

Hours are spread across working days (Mon–Fri, Spanish public holidays excluded), capped at 8h/day across all projects.

---

## Local Development

### Requirements
- Node.js 18+
- npm or yarn

### Install & run
```bash
npm install
npm run dev
```
App runs at http://localhost:3000

---

## Deploy to Vercel (free)

### Option A: Vercel CLI (fastest)
```bash
npm install -g vercel
vercel
```
Follow the prompts. Vercel auto-detects Next.js.

### Option B: GitHub + Vercel UI
1. Push this folder to a GitHub repo
2. Go to https://vercel.com → New Project
3. Import your repo
4. Deploy (zero config needed)

### Important: Increase function timeout
In `vercel.json` (already included), the generate API is set to 300s timeout (Vercel Pro) or 60s (Hobby). For large employee sets on the free tier, process in batches using the employee selection checkboxes.

---

## File Requirements

### REPORTS file
- Must have a sheet named **DATOS**
- Required columns: `Project`, `Fecha` (date), `Hours`, `Nombre`, `Apellido`

### Timesheet Template
- The blank Ana Pascual template (or any employee timesheet)
- Must have sheets: `PROJECT ID`, `USER ID`, and one main timesheet sheet
- The app renames the main sheet to each employee's name

---

## Customisation

### Add more public holidays
Edit `src/lib/processor.ts` → `SPANISH_HOLIDAYS` object.

### Change daily hour cap (default: 8h)
Edit `src/lib/excel.ts` → the `if (total > 8)` check in `populateTimesheet`.

### Change how hours are distributed
Edit `src/lib/processor.ts` → `distributeHours` function.
Current strategy: even spread across all working days, front-loaded for remainder 0.5h increments.

---

## Tech Stack
- Next.js 14 (App Router)
- ExcelJS (Excel file manipulation)
- SheetJS/xlsx (reading source data)
- JSZip (ZIP generation)
- Deployed on Vercel
