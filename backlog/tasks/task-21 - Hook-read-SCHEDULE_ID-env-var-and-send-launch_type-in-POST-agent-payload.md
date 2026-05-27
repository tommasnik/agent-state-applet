---
id: TASK-21
title: 'Hook: read SCHEDULE_ID env var and send launch_type in POST /agent payload'
status: In Progress
assignee: []
created_date: '2026-05-27 13:39'
updated_date: '2026-05-27 14:44'
labels:
  - hook
  - tdd
milestone: m-0
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In `state-report.py`, read `SCHEDULE_ID` from the process environment and include it in the POST /agent payload as `schedule_id`. If absent, omit the field (server treats absence as manual session).

This is how the server distinguishes scheduled sessions from manual IDE sessions at SessionStart.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 schedule_id field present in payload when SCHEDULE_ID env var is set
- [x] #2 schedule_id field absent (not null, absent) when env var not set
- [x] #3 Tests: payload with SCHEDULE_ID set
- [x] #4 Tests: payload without SCHEDULE_ID
- [x] #5 Tests: SCHEDULE_ID value correctly passed through
- [x] #6 make hook deploys updated hook to ~/.claude/hooks/
<!-- AC:END -->
