---
id: TASK-25
title: 'Frontend: /runs — global run history page with filters'
status: Done
assignee: []
created_date: '2026-05-27 13:40'
updated_date: '2026-05-27 15:10'
labels:
  - frontend
  - ui
  - tdd
milestone: m-0
dependencies:
  - TASK-24
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New page at `/runs` in the web UI. Added to the nav bar.

## Layout

```
All Runs                [Project ▼] [Type ▼] [Status ▼] [Date range ▼]

  PROJECT           TYPE            STARTED         DURATION   STATUS   TITLE
  agent-state-applet  scheduled     today 06:02     3m 12s     ✓        "Morning sync…"
  daktela-bot         manual/idea   today 08:55     45m        ✓        "Implement…"
  agent-state-applet  manual/ghostty today 09:14    28m        ●        (running)
  …
  
  [← prev]  Page 1 of 4  [next →]
```

## Interactions
- Click on Project name → filter by that project (updates Project dropdown)
- Click on row → navigate to `/runs/:id` (detail, future task or just shows metadata in same row expanded)
- Clicking on scheduled TYPE badge → navigate to that schedule's detail (`/schedules/:id`)
- STATUS column: colored badge — ✓ green (success), ✗ red (failed), ● yellow (running), ○ grey (cancelled)
- DURATION: human-readable (e.g. "3m 12s", "1h 4m") — null shown as "—" for running

## Empty state
"No runs yet. Start a Claude session or trigger a scheduled task."
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Page renders with all runs from GET /api/runs
- [x] #2 Project filter works — selecting a project filters the table
- [x] #3 Type filter works (scheduled / manual / manual_trigger)
- [x] #4 Status filter works
- [x] #5 Date range filter works
- [x] #6 Clicking project name in table sets project filter
- [x] #7 Clicking scheduled TYPE badge navigates to /schedules/:id
- [x] #8 Pagination: prev/next work, correct page count shown
- [x] #9 Running sessions show 'running' badge with live duration (ticking or on load)
- [x] #10 Empty state shown when no runs match filters
- [x] #11 Tests: rendering with mocked API response
- [x] #12 Tests: each filter interaction
- [x] #13 Tests: empty state rendering
- [x] #14 Tests: status badge color mapping
<!-- AC:END -->
