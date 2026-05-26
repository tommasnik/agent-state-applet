---
id: TASK-12.6
title: 'TASK-12f: Applet scénářové testy — mock server, render + klik'
status: Done
assignee: []
created_date: '2026-05-26 08:11'
updated_date: '2026-05-26 08:39'
labels:
  - testing
  - applet
  - js
dependencies:
  - TASK-12.1
parent_task_id: TASK-12
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ověření, že applet správně zobrazí oba scénáře a při kliknutí zavolá /focus se správným PID. Rozšíření stávajících `test/render.test.mjs` + nový `test/click.test.mjs`.

## Závislosti

Vyžaduje TASK-12a (fixtures).

## Co testovat

### render.test.mjs — rozšíření

```javascript
import sc1 from "../test-fixtures/scenarios/sc1-idea-same-name/server-state/after-both-registered.json" assert { type: "json" };
import sc2 from "../test-fixtures/scenarios/sc2-idea-and-ghostty/server-state/after-both-registered.json" assert { type: "json" };

describe("SC1: render ze server-state fixture", () => {
    test("2 skupiny s disambiguovanými labely", () => {
        const r = describeRender(sc1.agents, PH);
        assert.equal(r.length, 2);
        const labels = new Set(r.map(g => g.label));
        assert.ok(labels.has("work/proj1"));
        assert.ok(labels.has("subfolder/proj1"));
    });
    test("každá skupina má 1 agenta", () => { ... });
});

describe("SC2: render ze server-state fixture", () => {
    test("2 skupiny se stejným labelem proj1", () => {
        const r = describeRender(sc2.agents, PH);
        assert.equal(r.length, 2);
        assert.ok(r.every(g => g.label === "proj1"));
    });
});
```

### click.test.mjs — nový soubor

Testuje, že `createIndicator` při kliknutí zavolá fetch na správný endpoint se správnými daty.

```javascript
// Fake GJS deps (St, GLib, etc.) — rozšíření stávajícího fake-deps patternu
// Mock fetch: zachytí POST /focus

test("SC1: klik na agenta A → POST /focus s PID agenta A", async () => {
    const fetchCalls = [];
    const fakeFetch = (url, opts) => { fetchCalls.push({url, body: JSON.parse(opts.body)}); return Promise.resolve({json: () => ({})}); };

    const indicator = createIndicator({ deps: fakeDeps, host: fakeHost, onClick: (pid) => {
        fakeFetch("http://127.0.0.1:7855/focus", { method: "POST", body: JSON.stringify({pid}) });
    }});
    indicator.__test_setState(sc1);

    // Simulace kliknutí na agenta A (první skupina)
    indicator.__test_clickPid(agentAPid);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.pid, agentAPid);
    assert.notEqual(fetchCalls[0].body.pid, agentBPid);
});

test("SC2: klik na IDEA agenta → POST /focus s IDEA agent PID (ne Ghostty PID)", ...);
```

## Poznámka k `__test_clickPid`

Přidat test hook do `createIndicator` returns: `__test_clickPid(pid)` — zavolá `dispatchClick(pid)` přímo bez nutnosti simulovat DOM event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SC1 render: 2 skupiny s labely work/proj1 a subfolder/proj1 ze server-state fixture
- [x] #2 SC2 render: 2 skupiny obě s labelem proj1
- [x] #3 SC1 klik: onClick dostane správný PID (ne PID druhého agenta)
- [x] #4 SC2 klik na IDEA agenta: PID ID IDEA agenta, ne Ghostty
- [x] #5 __test_clickPid test hook přidán do createIndicator returns
- [x] #6 Testy používají server-state fixture soubory (ne dužlogá inline data)
<!-- AC:END -->
