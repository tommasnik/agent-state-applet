---
id: TASK-11
title: Master prompts UI — správa Obsidian vault promptů
status: Done
assignee: []
created_date: '2026-05-20 05:24'
updated_date: '2026-05-20 06:20'
labels: []
milestone: 'M4: Config Management'
dependencies:
  - TASK-10
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementovat PromptsPage — správa master promptů verzovaných v Obsidian vaultu (`~/ai-docs/AI-docs/`).

## Co je master prompt

Markdown soubor v `~/ai-docs/AI-docs/` (nebo podsložkách), který se referencuje z CLAUDE.md projektů přes `@/home/tom/ai-docs/AI-docs/nazev.md`. UI umožní tyto soubory procházet, editovat a vidět kde jsou použité.

## API endpointy

```
GET  /api/prompts          ← seznam .md souborů z vault rootu
GET  /api/prompts/:path    ← obsah souboru
PUT  /api/prompts/:path    ← uložit soubor
GET  /api/prompts/:path/usages ← seznam projektů které tento soubor @include
```

Vault root = nakonfigurovaná cesta (defaultně `~/ai-docs/AI-docs/`), přidatelná do project roots v Settings.

## UI

### PromptList (levý panel)
- Stromová struktura adresářů vaultu
- .md soubory jako listy, klik → otevře editor
- Badge: počet projektů které ho používají (`@include` usages)

### PromptEditor (pravý panel)
- Markdown editor (stejný jako pro CLAUDE.md)
- Sekce "Používají tento prompt": seznam projektů s linky do ProjectDetail
- Save tlačítko

### Jak detekovat usages
- Server při GET /api/prompts/:path/usages: grep `@path` přes všechny CLAUDE.md soubory ve skenovaných projektech
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Zobrazuje se seznam .md souborů z vaultu
- [x] #2 Soubor lze editovat a uložit
- [x] #3 Usages (které projekty @include) jsou viditelné u každého promptu
- [x] #4 Stromová struktura adresářů je navigovatelná
<!-- AC:END -->
