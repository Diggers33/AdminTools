# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**IRIS Timesheet Generator** — A Next.js web application that auto-populates employee timesheet Excel files from monthly REPORTS data. Processes employee hours, projects, and travel data to generate formatted Excel timesheets.

The actual app lives in the `timesheet-app/` subdirectory.

## Commands

```bash
cd timesheet-app

npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build
npm start            # Run production server
```

There are no tests or linting configured.

## Architecture

### Core Flow
1. User uploads a **REPORTS** Excel file (required, sheet: `DATOS`, columns: `Project`, `Fecha`, `Hours`, `Nombre`, `Apellido`) and optionally a **VIAJES** travel file.
2. `/api/preview` parses the file and returns available months + employee list.
3. User selects a month; the UI shows per-employee project/hour distribution.
4. `/api/generate` generates a ZIP of per-employee Excel timesheets.
5. `/api/verify` optionally validates generated timesheets against the source data.

### Key Files

- **`src/app/page.tsx`** — 5-step wizard UI (upload → configure → preview → generate → verify). All client state lives here.
- **`src/lib/processor.ts`** — Core data logic: `parseReportsFile()`, `extractEmployeeData()`, `distributeHours()`. The `distributeHours()` function uses a seeded pseudo-random algorithm (reproducible per employee/month) with day-of-week weighting and block-size preferences, capped at 8h/day.
- **`src/lib/excel.ts`** — Excel workbook generation using ExcelJS. Contains IRIS brand colors and all formatting logic.
- **`src/app/api/`** — Three API routes: `preview`, `generate`, `verify`. All accept raw multipart form data (`bodyParser: false` in `next.config.js`).

### Fuzzy Matching
Employee name matching between VIAJES and REPORTS uses token-overlap scoring (threshold: 60%). Project name matching normalizes case, strips hyphens/spaces, and removes trailing version numbers before comparing.

### Hour Distribution Algorithm
`distributeHours()` in `processor.ts`:
- Travel days get 8h on the travel project, blocking all other projects that day
- Small projects (≤15h): clustered in consecutive days
- Large projects (>15h): spread across month with ~15–20% skip rate
- Final pass reconciles to exact totals in 0.5h increments

## Customization Points

- **Spanish public holidays**: `SPANISH_HOLIDAYS` constant in `processor.ts`
- **Daily hour cap** (default 8h): `excel.ts` line ~157
- **Approver name** pre-filled as "Colm Digby" in `excel.ts`

## Deployment

Deployed to Vercel. The `generate` API requires 300s timeout (Vercel Pro). Config in `vercel.json`.
