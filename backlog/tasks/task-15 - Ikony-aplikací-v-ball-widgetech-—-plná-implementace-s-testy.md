---
id: TASK-15
title: Ikony aplikací v ball widgetech — plná implementace s testy
status: Done
assignee: []
created_date: '2026-05-26 10:16'
updated_date: '2026-05-26 10:48'
labels:
  - applet
  - ux
  - icons
dependencies:
  - TASK-13
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Záměr

Plná produkční implementace ikon aplikací v ball widgetech na základě poznatků z task-13 (PoC). Zahrnuje testové pokrytí, refaktoring do `core.mjs` (host API), a robustní fallbacky.

**Závisí na task-13** (PoC musí být hotové a úspěšné).

## Plán

- `host.resolveAppIcon(window_id, pid, size)` → Clutter actor nebo `null`
- Implementace v `applet/applet.js` přes `Cinnamon.WindowTracker`
- `core.mjs` `render()`: pokud host vrátí actor, přidej ho jako child do ballu
- GJS fakes v `test/fakes/gjs-fakes.mjs` rozšířit o mock `resolveAppIcon`
- UI testy pokrývající: ikona přítomna, fallback na null, cache chování

## Detaily závisí na výsledku task-13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 host.resolveAppIcon API zdokumentováno a implementováno
- [x] #2 Ikona viditelná v appletu pro všechny známé terminálové typy
- [x] #3 Fallback (null app, neznámý typ) nevyhazuje chybu
- [x] #4 Cache TTL 1h pokryta testy
- [x] #5 Všechny existující i nové testy zelené
<!-- AC:END -->
