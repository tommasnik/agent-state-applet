---
id: TASK-12.3
title: 'TASK-12c: DI pro system calls ve focus route'
status: Done
assignee: []
created_date: '2026-05-26 08:10'
updated_date: '2026-05-26 08:25'
labels:
  - testing
  - refactor
  - server
dependencies: []
parent_task_id: TASK-12
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Aktuálně `focus.ts` volá `execSync`, `spawnSync` a `http.request` přímo — nelze mockovat bez jest.mock na celý modul. DI umožní injektovat testovací implementaci.

## Interface

```typescript
// src/system-calls.ts
export interface SystemCalls {
  /** Spustí wmctrl -l a vrátí stdout */
  wmctrlList(): string;
  /** wmctrl -i -a <xid> */
  wmctrlFocus(xid: string): void;
  /** wmctrl -s <desktop> */
  wmctrlSwitchDesktop(desktop: string): void;
  /** HTTP GET/POST na danou URL (fire-and-forget) */
  httpGet(url: string): void;
}

export const defaultSystemCalls: SystemCalls = {
  wmctrlList: () => execSync("wmctrl -l", { env, timeout: 2000 }).toString(),
  wmctrlFocus: (xid) => spawnSync("wmctrl", ["-i", "-a", xid], ...),
  wmctrlSwitchDesktop: (desktop) => spawnSync("wmctrl", ["-s", desktop], ...),
  httpGet: (url) => { const req = http.request(url, ...); req.end(); },
};
```

## Změna v createFocusRouter

```typescript
export function createFocusRouter(
  store: AgentStore,
  writeState: WriteStateFn,
  sys: SystemCalls = defaultSystemCalls  // default = produkce
): Router
```

## Mock v testech

```typescript
const mockSys: SystemCalls = {
  wmctrlList: jest.fn().mockReturnValue(wmctrlFixture),
  wmctrlFocus: jest.fn(),
  wmctrlSwitchDesktop: jest.fn(),
  httpGet: jest.fn(),
};
```

## Pozor

- `defaultSystemCalls` potřebuje `DISPLAY` env — vyřešit lazy (při zavolání, ne při importu)
- Stávající `resolveWindowId` zůstane jako čistá funkce — DI se týká jen side effectů
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SystemCalls interface exportován z src/system-calls.ts
- [x] #2 createFocusRouter přijímá SystemCalls jako 3. argument s defaultem
- [x] #3 existující focus.test.ts (resolveWindowId testy) stále prochází
- [x] #4 defaultSystemCalls volá stejné příkazy jako původní kód
<!-- AC:END -->
