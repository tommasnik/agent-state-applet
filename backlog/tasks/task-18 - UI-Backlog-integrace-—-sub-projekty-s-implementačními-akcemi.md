---
id: TASK-18
title: 'UI: Backlog integrace — sub-projekty s implementačními akcemi'
status: In Progress
assignee: []
created_date: '2026-05-26 13:03'
updated_date: '2026-05-26 13:56'
labels:
  - ui
  - backlog
  - projects
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Přidat do Projects UI podporu pro sub-projekty s backlogy. Sub-projekt je jakýkoli adresář uvnitř projektu, který obsahuje `backlog/` podsložku. Cílem je zobrazit open tasky a spouštět Claude Code sessions pro jejich implementaci.

## Architektura

### Marker sub-projektu
Přítomnost `backlog/` adresáře. Scanner prochází max 3 úrovně hluboko uvnitř každého projektu (přeskakuje IGNORED_DIRS).

Příklad: `~/code/demo-pages` je projekt, `~/code/demo-pages/sites/two-hands-magic` (má `backlog/`) je sub-projekt.

### Datový model — rozšíření Project interface

```ts
interface SubProject {
  name: string
  path: string   // absolutní cesta
  hasBacklog: true
}

interface Project {
  // ... stávající pole ...
  subProjects: SubProject[]  // [] pokud žádné
}
```

Scanner (`scanner.ts`) dostane rekurzivní `findSubProjects(projectPath, maxDepth=3)`.

## API změny

| Endpoint | Změna |
|---|---|
| `GET /api/projects` | `subProjects[]` přidáno do každého projektu |
| `GET /api/projects/:path/backlog` | nový — vrátí `{ files: { name: string, content: string }[] }` pro soubory z `backlog/tasks/*.md` |
| `POST /api/projects/:path/implement-all` | nový — volá `runInteractive()` s konstantou `PROMPT_IMPLEMENT_ALL` |
| `POST /api/projects/:path/implement-next` | nový — volá `runInteractive()` s konstantou `PROMPT_IMPLEMENT_NEXT` |
| `POST /api/projects/:path/implement/:taskId` | nový — volá `runInteractive()` s `PROMPT_IMPLEMENT_TASK` + taskId vloženo do promptu |

Promptové konstanty jsou definovány v `routes/projects.ts` jako exportované string konstanty — doplníme ručně po implementaci.

`runInteractive()` v `runner.ts` aktuálně vyžaduje `scheduleId`. Buď přidat overload bez scheduleId, nebo vložit virtuální hodnotu (-1).

## UI změny

### Sidebar (levý panel)
- Pokud projekt nemá sub-projekty → beze změny (žádný strom)
- Pokud má → pod projektem odsazené položky pro každý sub-projekt
- Klik na sub-projekt → otevře SubProjectDetail v pravém panelu

### SubProjectDetail (pravý panel)
Nová komponenta (jen backlog, bez CLAUDE.md / MCP / skills sekcí):

1. **Hlavička**: název sub-projektu, cesta, 2 globální tlačítka: "Implementuj vše" + "Next task"
2. **Seznam tasků**: načte `/api/projects/:path/backlog`, parsuje YAML frontmatter v UI, zobrazuje jen status ≠ done/archive
   - Sloupce: ID, název, priorita, status
   - Vpravo u každého řádku: tlačítko "Run"
3. **Klik na task**: otevře `TaskDetailModal`

### TaskDetailModal
Sdílená komponenta — použitá jak pro zobrazení detailu, tak jako confirm dialog před spuštěním:
- Rendered markdown přes `react-markdown` (přidat jako npm závislost)
- Zobrazí celý obsah `.md` souboru tasku
- Footer: "Zrušit" + "Spustit implementaci →"
- "Spustit" volá POST `/api/projects/:path/implement/:taskId` a zavře modal

"Implementuj vše" a "Next task" tlačítka spustí rovnou bez confirm dialogu (nebo s jednoduchým `window.confirm`).

## Závislosti
- `react-markdown` (npm install do `ui/`)
- `runner.ts` — možná rozšíření pro volání bez scheduleId
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Scanner najde sub-projekty (backlog/ marker) max 3 úrovně hluboko; demo-pages/sites/two-hands-magic je detekován
- [x] #2 GET /api/projects vrátí subProjects[] pole u každého projektu
- [x] #3 GET /api/projects/:path/backlog vrátí raw .md soubory z backlog/tasks/
- [x] #4 Sidebar zobrazí sub-projekty jako odsazené položky pod projektem; projekty bez sub-projektů jsou beze změny
- [x] #5 SubProjectDetail zobrazí open tasky (status != done/archive) parsované z YAML frontmatter v UI
- [x] #6 Klik na task otevře TaskDetailModal s rendered markdown (react-markdown)
- [x] #7 TaskDetailModal má tlačítko 'Spustit implementaci' — volá implement/:taskId endpoint a otevře Ghostty session
- [x] #8 Implement-all a implement-next endpointy fungují (spustí Ghostty s pevným promptem)
- [x] #9 Promptové konstanty jsou v kódu jako pojmenované exporty, snadno editovatelné
<!-- AC:END -->
