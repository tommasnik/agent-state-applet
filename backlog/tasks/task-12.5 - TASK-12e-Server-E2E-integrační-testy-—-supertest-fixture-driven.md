---
id: TASK-12.5
title: 'TASK-12e: Server E2E integrační testy — supertest + fixture-driven'
status: Done
assignee: []
created_date: '2026-05-26 08:11'
updated_date: '2026-05-26 08:35'
labels:
  - testing
  - server
  - e2e
dependencies:
  - TASK-12.1
  - TASK-12.2
  - TASK-12.3
parent_task_id: TASK-12
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
E2E HTTP testy celého serveru — od POST /agent přes store až po POST /focus a ověření system call volání.

## Závislosti

Vyžaduje TASK-12a (fixtures), TASK-12b (buildApp), TASK-12c (DI system calls).

## Implementace

```typescript
// src/__tests__/scenarios.test.ts
import request from "supertest";
import { buildApp } from "../app";
import { AgentStore } from "../agents";
import * as path from "path";

const FIXTURES = path.resolve(__dirname, "../../../test-fixtures/scenarios");
const loadFixture = (scenario: string, file: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, scenario, file), "utf8"));

describe("SC1: 2× IDEA, stejné jméno projektu, jiná cesta", () => {
  let store: AgentStore;
  let mockSys: jest.Mocked<SystemCalls>;
  let app: express.Application;

  beforeEach(() => {
    store = new AgentStore();
    mockSys = {
      wmctrlList: jest.fn(),
      wmctrlFocus: jest.fn(),
      wmctrlSwitchDesktop: jest.fn(),
      httpGet: jest.fn(),
    };
    const wmctrl = fs.readFileSync(path.join(FIXTURES, "sc1-idea-same-name/wmctrl-output.txt"), "utf8");
    mockSys.wmctrlList.mockReturnValue(wmctrl);
    app = buildApp(store, () => {}, mockSys);
  });

  test("POST /agent s oběma payloady → store obsahuje 2 agenty s různými project_root", async () => {
    const a = loadFixture("sc1-idea-same-name", "hook-payloads/agent-a.json");
    const b = loadFixture("sc1-idea-same-name", "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a).expect(200);
    await request(app).post("/agent").send(b).expect(200);

    const { body } = await request(app).get("/status").expect(200);
    const agents = Object.values(body.agents);
    expect(agents).toHaveLength(2);
    const roots = agents.map((a: any) => a.project_root);
    expect(roots).toContain("/home/tom/work/proj1");
    expect(roots).toContain("/home/tom/work/subfolder/proj1");
  });

  test("GET /status snapshot odpovídá fixture server-state", async () => {
    // ... registrace obou agentů ...
    const expected = loadFixture("sc1-idea-same-name", "server-state/after-both-registered.json");
    const { body } = await request(app).get("/status");
    // porovnat relevantní pole (ne timestamp, started_at)
    for (const [pid, expectedAgent] of Object.entries(expected.agents)) {
      expect(body.agents[pid].project_root).toBe(expectedAgent.project_root);
      expect(body.agents[pid].terminal_type).toBe(expectedAgent.terminal_type);
      expect(body.agents[pid].window_id).toBe(expectedAgent.window_id);
    }
  });

  test("POST /focus pro agenta A → wmctrlFocus(0x1111), httpGet s tabName agenta A", async () => {
    // ... registrace ...
    const focusExpected = loadFixture("sc1-idea-same-name", "focus-calls/click-a.json");
    await request(app).post("/focus").send({ pid: agentAPid }).expect(200);

    expect(mockSys.wmctrlFocus).toHaveBeenCalledWith(focusExpected.wmctrl_xid);
    expect(mockSys.httpGet).toHaveBeenCalledWith(
      expect.stringContaining(focusExpected.idea_api_url_contains)
    );
  });

  test("POST /focus pro agenta B → wmctrlFocus(0x2222), ne 0x1111", async () => {
    // Klíčový test: nesmí focusnout špatné okno
    const focusExpected = loadFixture("sc1-idea-same-name", "focus-calls/click-b.json");
    await request(app).post("/focus").send({ pid: agentBPid }).expect(200);

    expect(mockSys.wmctrlFocus).toHaveBeenCalledWith(focusExpected.wmctrl_xid);
    expect(mockSys.wmctrlFocus).not.toHaveBeenCalledWith("0x1111");
  });
});

describe("SC2: IDEA + Ghostty, stejná složka", () => {
  // ...
  test("POST /focus pro IDEA agenta → httpGet zavolán (IDEA plugin)", ...);
  test("POST /focus pro Ghostty agenta → httpGet NEZAVOLÁN", ...);
  test("Oba agenti mají stejný project_root, jiný terminal_type ve store", ...);
});
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SC1: POST /focus pro agenta A volá wmctrlFocus se XID z fixture click-a.json
- [x] #2 SC1: POST /focus pro agenta B nevolá wmctrlFocus se XID agenta A
- [x] #3 SC1: /status snapshot odpovídá fixture server-state pro klíčová pole
- [x] #4 SC2: focus IDEA agenta volá httpGet s IDEA plugin URL
- [x] #5 SC2: focus Ghostty agenta nevolá httpGet
- [x] #6 SC2: oba agenti má stejný project_root ve store
- [x] #7 buildApp se používá s in-memory store (ne běžící server)
<!-- AC:END -->
