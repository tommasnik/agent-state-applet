---
id: TASK-4
title: React/Vite UI scaffold + WebSocket live state
status: Done
assignee: []
created_date: '2026-05-20 05:22'
updated_date: '2026-05-20 05:35'
labels: []
milestone: 'M1: Infrastructure'
dependencies:
  - TASK-3
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vytvořit základní React/Vite/TypeScript projekt v `ui/`, propojit ho s TS serverem přes WebSocket a nastavit routing a layout.

## Struktura

```
ui/
  src/
    main.tsx
    App.tsx
    hooks/
      useAgents.ts      ← WebSocket hook, live stav agentů
    store/
      agents.ts         ← Zustand nebo Context pro stav
    components/
      Layout.tsx        ← sidebar + main content
      Sidebar.tsx       ← navigace: Agents | Schedules | Projects | Prompts
    pages/
      AgentsPage.tsx
      SchedulesPage.tsx
      ProjectsPage.tsx
      PromptsPage.tsx
  index.html
  vite.config.ts
  tsconfig.json
  package.json
```

## Technické detaily

- Vite dev server proxy `/api/*` a `/ws` na `localhost:7855` (jen pro development)
- `npm run build` → `ui/dist/` → Express servíruje jako statiku
- React Router pro navigaci mezi stránkami
- WebSocket hook: při disconnect automaticky reconnect (exponential backoff)
- Základní design system: CSS variables pro barvy stavů agentů (grey/yellow/blue/orange/green) konzistentní s appletem

## Vite config (dev proxy)

```ts
proxy: {
  '/api': 'http://localhost:7855',
  '/ws': { target: 'ws://localhost:7855', ws: true }
}
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm run dev spustí UI na localhsotu
- [x] #2 npm run build vytvoří dist/ který Express servíruje přes GET /
- [x] #3 WebSocket hook se připojí na /ws a přijímá agent state updates
- [x] #4 Routing funguje (4 stránky)
- [x] #5 Sidebar navigace přepíná stránky
- [x] #6 Barvy stavů agentů jsou konzistentní s appletem
<!-- AC:END -->
