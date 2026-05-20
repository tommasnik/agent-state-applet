---
id: TASK-5
title: Running agents dashboard — live přehled + proklik do terminálu
status: Done
assignee: []
created_date: '2026-05-20 05:22'
updated_date: '2026-05-20 05:45'
labels: []
milestone: 'M2: Live Dashboard'
dependencies:
  - TASK-4
references:
  - /home/tom/code/demo-pages/sites/agent-dashboard-demo/src/App.jsx
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementovat AgentsPage — hlavní dashboard zobrazující aktivní agenty s live aktualizacemi přes WebSocket.

## Referenční prototyp

`/home/tom/code/demo-pages/sites/agent-dashboard-demo` — viz `src/App.jsx` funkce `ActiveAgentsView`, `AttentionCard`, `WorkingCard`, `AgentTerminalModal`.

## Layout topbaru

Stats v topbaru (pravá strana před hlavní navigací):
```
● 2 needs  ● 3 working  ● 1 idle
```
Malé barevné tečky: amber pro needs, green pro working, muted pro idle.

## Dvě sekce dashboardu

### Sekce "Needs your attention" (zobrazit jen pokud > 0)
Zvýrazněná sekce s pulsujícím amber indikátorem v nadpisu + počet.

**AttentionCard** — velká, klikatelná karta:
- Levý svislý barevný pruh (barva projektu)
- Řádek hlavičky: název projektu (v barvě projektu) | "Needs input" pulse badge | čas "Xs ago"
- Session title (AI-generovaný)
- Inline zobrazení otázky agenta: `? <text otázky>` — otázka je vidět přímo na kartě bez nutnosti otevřít detail
- Patička: terminal tag | model | `$X.XX · Xk tok` | "Reply →" CTA vpravo
- Klik → otevře AgentTerminalModal

### Sekce "Working"
Standardní sekce s pulsujícím green indikátorem + počet.

**WorkingCard** — kompaktnější karta:
- Levý úzký barevný proužek (barva projektu)
- Hlavička: název projektu (v barvě) · session title
- Sub-řádek: green pulse | "Working" | terminal tag | model | "last Xs"
- Poslední řádek logu agenta (zkrácen na ~110 znaků)
- Cena vpravo: `$X.XX` + `Xk tok` muted
- Klik → otevře AgentTerminalModal

### Třídění karet
needs-input first, pak working; v rámci skupiny sestupně podle lastEvent.

### Idle / done agenti
V Active view se nezobrazují (idle/done jsou viditelné v Projects view).

## AgentTerminalModal

Modal s detailem a log výstupem:

**Hlavička**: status dot + "projekt · session title" + zavírací tlačítko

**Meta grid** (2-sloupcový):
```
Status      Working
Model       opus-4.7
Terminal    tmux: dev-1
Started     14m ago
Last event  12s ago
Cost        $2.41 · 184k→8k tok
```

**Notice banner**: "Read-only mirror of the agent's terminal. To chat, attach to the actual session."

**Terminal log**: scrollovatelný, barevné řádky dle typu:
- `tool` — muted/dim text (výstupy nástrojů, ⏺ prefix)
- `asst` — světlý text (asistentovy zprávy)
- `user` — accent/highlighted text
- Animovaný caret "working…" pokud status=working
- Amber caret "waiting for user input" pokud needs-input

**Quick reply** (pouze pokud needs-input): textarea "Type a short answer to unblock the agent…"

**Patička tlačítek**:
- Close (vlevo)
- "Attach terminal →" → POST /api/focus {pid} (přenese fokus na okno)
- "Send reply" (primary, disabled pokud prázdný) — pouze pokud needs-input

## Mapování stavů

Naše stavy → UI sekce:
- `asking_user`, `waiting_for_approval` → "Needs your attention" (needs-input)
- `working`, `initialized` → "Working"
- `done` → nezobrazovat v Active view (viditelné v Projects view)

## Datový zdroj
- WebSocket z TASK-4 (`useAgents` hook)
- Fallback: GET /api/status při prvním render
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sekce 'Needs your attention' zobrazuje agenty ve stavu asking_user/waiting_for_approval s inline textem otázky
- [x] #2 Sekce 'Working' zobrazuje agenty ve stavu working/initialized s posledním řádkem logu
- [x] #3 Topbar stats (needs/working/idle) se aktualizují live
- [x] #4 Čas 'last Xs' se aktualizuje každou sekundu bez re-renderu celé stránky
- [x] #5 Klik na kartu otevře AgentTerminalModal s meta gridem a log výstupem
- [x] #6 'Attach terminal →' volá POST /api/focus a přenese fokus na správné okno
- [x] #7 Quick reply textarea se zobrazí pouze u needs-input agentů
- [x] #8 Idle a done agenti se v Active view nezobrazují
<!-- AC:END -->
