---
id: TASK-40
title: Calendar Agent CLI — launch integrace do applet scheduleru
status: In Progress
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 17:08'
labels:
  - calendar-agent-cli
dependencies:
  - TASK-39
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Applet server (scheduler/runner) umí spustit nového agenta jako `claude -p "/sync-calendar"` s cwd = calendar-agent-cli/. Reuse/rozšíř runner z TASK-34. NEMĚNIT chování pro stávající calendar-agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nový run typ / launcher path spustí claude headless ve složce calendar-agent-cli s /sync-calendar
- [x] #2 Run Now z UI nastartuje běh, zaznamená se do runs tabulky standardně
- [x] #3 stav teče do appletu přes hook (jako ostatní běhy)
<!-- AC:END -->
