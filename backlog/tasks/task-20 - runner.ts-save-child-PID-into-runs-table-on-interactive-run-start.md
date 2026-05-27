---
id: TASK-20
title: 'runner.ts: save child PID into runs table on interactive run start'
status: To Do
assignee: []
created_date: '2026-05-27 13:38'
labels:
  - backend
  - scheduler
  - tdd
milestone: m-0
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When `runInteractive()` spawns the claude child process, immediately write its PID into `runs.pid` and set `launch_type = 'scheduled'` (or `'manual_trigger'` if triggered via Run Now).

This PID is the link the server uses to close the run when the session ends.

Also pass `SCHEDULE_ID` env var to the child process so the hook can detect it and include `launch_type` in POST /agent payload.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After runInteractive() spawns child, runs.pid = child.pid
- [ ] #2 launch_type = 'scheduled' for cron-triggered runs
- [ ] #3 launch_type = 'manual_trigger' for Run Now triggered runs
- [ ] #4 SCHEDULE_ID env var is set on child process
- [ ] #5 Tests: verify PID written to DB after spawn
- [ ] #6 Tests: verify SCHEDULE_ID present in child env
- [ ] #7 Tests: launch_type distinction between cron and manual_trigger
<!-- AC:END -->
