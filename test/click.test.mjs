import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createIndicator } from "../shared/core.mjs";
import { makeFakeEnv } from "./fakes/gjs-fakes.mjs";

const sc1Fixture = JSON.parse(
    readFileSync(new URL("../test-fixtures/scenarios/sc1-idea-same-name/server-state/after-both-registered.json", import.meta.url))
);
const sc2Fixture = JSON.parse(
    readFileSync(new URL("../test-fixtures/scenarios/sc2-idea-and-ghostty/server-state/after-both-registered.json", import.meta.url))
);

function makeHost() {
    return {
        panelHeight()     { return 40; },
        panelPosition()   { return "bottom"; },
        getPointer()      { return [100, 200]; },
        screenSize()      { return [1920, 1080]; },
        getFocusedXid()   { return null; },
        getWindowActors() { return []; },
        spawn(_argv)      {},
    };
}

function makeIndicator(fixture) {
    const { deps } = makeFakeEnv();
    const clicks = [];
    const indicator = createIndicator({
        deps,
        host: makeHost(),
        onClick: (pid, agent, action) => { clicks.push({ pid, agent, action }); },
        config: { stateFile: "/tmp/nonexistent.json", fallbackMs: 999999 },
    });
    indicator.__test_setState({ agents: fixture });
    return { indicator, clicks };
}

describe("SC1 click: 2x IDEA, stejné jméno projektu", () => {
    test("klik na agenta A → onClick dostane PID 10001 jako string", () => {
        const { indicator, clicks } = makeIndicator(sc1Fixture);
        indicator.__test_clickPid("10001");
        assert.equal(clicks.length, 1, "onClick by měl být zavolán právě jednou");
        assert.equal(clicks[0].pid, "10001");
    });

    test("klik na agenta B → onClick dostane PID 10002, ne 10001", () => {
        const { indicator, clicks } = makeIndicator(sc1Fixture);
        indicator.__test_clickPid("10002");
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "10002");
        assert.notEqual(clicks[0].pid, "10001");
    });

    test("klik na každého agenta zvlášť → dva různé PID", () => {
        const { indicator, clicks } = makeIndicator(sc1Fixture);
        indicator.__test_clickPid("10001");
        indicator.__test_clickPid("10002");
        assert.equal(clicks.length, 2);
        assert.notEqual(clicks[0].pid, clicks[1].pid);
    });
});

describe("SC2 click: IDEA + Ghostty", () => {
    test("klik na IDEA agenta (20001) → PID IDEA agenta", () => {
        const { indicator, clicks } = makeIndicator(sc2Fixture);
        indicator.__test_clickPid("20001");
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "20001");
    });

    test("klik na Ghostty agenta (20002) → PID Ghostty agenta, ne IDEA", () => {
        const { indicator, clicks } = makeIndicator(sc2Fixture);
        indicator.__test_clickPid("20002");
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "20002");
        assert.notEqual(clicks[0].pid, "20001");
    });
});
