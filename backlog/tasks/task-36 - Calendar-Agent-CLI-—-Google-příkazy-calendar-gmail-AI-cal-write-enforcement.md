---
id: TASK-36
title: >-
  Calendar Agent CLI — Google příkazy (calendar + gmail) + AI-cal write
  enforcement
status: In Progress
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 16:34'
labels:
  - calendar-agent-cli
dependencies:
  - TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subcommandy `cal-agent calendar ...` a `cal-agent gmail ...` nad raw Google REST API. Recykluj logiku z `calendar-agent/src/googleTools.ts` + `googleAuth.ts` (GoogleTokenManager, token per-call refresh) — ale jako CLI, ne MCP. JSON výstup na stdout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cal-agent calendar list-calendars | list-events | get-event fungují (čtou Google Calendar API)
- [x] #2 cal-agent calendar create-event | update-event zapisují — HARD ENFORCE: jen aiCalendarId, jiný/chybějící calendarId → chyba/odmítnutí, žádný zápis jinam
- [x] #3 cal-agent gmail search --label <l> | get <id> čtou Gmail API (read-only)
- [x] #4 token z GoogleTokenManager per-call (auto-refresh); chybějící creds → jasná chyba
- [x] #5 jest testy: enforcement (cizí calendarId → odmítnuto, žádný HTTP call), mock fetch/token; build + testy zelené
<!-- AC:END -->
