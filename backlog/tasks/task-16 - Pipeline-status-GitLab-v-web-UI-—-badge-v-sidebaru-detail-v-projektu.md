---
id: TASK-16
title: Pipeline status (GitLab) v web UI — badge v sidebaru + detail v projektu
status: Done
assignee: []
created_date: '2026-05-26 12:49'
updated_date: '2026-05-26 12:57'
labels:
  - ui
  - server
  - gitlab
  - pipeline
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Cíl

Přidat live stav CI/CD pipeline do web UI. V levém sidebaru Projects zobrazit pipeline badge u každého projektu. V detailu projektu zobrazit celou pipeline se seznamem jobů.

## Design (výsledek /grill-me session)

### Co se zobrazuje

- **Sidebar** (levý panel): malý status badge vedle jména projektu (barva = stav). Projekty bez GitLab remotu → nic.
- **ProjectDetail** (pravý panel): nová sekce "Pipeline" — celkový stav, branch, čas, odkaz na GitLab, seznam jobů s ikonami. Klik na job → otevře job log v GitLabu.

### Trigger / polling

- Sidebar: initial load pro všechny projekty, pak interval ~10s.
- ProjectDetail: interval 5s pro vybraný projekt (živý pocit při running pipeline). Projekty s finished statusem: stačí 30s nebo jen initial load.
- Pozn.: running/pending = `{ running, pending, created, waiting_for_resource }`. Finished = `{ success, failed, canceled, skipped }`.

### Branch detekce

Server spouští: `git -C <projectPath> rev-parse --abbrev-ref HEAD`

### Provider detekce

Server čte: `git -C <projectPath> remote get-url origin` → detekuje gitlab.com (nebo nakonfigurovaný gitlab host). GitHub → vrátit `null` (handled in Task 2). Žádný remote → `null`.

### Serverový endpoint

```
GET /api/projects/:encodedPath/pipeline
```

**Flow:**
1. Decode + validate path (stávající `validatePath()`)
2. `git rev-parse --abbrev-ref HEAD` → branch
3. `git remote get-url origin` → detect provider
4. `glab api "projects/:id/pipelines?ref=<branch>&per_page=1&order_by=id&sort=desc"` (cwd=projectPath)
5. Pokud pipeline nalezena: `glab api "projects/:id/pipelines/<id>/jobs"` (cwd=projectPath)
6. Cache výsledek v paměti (Map keyed by projectPath, TTL ~5s) — aby N sidebar requestů nestartovalo N glab procesů najednou

**Response shape (nebo `null`):**
```json
{
  "provider": "gitlab",
  "status": "success|failed|running|pending|canceled|skipped",
  "ref": "main",
  "web_url": "https://gitlab.com/.../pipelines/123",
  "started_at": "2024-01-01T12:00:00Z",
  "duration": 120,
  "jobs": [
    { "id": 1, "name": "build", "status": "success", "web_url": "https://..." },
    { "id": 2, "name": "test", "status": "failed", "web_url": "https://..." }
  ]
}
```

Pokud glab není autentikovaný, vrátit `null` (logovat warning do stderr).
Timeout na glab subprocess: 10s.

### UI změny (ProjectsPage.tsx)

**Sidebar (pm-row):** přidat `<span className="pm-pip pm-pip-pipeline" style={{ background: pipelineColor(status) }} />` za stávající agent pips.

**ProjectDetail:** nová sekce před nebo za "Agents in project":
```
─ Pipeline ─────────────────────────────────
● running  main  started 2min ago  → Open in GitLab
  ✓ build      success   45s
  ✓ lint       success   12s  
  ✗ test       failed    30s  → View log
  · deploy     created   —
```

## Soubory k vytvoření/upravení

- `server/src/routes/pipeline.ts` — nový route soubor
- `server/src/app.ts` — registrovat `/api/projects` prefix pro pipeline route
- `ui/src/pages/ProjectsPage.tsx` — sidebar badge + detail sekce
- `ui/src/styles.css` — styly pro pipeline sekci

## Co neřešit v tomto tasku

- GitHub Actions (Task 2)
- Notifikace při pipeline failure
- Pipeline history (jen poslední pipeline pro current branch)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Endpoint GET /api/projects/:encodedPath/pipeline vrací JSON (nebo null) do 10s
- [x] #2 Projekty s GitLab remote zobrazují pipeline badge v sidebaru (barva = stav)
- [x] #3 Projekty bez CI remotu nezobrazují nic (žádná chyba v UI)
- [x] #4 ProjectDetail má sekci Pipeline se stavem, branchem, časem, odkazem na GitLab
- [x] #5 Sekce Pipeline obsahuje seznam jobů s ikonami stavů
- [x] #6 Klik na job v UI otevře job log v GitLabu (web_url)
- [x] #7 Running/pending pipeline se refreshuje každých 5s v detailu
- [x] #8 Server cachuje glab volání (TTL ~5s) — sidebar N-projektů nepůsobí N paralelních glab subprocessů
- [x] #9 glab subprocess má timeout 10s — neblokuje server
- [x] #10 Chybí-li glab nebo není autentikovaný: vrátí null, UI zobrazí prázdný stav bez pádu
<!-- AC:END -->
