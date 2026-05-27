---
id: TASK-22
title: 'Server: create runs record for manual (non-scheduled) sessions at SessionStart'
status: Done
assignee: []
created_date: '2026-05-27 13:39'
updated_date: '2026-05-27 14:52'
labels:
  - backend
  - server
  - tdd
milestone: m-0
dependencies: []
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At `SessionStart` hook event, if the incoming payload has no `schedule_id`, create a new `runs` record with:
- `pid` from payload
- `session_id` from payload  
- `launch_type` = `'manual'`
- `terminal_type` from payload
- `project_root` mapped to a project (or stored as-is)
- `started_at` = now
- `status` = `'running'`
- `schedule_id` = NULL

If `schedule_id` is present, the run record already exists (created by runner.ts) — just update `session_id` and `pid` if not yet set.

## Edge cases to handle
- Same session_id arrives twice (duplicate SessionStart) — idempotent, don't create duplicate run
- PID reuse: a new SessionStart with PID that matches an existing open run with different session_id — close the old run as `cancelled`, open new one
- Server restart: on startup, query runs with `status = 'running'`; for each, check if PID is still alive; if not, mark as `failed` with `finished_at` = now
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SessionStart without schedule_id creates new runs record with launch_type='manual'
- [x] #2 SessionStart with schedule_id updates existing run (does not duplicate)
- [x] #3 Duplicate SessionStart (same session_id) is idempotent
- [x] #4 PID reuse: new session on PID of open run closes old run as cancelled
- [x] #5 Server restart: dead PIDs from open runs marked as failed
- [x] #6 Tests: all above edge cases covered individually
- [x] #7 Tests: concurrent sessions on different PIDs — no cross-contamination
<!-- AC:END -->
