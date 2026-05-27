---
id: TASK-27
title: >-
  Frontend: scheduled task detail — last run summary, recent history, next run
  time, Run Now button
status: Done
assignee: []
created_date: '2026-05-27 13:40'
updated_date: '2026-05-27 15:17'
labels:
  - frontend
  - ui
  - tdd
milestone: m-0
dependencies:
  - TASK-24
  - TASK-20
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the scheduled task detail page (currently showing config) with run history context.

## New sections in scheduled detail

### Header area (always visible)
```
[ Morning sync ]   enabled   cron: 0 6 * * *
Next run: tomorrow 06:00              [ Run Now ]
Last run: today 06:02 — success — 3m 12s — "Processed 4 PR reviews"
```

### Recent runs (last 5)
```
Recent runs:
  ✓  today 06:02     3m 12s   success   "Processed 4 PR reviews"
  ✓  yesterday 06:01  2m 48s  success   "Reviewed 2 PRs"
  ✗  2026-05-25      —        failed    "git error: no remote"
  ✓  2026-05-24 06:03 4m 01s  success   …
  ✓  2026-05-23 06:00 3m 55s  success   …
  
  [ View all runs → ]   (links to /runs?type=scheduled&schedule_id=X)
```

## Run Now button
- Calls `POST /api/schedules/:id/run` (new endpoint, see TASK-20 / runner.ts)
- Shows spinner while run starts (until a run record with matching schedule_id appears with status=running)
- Disables button if a run for this schedule is already running

## Next run time
- Computed server-side: `GET /api/schedules/:id` returns `next_run_at` (ISO datetime)
- Frontend shows relative + absolute: "tomorrow 06:00 (in 16h 23m)"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Last run shown in header with time, status, duration, ai_title
- [x] #2 Next run time shown (relative + absolute)
- [x] #3 Run Now button present and enabled when no run is currently running
- [x] #4 Run Now button disabled and shows spinner when a run is already running
- [x] #5 Run Now triggers POST and a new run appears in recent runs list
- [x] #6 Recent runs shows last 5 runs for this schedule
- [x] #7 'View all runs' links to /runs filtered by schedule_id
- [x] #8 Tests: rendering with last run data
- [x] #9 Tests: rendering when no runs exist yet ('Never run')
- [x] #10 Tests: Run Now disabled state when run is running
- [x] #11 Tests: next_run_at formatting (relative time)
<!-- AC:END -->
