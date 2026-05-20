---
id: TASK-6
title: Systemd migrace + smazání Python serveru a session-review komponent
status: Done
assignee: []
created_date: '2026-05-20 05:22'
updated_date: '2026-05-20 05:39'
labels: []
milestone: 'M1: Infrastructure'
dependencies:
  - TASK-3
priority: high
ordinal: 2500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Po ověření funkčnosti TS serveru: swapnout systemd service, smazat Python kód a session-review systemd komponenty.

## Co smazat

```
server/claude_state_server.py
server/session-review-runner.py
server/claude-state-server.service.template
server/tests/           ← všechny Python testy
systemd/claude-session-review.service
systemd/claude-session-review.timer
```

## Nová systemd service

Vytvořit `systemd/claude-state-server.service` pro Node.js server:
```ini
[Unit]
Description=Claude Agent State Server (TypeScript)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/code/agent-state-applet/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

## Makefile targets aktualizovat

- `make server-restart` → `systemctl --user restart claude-state-server`
- Přidat `make server-logs` → `journalctl --user -u claude-state-server -f`

## install.sh aktualizovat

Přidat `npm install && npm run build` do install sekvence pro server.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 systemctl --user status claude-state-server ukazuje TS server běžící
- [x] #2 Python soubory jsou smazány
- [x] #3 session-review systemd soubory jsou smazány (neexistovaly)
- [x] #4 make server-restart funguje
- [x] #5 install.sh proběhne čistě na novém stroji
<!-- AC:END -->
