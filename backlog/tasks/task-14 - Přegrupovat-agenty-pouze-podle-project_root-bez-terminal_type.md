---
id: TASK-14
title: Přegrupovat agenty pouze podle project_root (bez terminal_type)
status: In Progress
assignee: []
created_date: '2026-05-26 10:15'
updated_date: '2026-05-26 10:17'
labels:
  - applet
  - core
  - grouping
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Záměr

Aktuálně jsou agenti grupováni podle `project_root + "|" + terminal_type`. To způsobuje, že 2 IDEA taby + 1 Ghostty ve stejném projektu → 3 skupiny místo 1.

Nové chování: groupovací klíč je pouze `project_root`. Všichni agenti ve stejném projektu jsou v jedné skupině bez ohledu na to, v jakém terminálu běží.

## Co se změní

- `gkey` v `describeRender`: `(agent.project_root || agent.cwd || "")` — bez `terminal_type`
- Disambiguation logika zůstává (řeší stejné basename u různých project_root)
- `terminal_type` zůstává v agent descriptoru (bude potřeba pro ikony v task-13/task-15)
- Testy přizpůsobit — testy které ověřují separaci skupin podle terminal_type se změní

## Dopad na existující testy

Testy jako `"same project, different terminal_type → 2 groups"` se změní na `"same project, different terminal_type → 1 group"`. SC3 fixture bude mít 2 skupiny místo 4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 2 IDEA + 1 Ghostty ve stejném project_root → 1 skupina se 3 agenty
- [x] #2 Disambiguation podle project_root basename stále funguje
- [x] #3 Všechny testy zelené (upravené pro nové chování)
- [ ] #4 Applet nasazen a vizuálně ověřen (skip — vizuální ověření nelze automatizovat)
<!-- AC:END -->
