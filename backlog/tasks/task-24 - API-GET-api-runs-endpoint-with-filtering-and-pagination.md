---
id: TASK-24
title: 'API: GET /api/runs endpoint with filtering and pagination'
status: To Do
assignee: []
created_date: '2026-05-27 13:39'
labels:
  - backend
  - api
  - tdd
milestone: m-0
dependencies:
  - TASK-19
  - TASK-23
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose run history via HTTP API.

## Endpoints

`GET /api/runs`
Query params:
- `project` — filter by project_root (exact or prefix match)
- `type` — `scheduled` | `manual` | `manual_trigger`
- `status` — `running` | `success` | `failed` | `cancelled`
- `since` — ISO datetime, filter started_at >= since
- `until` — ISO datetime, filter started_at <= until
- `limit` — default 50, max 200
- `offset` — for pagination

Response: `{ runs: Run[], total: number }`

`GET /api/runs/:id`
Response: single Run object

## Run object shape
```
{
  id, schedule_id, pid, session_id,
  project_root, launch_type, terminal_type,
  started_at, finished_at, duration_ms,
  status, ai_title,
  schedule_name  // joined from schedules table if schedule_id set
}
```

`duration_ms` computed as `finished_at - started_at` (null if still running).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /api/runs returns all runs with no filters
- [ ] #2 Filtering by project, type, status, since/until all work correctly
- [ ] #3 limit and offset pagination works, total reflects unfiltered count
- [ ] #4 GET /api/runs/:id returns 404 for unknown id
- [ ] #5 duration_ms is null for running runs, positive integer for finished runs
- [ ] #6 schedule_name joined correctly when schedule_id is set
- [ ] #7 Tests: each filter param individually
- [ ] #8 Tests: combined filters
- [ ] #9 Tests: pagination (limit/offset)
- [ ] #10 Tests: empty result set returns {runs: [], total: 0}
<!-- AC:END -->
