---
id: TASK-12.2
title: 'TASK-12b: Server refactor — buildApp() odděleno od listen()'
status: Done
assignee: []
created_date: '2026-05-26 08:09'
updated_date: '2026-05-26 08:23'
labels:
  - testing
  - refactor
  - server
dependencies: []
parent_task_id: TASK-12
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Předpoklad pro supertest E2E testy serveru. Aktuálně `index.ts` míchá app construction se side effecty (listen, setInterval, initDb).

## Co změnit

### 1. Extrahovat `buildApp()`

```typescript
// src/app.ts  (nový soubor)
export function buildApp(store: AgentStore, writeState: WriteStateFn, db: Database): express.Application {
  const app = express();
  app.use(express.json());
  // ... static files, routes ...
  app.use("/agent",  createAgentRouter(store, writeState));
  app.use("/focus",  createFocusRouter(store, writeState));
  app.use("/status", createStatusRouter(store));
  // ...
  return app;
}
```

### 2. `index.ts` zůstane jako orchestrátor

```typescript
// src/index.ts
import { buildApp } from "./app";

initDb();
schedulerInit();
restoreState();
startPidChecker();
startAiTitlePoller();

const app = buildApp(store, writeState, getDb());
const httpServer = http.createServer(app);
httpServer.listen(PORT, HOST, ...);
```

### 3. Testy importují `buildApp` přímo

```typescript
import { buildApp } from "../app";
import request from "supertest";

const app = buildApp(store, () => {}, mockDb);
await request(app).post("/agent").send(fixture).expect(200);
```

## Pozor

- `writeState` v produkci volá `getDb()` přes closure — v testech se předá no-op nebo mock
- WebSocket server zůstane v `index.ts`, ne v `buildApp` (testy ho nepotřebují)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/app.ts exportuje buildApp(store, writeState, db)
- [x] #2 src/index.ts importítuje buildApp a nepřidává žádnou route logiku
- [x] #3 existující testy stále procházejí
- [x] #4 buildApp nevolá listen(), initDb(), žádný setInterval
<!-- AC:END -->
