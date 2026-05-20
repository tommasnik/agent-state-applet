---
id: TASK-8
title: 'Scheduler — cron executor, Ghostty launcher, headless runner'
status: Done
assignee: []
created_date: '2026-05-20 05:23'
updated_date: '2026-05-20 05:55'
labels: []
milestone: 'M3: Scheduling'
dependencies:
  - TASK-7
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementovat backend logiku scheduleru: CRUD API pro schedules, cron executor a oba způsoby spouštění agentů.

## Schedule API

```
GET    /api/schedules          ← seznam schedules + poslední run
POST   /api/schedules          ← vytvořit schedule
PUT    /api/schedules/:id      ← upravit schedule
DELETE /api/schedules/:id      ← smazat schedule
POST   /api/schedules/:id/run  ← spustit ihned (mimo cron)
GET    /api/schedules/:id/runs ← historie runů
```

## Cron executor

- Použít knihovnu `node-cron`
- Při startu serveru načíst všechny enabled schedules z DB a zaregistrovat cron jobs
- Při CREATE/UPDATE/DELETE schedule: dynamicky přidat/odebrat cron job (bez restartu)

## Ghostty launcher (typ: interactive)

```ts
spawnSync('ghostty', [
  `--working-directory=${projectPath}`,
  '-e', 'claude', '--prompt', prompt
])
```
- Otevře nové Ghostty okno s Claude Code v daném projektu
- Schedule se zaznamená do runs jako running, agent se připojí přes hook standardně

## Headless runner (typ: headless)

```ts
const proc = spawn('claude', ['--print', prompt], {
  cwd: projectPath,
  env: { ...process.env }
})
```
- stdout/stderr zachytit, uložit do `runs.output`
- Status: running → success/failed podle exit code
- Výstup streamovat přes WebSocket (event: `run_output`, run_id, chunk)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/schedules vytvoří schedule a začne ho vykonávat v čase
- [x] #2 Ghostty se otevře v správném projektu
- [x] #3 Headless run výstup je uložen v DB
- [x] #4 POST /api/schedules/:id/run spustí okamžitě
- [x] #5 Cron jobs přežijí restart serveru (načtou se z DB)
- [x] #6 WebSocket streamúje výstup headless runu
<!-- AC:END -->
