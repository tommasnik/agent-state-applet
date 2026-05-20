---
id: TASK-10
title: Projects UI — správa konfigurace projektů
status: Done
assignee: []
created_date: '2026-05-20 05:24'
updated_date: '2026-05-20 06:04'
labels: []
milestone: 'M4: Config Management'
dependencies:
  - TASK-7
  - TASK-4
references:
  - /home/tom/code/demo-pages/sites/agent-dashboard-demo/src/App.jsx
  - /home/tom/code/demo-pages/sites/agent-dashboard-demo/src/data.js
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementovat ProjectsPage — přehled všech projektů ze skenovaných root dirů s detailem konfigurace a editací.

## Referenční prototyp

`/home/tom/code/demo-pages/sites/agent-dashboard-demo` — viz `src/App.jsx` funkce `ProjectsView` a data model v `src/data.js` (pole `mcps`, `skills`, `claudeMd`, `agents`, `branch` v projektu).

## Layout — master-detail

```
┌────────────┬──────────────────────────────────────────┐
│  Projects  │  [project detail]                        │
│  ─────     │                                          │
│ ● proj-a   │  ● project-name  branch: main            │
│ ● proj-b   │  Popis projektu                          │
│ ● proj-c   │  ~/path/to/project                       │
│            │                                          │
│            │  [MCP servers]   [Skills]                │
│            │  [CLAUDE.md ─────────────────────]       │
│            │  [Agents in project ──────────────]      │
│            │  [Scheduled ──────────────────────]      │
└────────────┴──────────────────────────────────────────┘
```

### Levý panel (ProjectList)

- Nadpis "Projects" + počet
- Řádky: barevný mark (malý čtvereček) | název projektu | pip badges vpravo
  - Amber pip s číslem = počet needs-input agentů
  - Green pip s číslem = počet working agentů
- Aktivní projekt zvýrazněn
- Filtr a vyhledávání jsou nice-to-have (prototyp je neimplementuje)

### Pravý panel (ProjectDetail)

**Header**:
- Velký barevný mark + název projektu + branch badge (muted)
- Popis projektu
- Cesta: `<code>~/path/to/project</code>`

**Blokový grid** (ne taby — vše na jedné scrollovatelné stránce):

**MCP servers** (compact blok):
- Řádky: status dot (green=connected, muted=disconnected) | název | "N tools" nebo "disconnected"

**Skills** (compact blok):
- Řádky: accent dot | `/název` | "enabled"

**CLAUDE.md** (wide blok, celá šířka):
- V read módu: zobrazení jako `<pre>` nebo styled markdown
- Editační mód: markdown editor (CodeMirror nebo Monaco) s Save tlačítkem
- Inline editace bez navigace jinam

**Agents in project** (wide blok, secondary styling):
- Nadpis + hint "switch to 'Active' for live work"
- Kompaktní řádky: status dot | session title | "Status · model · last Xs"
- Klik na agenta → otevře AgentTerminalModal (stejný jako v Active view)

**Scheduled** (wide blok, secondary styling, zobrazit jen pokud existují):
- Kompaktní řádky: status dot | název schedule | "next {datum} · recurrence"

## API endpointy (přidat do serveru)

```
GET  /api/projects                       ← seznam projektů ze skeneru
GET  /api/projects/:encodedPath/claude-md   ← přečti CLAUDE.md
PUT  /api/projects/:encodedPath/claude-md   ← ulož CLAUDE.md
GET  /api/projects/:encodedPath/mcp-json    ← přečti .mcp.json
PUT  /api/projects/:encodedPath/mcp-json    ← ulož .mcp.json
GET  /api/projects/:encodedPath/skills      ← seznam skill souborů
GET  /api/projects/:encodedPath/skills/:name
PUT  /api/projects/:encodedPath/skills/:name
```

`encodedPath` = base64url absolutní cesta projektu.

## Bezpečnost

Všechny file paths validovat na serveru — povoleny jen cesty pod nakonfigurovanými project roots nebo `~/.claude/`. Odmítnout path traversal (`../` apod.).

## Settings stránka (globální, mimo Projects view)

Správa project roots (přidat / odebrat adresář). Po změně refresh seznam projektů. Dostupná přes navigaci nebo jako extra tab v sidebar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Levý panel zobrazuje všechny projekty s barevným markem a pip badges pro needs/working agenty
- [x] #2 Klik na projekt zobrazí detail vpravo bez navigace na novou stránku
- [x] #3 Detail obsahuje: header (barva/název/cesta), Skills, CLAUDE.md, Agents in project bloky
- [x] #4 CLAUDE.md lze přepnout do editačního módu, upravit a uložit (PUT /api/projects/.../claude-md)
- [x] #5 MCP servers: hasMcpJson flag zobrazen v header badges (plný MCP status parsing není implementován)
- [x] #6 Agents in project jsou klikatelní a otevřou AgentTerminalModal
- [x] #7 Project roots lze spravovat přímo v Project detail panelu (přidat/odebrat)
- [x] #8 Path traversal attack není možný (server validuje cesty proti whitelist rootů)
<!-- AC:END -->
