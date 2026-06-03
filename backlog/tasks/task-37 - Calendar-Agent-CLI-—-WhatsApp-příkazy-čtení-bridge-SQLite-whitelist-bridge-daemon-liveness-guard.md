---
id: TASK-37
title: >-
  Calendar Agent CLI — WhatsApp příkazy (čtení bridge SQLite, whitelist) +
  bridge daemon + liveness guard
status: In Progress
assignee: []
created_date: '2026-06-03 16:30'
updated_date: '2026-06-03 16:42'
labels:
  - calendar-agent-cli
dependencies:
  - TASK-35
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`cal-agent wa ...` čte přímo bridge SQLite (`~/work/external/whatsapp-mcp/whatsapp-bridge/store/messages.db`) — odpadá python whatsapp-mcp + uv. Živost dat = běžící Go bridge (zapisuje v reálném čase). Whitelist se vynucuje v CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cal-agent wa list-chats vrací JEN whitelistované skupiny (z configu); cal-agent wa messages <group> [--since] vrací zprávy jen z whitelistované skupiny, jinak chyba
- [x] #2 Go bridge jako systemd user service (auto-restart + reconnect), aby data byla vždy live; dokumentováno jak nainstalovat
- [x] #3 liveness guard: cal-agent wa ověří že bridge žije (proces/:8080) a poslední zpráva není podezřele stará; když bridge dole → chyba (scheduled run tiše nepoužije stará data)
- [x] #4 jest testy nad fixture SQLite (whitelist filtr, liveness guard); build + testy zelené
<!-- AC:END -->
