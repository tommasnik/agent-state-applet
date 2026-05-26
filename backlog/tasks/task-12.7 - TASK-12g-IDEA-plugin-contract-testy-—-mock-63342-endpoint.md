---
id: TASK-12.7
title: 'TASK-12g: IDEA plugin contract testy — mock :63342 endpoint'
status: Done
assignee: []
created_date: '2026-05-26 08:12'
updated_date: '2026-05-26 08:42'
labels:
  - testing
  - server
  - idea-plugin
dependencies:
  - TASK-12.1
  - TASK-12.3
parent_task_id: TASK-12
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ověření, že server při focus zavolá IDEA plugin REST API se správnými parametry. Testuje kontrakt na straně volajícího (server) — co IDEA plugin dostane.

## Poznámka k IDEA pluginu

IDEA plugin není součástí tohoto repo. Vystavuje REST endpoint na `localhost:63342/api/terminalFocus`. Kontrakt (parametry) definujeme tady z pohledu serveru — plugin testy jsou odpovědností plugin repo.

## Implementace

Samostatný HTTP server v testu poslouchá na mockovaném portu jako náhrada IDEA.

```typescript
// src/__tests__/idea-plugin-contract.test.ts
import * as http from "http";
import request from "supertest";
import { buildApp } from "../app";

describe("IDEA plugin contract — SC1", () => {
  let ideaMockServer: http.Server;
  let ideaReceivedUrls: string[];
  let ideaMockPort: number;

  beforeEach((done) => {
    ideaReceivedUrls = [];
    ideaMockServer = http.createServer((req, res) => {
      ideaReceivedUrls.push(req.url ?? "");
      res.writeHead(200);
      res.end();
    });
    ideaMockServer.listen(0, "127.0.0.1", () => {
      ideaMockPort = (ideaMockServer.address() as any).port;
      done();
    });
  });

  afterEach((done) => ideaMockServer.close(done));

  test("SC1 focus agent A → terminalFocus s tabName=cc-aaaaaaaa a project=proj1", async () => {
    // buildApp s mockSys.httpGet nasměrovaným na ideaMockPort
    const focusExpected = loadFixture("sc1-idea-same-name", "focus-calls/click-a.json");
    // ... setup store, POST /focus ...

    expect(ideaReceivedUrls.length).toBe(1);
    const url = new URL(ideaReceivedUrls[0], "http://x");
    expect(url.searchParams.get("tabName")).toBe(focusExpected.idea_tab_name);
    expect(url.searchParams.get("project")).toBe(focusExpected.idea_project);
  });

  test("SC1 focus agent B → tabName=cc-bbbbbbbb, project=proj1 (stejný basename!)", async () => {
    // Oba projekty mají basename proj1, plugin je rozlišuje pouze přes tabName
    const focusExpected = loadFixture("sc1-idea-same-name", "focus-calls/click-b.json");
    // ...
    expect(url.searchParams.get("tabName")).toBe(focusExpected.idea_tab_name);
    expect(url.searchParams.get("project")).toBe("proj1"); // basename, ne celá cesta
  });

  test("SC2 Ghostty focus → IDEA plugin se NEZAVOLÁ", async () => {
    // ...
    expect(ideaReceivedUrls.length).toBe(0);
  });
});
```

## Otevřená otázka

`project` parametr v IDEA API je basename projektu (`proj1`), ne celá cesta. Při SC1 tedy IDEA dostane `project=proj1` pro oba agenty — plugin musí rozlišit jen přes `tabName`. Je to tak správně? Ověřit s IDEA plugin implementací.

Pokud IDEA plugin potřebuje celou cestu pro disambiguation, je to breaking change v API kontraktu — vyřešit v tomto tasku.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SC1 agent A: IDEA plugin dostane tabName=cc-aaaaaaaa
- [x] #2 SC1 agent B: IDEA plugin dostane tabName=cc-bbbbbbbb (jiný tab)
- [x] #3 SC2 Ghostty agent: IDEA plugin se nezavolá
- [x] #4 Otevřená otázka `project` param vyřešena a zdokumentována
- [x] #5 Testy jsou součástí jest test suite a prochází v CI
<!-- AC:END -->
