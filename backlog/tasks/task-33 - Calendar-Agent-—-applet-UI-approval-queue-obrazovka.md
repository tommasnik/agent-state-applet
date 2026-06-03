---
id: TASK-33
title: 'Calendar Agent — applet UI: approval queue obrazovka'
status: Done
assignee: []
created_date: '2026-06-03 08:43'
updated_date: '2026-06-03 10:36'
labels: []
dependencies:
  - TASK-31
  - TASK-32
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nová obrazovka ve webovém UI appletu (React + Vite), kde uživatel vidí nejisté položky a odpovídá na ně. Odpověď se přes server (TASK-31/32) vrátí do běžící session.

## UI
- Seznam pending approvals (z GET /api/approvals, live přes WebSocket approval_pending)
- Detail položky: navrhovaná akce, důvod nejistoty, KONKRÉTNÍ ZDROJE (linky na maily/přílohy, texty WA zpráv)
- Textový vstup pro odpověď → POST /api/approvals/:id/answer
- Dismiss tlačítko → POST .../dismiss
- Propojení na session ve stavu `waiting_for_approval` (badge/proklik na agenta)

## Mimo rozsah
- Backend doručení odpovědi (TASK-32)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Obrazovka zobrazuje pending approvals živě (WebSocket)
- [x] #2 Detail ukazuje navrženou akci, nejistotu a zdrojové linky/texty
- [x] #3 Textová odpověď odejde na /answer a položka zmizí z pending
- [x] #4 Dismiss funguje
<!-- AC:END -->
