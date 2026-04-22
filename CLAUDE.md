# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Internal Admin Tools** — A Next.js web application serving two tools:
1. **Timesheet Generator** — Auto-populates employee timesheet Excel files from monthly REPORTS data, enriched with leave/travel/holiday data.
2. **Approval Checker** — Views approved expenses and purchase requests from the Workdeck API.

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

### Entry Point
`src/app/page.tsx` manages top-level state (`activeTool`) and renders one of three views: `LandingPage` (tool selection), the Timesheet Generator UI, or the Workdeck Approval Checker. The landing page is `src/components/LandingPage.tsx`.

### Tool 1: Timesheet Generator

**Input files (all multipart form uploads):**
- **REPORTS** (required) — sheet `DATOS`, columns: `Project`, `Fecha`, `Hours`, `Nombre`, `Apellido`
- **VIAJES** (optional) — travel days file, parsed by `parseTravelFile()`
- **Leave file** (optional) — annual leave/holidays, parsed by `parseLeaveFile()`
- **Sick leave file** (optional) — from sheet `LISTA ALTAS_BAJAS` → `TABLAS`, parsed by `parseSickLeaveFile()`

**Core flow:**
1. User uploads files; `/api/preview` parses them and returns available months + employee list.
2. User selects a month; the UI shows per-employee project/hour distribution.
3. If Workdeck is authenticated, `/api/workdeck/data` is called **non-blocking** to enrich with holidays, meetings, and leave. Returns `{ holidays, meetings, publicHolidays, leaveDebug }`.
4. `/api/generate` generates a ZIP of per-employee Excel timesheets.
5. `/api/verify` optionally validates generated timesheets against source data.

All three API routes (`preview`, `generate`, `verify`) accept raw multipart form data (`bodyParser: false` in `next.config.js`).

**Key files:**
- **`src/lib/processor.ts`** — All data logic: `parseReportsFile()`, `parseTravelFile()`, `parseLeaveFile()`, `parseSickLeaveFile()`, `extractEmployeeData()`, `distributeHours()`, `matchName()`, `getWorkingDays()`, `processLeaveRequests()`, `processUserEvents()`, `extractNonWorkingDays()`.
- **`src/lib/excel.ts`** — Excel workbook generation (ExcelJS). Cell colors: travel days → amber, public holidays → green, sick days → red, weekends → gray. A `LEAVES` row encodes: `T` = travel, `S` = sick, `1` = holiday, `0` = working day. Approver name "Colm Digby" is hardcoded.
- **`src/lib/workdeck.ts`** — Shared Workdeck types and date/leave-processing utilities used by both Workdeck API routes.

**`EmployeeMonth` interface key fields:** `travelDays` (project→days map), `publicHolidays` (set of day numbers), `sickDays`, `meetingHours` (per-project per-day), `startDay`/`endDay` (active date range), `dailyCap` (max hours/day, default 8 for reduced schedules).

**Fuzzy matching:** `matchName()` uses token-overlap scoring (60% threshold) for employee names between VIAJES/leave files and REPORTS. Project name matching normalizes case, strips hyphens/spaces, and removes trailing version numbers.

**Hour Distribution Algorithm** (`distributeHours()` in `processor.ts`):
- Travel days get 8h on the travel project, blocking all other projects that day
- Small projects (≤15h): clustered in consecutive days
- Large projects (>15h): spread across month with ~15–20% skip rate
- Final pass reconciles to exact totals in 0.5h increments
- Seeded pseudo-random algorithm ensures reproducibility per employee/month

**Customization points:**
- **Spanish public holidays**: `SPANISH_HOLIDAYS` constant in `processor.ts`
- **Daily hour cap** (default 8h): `excel.ts` approx. line 157
- **Approver name**: hardcoded `"Colm Digby"` in `excel.ts`

### Tool 2: Approval Checker (Workdeck)

**Components:**
- **`src/components/LoginPage.tsx`** — Email/password form that calls `/api/workdeck/login`; shown when not authenticated.
- **`src/components/ApprovalsSection.tsx`** — Multi-month/year picker, filter by expense/purchase type, sortable table with Excel export.

**API routes:**
- **`/api/workdeck/login`** — POSTs credentials to Workdeck `POST /auth/login`, stores bearer token in `httpOnly` cookie `wd_token` (8h TTL).
- **`/api/workdeck/logout`** — Clears `wd_token` cookie.
- **`/api/workdeck/approvals`** — Fetches expenses (`/queries/expenses`) and purchases (`/queries/purchases?status=5/6/7`) in parallel, filters by approval status and selected months, enriches each via event stream (`/queries/expense-stream/{id}` or `/queries/purchase-stream/{id}`) to extract approver name and approval date. Batched in groups of 10.
- **`/api/workdeck/data`** — Fetches users, leave requests, and non-working days; fuzzy-matches REPORTS employee names to Workdeck UUIDs; returns holiday/meeting/public-holiday data for timesheet enrichment. Includes `leaveDebug` payload for diagnosing API structure changes.

**Auth flow:** Credentials never stored client-side. `wd_token` cookie forwarded server-side on every Workdeck API call.

**Approved status logic:** Purchases approved at status codes 3, 5, 6, or 7 (numeric) or strings `approved`, `accepted`, `approved_by_manager`. Expenses use the same string check.

## Environment

`timesheet-app/.env.local` sets `WORKDECK_API_URL=https://api.workdeck.com` (also used as the code fallback default).

## Deployment

Deployed to Vercel. Timeouts configured in `vercel.json`: `generate` → 300s (requires Vercel Pro), `preview` → 60s. The `verify` and `approvals` routes export `maxDuration = 120` in code (Next.js route segment config) but are not listed in `vercel.json`.
