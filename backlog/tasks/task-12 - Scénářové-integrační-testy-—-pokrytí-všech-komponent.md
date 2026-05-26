---
id: TASK-12
title: Scénářové integrační testy — pokrytí všech komponent
status: Done
assignee: []
created_date: '2026-05-26 08:08'
updated_date: '2026-05-26 08:43'
labels:
  - testing
  - integration
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Kompletní integrační testování dvou klíčových scénářů skrz všechny komponenty systému.

## Scénáře

**SC1**: 2× Claude v IDEA, stejné jméno projektu, jiná cesta na disku  
(`~/work/proj1` vs `~/work/subfolder/proj1`)

**SC2**: Claude v IDEA + Claude v Ghostty, stejná složka  
(`~/work/proj1` v obou terminálech)

## Architektura testů

Fixture soubory v `test-fixtures/scenarios/` definují kontrakt mezi komponentami — každá vrstva testuje že fixture konzumuje/produkuje správně.

```
test-fixtures/scenarios/
  sc1-idea-same-name/
    hook-payloads/{agent-a,agent-b}.json   # co hook posílá serveru
    server-state/after-both.json            # expected AgentStore snapshot
    wmctrl-output.txt                       # fake wmctrl -l výstup
    focus-calls/{click-a,click-b}.json      # expected wmctrl + IDEA API volání
  sc2-idea-and-ghostty/
    ...
```

## Mocky per vrstva

| Vrstva | Mock |
|--------|------|
| Hook | Mock HTTP server (responses/pytest) — jen ověří POST payload |
| Server | DI pro system calls (wmctrl, IDEA API) + supertest E2E |
| Applet | Mock fetch na :7855 |
| IDEA plugin | Mock HTTP server na :63342 |

## Závislosti mezi subtasky

TASK-12a (fixtures) → vše ostatní  
TASK-12b (buildApp refactor) → TASK-12e (server E2E)  
TASK-12c (DI system calls) → TASK-12e (server E2E)
<!-- SECTION:DESCRIPTION:END -->
