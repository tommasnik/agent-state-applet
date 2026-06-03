---
id: TASK-31
title: 'Calendar Agent — approval queue: DB schema + server API'
status: Done
assignee: []
created_date: '2026-06-03 08:43'
updated_date: '2026-06-03 10:20'
labels: []
dependencies:
  - TASK-28
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rozšířit applet server (TS/Express, SQLite v ~/.config/agent-manager/db.sqlite) o frontu "ke schválení". Agent sem zapisuje nejisté případy, UI je zobrazuje, uživatel odpovídá.

## DB schema
- Nová tabulka `approvals`: id, run_id/session ref, created_at, status (pending/answered/dismissed), payload (navrhovaná akce + nejistota + zdroje), answer (text odpovědi), answered_at

## Server API
- POST /api/approvals          ← agent zaregistruje nejistou položku (vrací id)
- GET  /api/approvals          ← seznam pending (pro UI)
- POST /api/approvals/:id/answer ← uživatelova odpověď (text) → uloží + předá do běžící session (streaming bridge = samostatný task)
- POST /api/approvals/:id/dismiss
- WebSocket: push nové pending položky do UI (event: approval_pending)

## Vazba na stav agenta
- Pending approval koreluje se session ve stavu `waiting_for_approval` — UI je propojí

## Mimo rozsah
- Samotné předání odpovědi do živé SDK session (streaming bridge task)
- UI obrazovka (samostatný task)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tabulka approvals existuje a migrace běží při startu serveru
- [x] #2 POST /api/approvals vytvoří pending položku a vrátí id
- [x] #3 GET /api/approvals vrací pending položky, WebSocket pushuje nové
- [x] #4 POST /api/approvals/:id/answer uloží odpověď a označí answered
<!-- AC:END -->
