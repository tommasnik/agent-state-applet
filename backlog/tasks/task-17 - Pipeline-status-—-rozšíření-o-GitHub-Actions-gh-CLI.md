---
id: TASK-17
title: Pipeline status — rozšíření o GitHub Actions (gh CLI)
status: Done
assignee: []
created_date: '2026-05-26 12:50'
updated_date: '2026-05-26 13:56'
labels:
  - ui
  - server
  - github
  - pipeline
dependencies:
  - TASK-16
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Cíl

Rozšířit pipeline endpoint (z TASK-16) o podporu GitHub Actions. Projekty s `github.com` remote budou zobrazovat stav GitHub Actions workflow runů místo "žádná pipeline".

## Závislost

Závisí na TASK-16 (GitLab implementace musí být hotová).

## Design

### Provider detekce

V `server/src/routes/pipeline.ts` existuje logika pro `git remote get-url origin`. Rozšířit ji:
- `gitlab.com` (nebo nakonfigurované GitLab hosty) → glab (stávající)
- `github.com` → gh (nové)
- ostatní → null

### gh CLI volání

```bash
# Nejnovější run pro danou branch:
gh run list --branch <branch> --limit 1 --json databaseId,status,conclusion,htmlUrl,headBranch,createdAt,updatedAt

# Joby daného runu:
gh run view <runId> --json jobs
```

**Mapování GitHub → unified status:**
- `status=completed, conclusion=success` → `"success"`
- `status=completed, conclusion=failure` → `"failed"`
- `status=completed, conclusion=cancelled` → `"canceled"`
- `status=in_progress` → `"running"`
- `status=queued` → `"pending"`

**Mapování job status:**
- `conclusion=success` → `"success"`
- `conclusion=failure` → `"failed"`
- `status=in_progress` → `"running"`
- `status=queued` → `"pending"`
- ostatní → `"skipped"`

### Response shape

Stejná jako pro GitLab (TASK-16), s `"provider": "github"`.

### Prerekvizity

- `gh` CLI musí být nainstalován: `sudo apt install gh` nebo `brew install gh`
- `gh auth login` pro autentikaci
- Pokud gh chybí nebo není auth: vrátit `null`, logovat warning (stejné chování jako glab v TASK-16)

### Soubory k upravení

- `server/src/routes/pipeline.ts` — přidat GitHub větev do provider detection + gh subprocess volání
- `ui/src/pages/ProjectsPage.tsx` — žádné změny (unified response shape)
- `README.md` nebo install docs — přidat poznámku o gh prerekvizitě
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Projekt s github.com remote zobrazí GitHub Actions status badge v sidebaru
- [x] #2 ProjectDetail sekce Pipeline funguje pro GitHub projekty stejně jako pro GitLab
- [x] #3 Chybí-li gh nebo není autentikovaný: vrátí null bez pádu
- [x] #4 GitHub job stav se mapuje korektně na unified stav (success/failed/running/pending/canceled)
- [x] #5 Klik na job otevře GitHub Actions job log (htmlUrl)
<!-- AC:END -->
