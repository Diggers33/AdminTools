# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Internal Admin Tools** — A Next.js web application serving two tools:
1. **Timesheet Verification Tool** — Auto-populates employee timesheet Excel files from monthly REPORTS data.
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
`src/app/page.tsx` renders `LandingPage` (tool selection) or one of two tool views based on state. The landing page is `src/components/LandingPage.tsx`.

### Tool 1: Timesheet Generator

Core flow:
1. User uploads a **REPORTS** Excel file (required, sheet: `DATOS`, columns: `Project`, `Fecha`, `Hours`, `Nombre`, `Apellido`) and optionally a **VIAJES** travel file.
2. `/api/preview` parses the file and returns available months + employee list.
3. User selects a month; the UI shows per-employee project/hour distribution.
4. `/api/generate` generates a ZIP of per-employee Excel timesheets.
5. `/api/verify` optionally validates generated timesheets against the source data.

Key files:
- **`src/lib/processor.ts`** — Core data logic: `parseReportsFile()`, `extractEmployeeData()`, `distributeHours()`. The `distributeHours()` function uses a seeded pseudo-random algorithm (reproducible per employee/month) with day-of-week weighting and block-size preferences, capped at 8h/day.
- **`src/lib/excel.ts`** — Excel workbook generation using ExcelJS. Contains IRIS brand colors and all formatting logic.
- **`src/app/api/`** — API routes `preview`, `generate`, `verify` all accept raw multipart form data (`bodyParser: false` in `next.config.js`).

**Fuzzy Matching:** Employee name matching between VIAJES and REPORTS uses token-overlap scoring (threshold: 60%). Project name matching normalizes case, strips hyphens/spaces, and removes trailing version numbers before comparing.

**Hour Distribution Algorithm** (`distributeHours()` in `processor.ts`):
- Travel days get 8h on the travel project, blocking all other projects that day
- Small projects (≤15h): clustered in consecutive days
- Large projects (>15h): spread across month with ~15–20% skip rate
- Final pass reconciles to exact totals in 0.5h increments

Customization points:
- **Spanish public holidays**: `SPANISH_HOLIDAYS` constant in `processor.ts`
- **Daily hour cap** (default 8h): `excel.ts` line ~157
- **Approver name** pre-filled as "Colm Digby" in `excel.ts`

### Tool 2: Approval Checker (Workdeck)

Fetches approved expenses and purchase requests from the Workdeck REST API.

Key files:
- **`src/components/ApprovalsSection.tsx`** — Client UI: month/year picker (multi-select), filter by type, sortable table.
- **`src/lib/workdeck.ts`** — Shared types and date/leave-processing utilities.
- **`src/app/api/workdeck/login/route.ts`** — POSTs credentials to `POST /auth/login`, stores the bearer token in an `httpOnly` cookie (`wd_token`, 8h TTL).
- **`src/app/api/workdeck/logout/route.ts`** — Clears the `wd_token` cookie.
- **`src/app/api/workdeck/approvals/route.ts`** — Main data route. Fetches expenses (`/queries/expenses`) and purchases (`/queries/purchases?status=5/6/7`) in parallel, filters by approval status and selected months, then enriches each item by fetching its event stream (`/queries/expense-stream/{id}` or `/queries/purchase-stream/{id}`) to extract the approver name and approval date. Results are batched in groups of 10 to avoid rate limits.

**Auth flow:** Credentials are never stored client-side. The `wd_token` cookie is forwarded server-side on every Workdeck API call. The `WORKDECK_API_URL` env var overrides the default `https://api.workdeck.com`.

**Approved status logic:** Purchases are approved at status codes 3, 5, 6, or 7 (numeric) or string values `approved`, `accepted`, `approved_by_manager`. Expenses use the same string check.

## Deployment

Deployed to Vercel. The `generate` API requires 300s timeout (Vercel Pro). The `approvals` API sets `maxDuration = 120`. Config in `vercel.json`.
