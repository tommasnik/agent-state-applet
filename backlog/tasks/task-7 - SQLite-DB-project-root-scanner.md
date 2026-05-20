---
id: TASK-7
title: SQLite DB + project root scanner
status: To Do
assignee: []
created_date: '2026-05-20 05:23'
labels: []
milestone: 'M3: Scheduling'
dependencies:
  - TASK-3
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Přidat SQLite databázi a scanner projektu do TS serveru. Toto je základ pro scheduling i config management.

## SQLite schéma

```sql
-- ~/.config/agent-manager/db.sqlite

CREATE TABLE project_roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE    -- absolutní cesta, např. /home/tom/work/code
);

CREATE TABLE schedules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT NOT NULL,  -- absolutní cesta k projektu
  prompt TEXT NOT NULL,
  cron TEXT NOT NULL,          -- cron výraz, např. "0 9 * * 1-5"
  type TEXT NOT NULL CHECK(type IN ('interactive', 'headless')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  schedule_id INTEGER REFERENCES schedules(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
  output TEXT             -- pro headless agenty
);
```

## Config soubor

`~/.config/agent-manager/config.json` — spravuje seznam project roots:
```json
{
  "projectRoots": [
    "/home/tom/work/code",
    "/home/tom/code",
    "/home/tom/ai-docs/AI-docs"
  ]
}
```

## Project scanner

Funkce `scanProjects(roots: string[]): Project[]`
- Pro každý root: projde 1 úroveň subdirektořů
- Projekt = subdir s `.git/` nebo `CLAUDE.md` nebo `AGENTS.md`
- Vrací: `{ name, path, hasClaudeMd, hasMcpJson, hasSkills, agentYaml? }`

## API endpointy

- `GET /api/config` — vrátí config (project roots)
- `PUT /api/config` — uloží nový config
- `GET /api/projects` — spustí scanner a vrátí list projektů
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SQLite DB se vytvoří automaticky při prvním spuštění serveru
- [ ] #2 GET /api/projects vrátí seznam projektů ze skenovaných rootů
- [ ] #3 PUT /api/config uloží nové roots a následující GET /api/projects je použití
- [ ] #4 Scanner ignoruje node_modules, .git, .venv adresáře
- [ ] #5 config.json se vytvoří s defaulty (~/work/code, ~/code) pokud neexistuje
<!-- AC:END -->
