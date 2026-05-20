---
id: TASK-3
title: TypeScript/Express server — přepsat claude_state_server.py
status: Done
assignee: []
created_date: '2026-05-20 05:21'
updated_date: '2026-05-20 05:35'
labels: []
milestone: 'M1: Infrastructure'
dependencies: []
references:
  - server/claude_state_server.py
  - CLAUDE.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Přepsat stávající Python HTTP server do Node.js + Express + TypeScript. Nový server musí být 100% kompatibilní s existujícím API (hook a IntelliJ plugin se nemění).

## Scope

Nová struktura:
```
server/
  src/
    index.ts          ← Express app, spuštění
    agents.ts         ← AgentStore — stav agentů, PID lifecycle
    routes/
      agent.ts        ← POST /agent
      focus.ts        ← POST /focus  
      status.ts       ← GET /status
      reviews.ts      ← GET/POST /reviews
    ws.ts             ← WebSocket server na /ws (broadcast při změně stavu)
    stateFile.ts      ← zápis /tmp/claude-agents.json (atomic write)
  package.json
  tsconfig.json
```

## API kontrakt (musí zůstat identický)

- `POST /agent` — přijme payload z hook/state-report.py (pid, cwd, state, hook_event, tool_name, session_id, project_root, tty, window_id, tab_name, subagent_count)
- `POST /focus` — wmctrl focus window pro daný PID
- `GET /status` — dump agents dict (JSON)
- `GET /reviews` — seznam session reviews
- `POST /reviews` — uložit review

## Logika přenést 1:1

- AgentStore: přidání/update agenta, TTY collision detection (nová session na stejném TTY → smazat starou done)
- PID liveness check každých 5s (pokud PID mrtvý → smazat agenta)
- Atomic write do /tmp/claude-agents.json (přes tmp soubor + rename)
- window_id se aktualizuje jen při SessionStart/UserPromptSubmit (ne na každý event)
- started_at timestamp se nastaví jednou a nemění

## Nové funkce oproti Pythonu

- WebSocket `/ws` — při každé změně AgentStore broadcastovat aktuální stav všem klientům
- `GET /` a `GET /assets/*` — servírovat statické soubory React UI z `../ui/dist/`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 hook/state-report.py funguje bez změny (POST /agent přijímá stejný payload)
- [x] #2 IntelliJ plugin funguje bez změny (POST /focus)
- [x] #3 Applet čte /tmp/claude-agents.json stejně jako dříve
- [x] #4 PID liveness check běží každých 5s
- [x] #5 TTY collision detection funguje (nová session na stejném TTY smaže starou done)
- [x] #6 WebSocket /ws broadcastuje změny stavu
- [x] #7 Atomic write do /tmp/claude-agents.json
- [x] #8 npm run build kompiluje bez chyb
- [x] #9 Základní unit testy pro AgentStore logiku
<!-- AC:END -->
