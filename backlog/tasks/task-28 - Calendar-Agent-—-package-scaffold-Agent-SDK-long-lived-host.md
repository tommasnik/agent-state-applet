---
id: TASK-28
title: Calendar Agent — package scaffold + Agent SDK long-lived host
status: Done
assignee: []
created_date: '2026-06-03 08:41'
updated_date: '2026-06-03 09:39'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nový TS balíček `calendar-agent/` v monorepu. Host postavený na Claude Agent SDK (TypeScript), který drží **dlouhoběžící session** — neukončí se po jednom průchodu, protože musí umět počkat na odpověď uživatele (escalation flow, viz navazující tasky).

Na rozdíl od stávajícího headless runneru (`spawn('claude', ['--print', prompt])` v TASK-8), tohle NENÍ one-shot `claude` běh, ale vlastní program, který si připojí MCP servery a má vlastní smyčku se streamovaným vstupem.

## Rozsah
- Package scaffold (tsconfig, build, entrypoint `node calendar-agent`)
- Agent SDK inicializace: systémový prompt z `prompt.md` (samostatný task), připojení 3 MCP serverů (whatsapp-mcp, Gmail MCP, Google Calendar MCP — konfig task)
- Smyčka: jeden běh = projít whitelist vstupy → reasoning → zápis do AI kalendáře / eskalace
- Session zůstává naživu když čeká na schválení (hook reportuje stav `waiting_for_approval` standardně)

## Mimo rozsah
- Konkrétní MCP/OAuth setup (samostatný task)
- prompt.md obsah (samostatný task)
- Queue endpointy a streaming vstup (samostatné tasky)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Host připojí nakonfigurované MCP servery při startu
- [x] #2 Session zůstává naživu po dotazu místo ukončení (ověřitelné ve stavu agenta)
- [x] #3 Package se buildí a `node calendar-agent` nastartuje SDK host
<!-- AC:END -->
