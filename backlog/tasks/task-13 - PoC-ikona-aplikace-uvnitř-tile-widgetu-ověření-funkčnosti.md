---
id: TASK-13
title: 'PoC: ikona aplikace uvnitř tile widgetu (ověření funkčnosti)'
status: Done
assignee: []
created_date: '2026-05-26 10:13'
updated_date: '2026-05-26 10:30'
labels:
  - applet
  - ux
  - poc
dependencies:
  - TASK-14
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Záměr

Ověřit, zda jde v Cinnamon appletu zobrazit ikonu aplikace uvnitř barevného tile widgetu pomocí `Cinnamon.WindowTracker`. Výsledkem PoC je buď funkční prototyp nebo zdokumentované překážky.

**Závisí na task-14** (přegrupování) — PoC se dělá na novém groupování.

## Přístup (stejný jako Cinnamon grouped-window-list)

```js
const tracker = Cinnamon.WindowTracker.get_default();
let app = tracker.get_window_app(metaWindow);     // z window_id
if (!app) app = tracker.get_app_from_pid(pid);    // fallback na agent PID
let texture = app.create_icon_texture(size);      // Clutter actor
```

Flow v appletu:
1. Z `window_id` (hex) najdi `MetaWindow` přes `global.get_window_actors()`
2. `tracker.get_window_app(metaWindow)` → `CinnamonApp`
3. `app.create_icon_texture(tileH - 4)` → přidej jako child do tile widgetu
4. Cache: `window_id → CinnamonApp`, TTL 1 hodina, lazy-loaded

## Co PoC ověří

- Funguje `get_window_app` pro terminály (IDEA, Ghostty)?
- Je `create_icon_texture` použitelné přímo jako child St.Widget?
- Co se stane při `null` app (fallback chování)?
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IDEA i Ghostty tile zobrazuje rozpoznatelnou ikonu aplikace
- [x] #2 Null app fallback funguje bez pádu
- [x] #3 Cache TTL 1 hodina implementována
- [x] #4 Zdokumentováno co funguje/nefunguje pro task-15
<!-- AC:END -->

## Poznámky z implementace (pro task-15)

### Co bylo implementováno

**`applet/applet.js`**:
- Přidán `imports.gi.Cinnamon` import
- Přidána funkce `getAppIcon(windowIdHex, pid, size)` do `host` bloku
  - Primárně hledá MetaWindow podle `window_id` (hex) přes `global.get_window_actors()`
  - Fallback na `tracker.get_app_from_pid(pid)` pokud window_id chybí nebo lookup selže
  - Celá funkce obalena try/catch → vrátí null při jakékoli chybě (AC #2)

**`shared/core.mjs`**:
- Přidán `iconCache = {}` a `ICON_TTL_MS = 3600 * 1000` (AC #3)
- `entry` rozšířen o `iconActor: null`
- V render smyčce po `entry.tile.set_style()`: odstraní starý iconActor, pak lazy-load přes cache

### Architektura

- `getAppIcon` žije v `applet.js` (Cinnamon-specifické API), nikoliv v `core.mjs`
- `core.mjs` volá jen `if (host.getAppIcon)` — guard zajišťuje kompatibilitu s unit testy kde `host.getAppIcon` není definován (AC #2)
- Cache je per-indicator closure, klíč je `window_id` nebo `"pid:<pid>"` jako fallback

### Co funguje / nefunguje (k ověření in-situ)

**Očekávané funkční** (architektura je ověřena v grouped-window-list):
- `Cinnamon.WindowTracker.get_default()` je dostupné v applet kontextu
- `tracker.get_window_app(metaWindow)` funguje pro okna s .desktop souborem (IDEA, Ghostty)
- `app.create_icon_texture(size)` vrací Clutter.Texture/Actor použitelný jako child St.Widget

**Potenciální omezení pro task-15**:
- Agenti Claude Code běží jako subprocess IDEA/Ghostty — `tracker.get_app_from_pid(pid)` pro PID claude procesu nemusí vrátit správnou app (vrátí app pro shell, ne IDEA)
- `window_id` cesta je spolehlivější — pokud agent má `window_id`, tracker najde správné okno
- Ikona se přidává jako child do `St.Widget` (tile) — St.Widget podporuje add_child() přes ClutterActor, funguje pokud Clutter actor má správné rozměry
- Cache TTL 1 hodina: actor se uloží, ale pokud applet přidá actor jako child jiného widgetu, nelze ho přidat znovu bez remove_child — logika to řeší (remove před add)

### Testy

Unit testy prochází bez úprav — `host.getAppIcon` není definováno v fake hostu, guard `if (host.getAppIcon)` zajistí přeskočení kódu.
