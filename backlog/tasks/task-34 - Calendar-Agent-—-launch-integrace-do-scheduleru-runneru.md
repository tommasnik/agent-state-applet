---
id: TASK-34
title: Calendar Agent — launch integrace do scheduleru/runneru
status: In Progress
assignee: []
created_date: '2026-06-03 08:44'
updated_date: '2026-06-03 10:36'
labels: []
dependencies:
  - TASK-28
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umožnit appletu spustit calendar-agent jako vlastní program (`node calendar-agent`), ne přes generický `claude --print`. Zatím jen manuální spuštění (cron později).

## Rozsah
- Nový run typ / launcher path v runneru (TASK-8 má jen Ghostty + headless `claude`) pro spuštění SDK programu
- "Run Now" z UI (Schedules/projekt) → spustí calendar-agent
- Run se zaznamená do runs tabulky (status, output) standardně
- Session se napojí přes hook (stav v appletu) — long-lived, může přejít do `waiting_for_approval`

## Mimo rozsah
- Cron plánování (zatím jen ruční)
- Queue/streaming (samostatné tasky)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Applet umí spustit calendar-agent jako dlouhoběžící program
- [x] #2 "Run Now" v UI nastartuje běh a ten se objeví v runs/agentech
- [x] #3 Long-lived session korektně reportuje stav včetně waiting_for_approval
<!-- AC:END -->
