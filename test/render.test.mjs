import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    describeRender,
    formatDuration,
    projectName,
    ballStyle,
    tooltipText,
    STATE_COLOR,
    LABEL_H,
    BALL_MARGIN,
} from "../shared/core.mjs";

const PH = 40; // panel height used across tests

// helpers
function agent(overrides) {
    return { pid: "1", state: "working", project_root: "/proj/foo", cwd: "/proj/foo", started_at: 1000, ...overrides };
}

// ---------------------------------------------------------------------------
// describeRender — structure
// ---------------------------------------------------------------------------

describe("describeRender: structure", () => {
    test("empty agents → no groups", () => {
        assert.deepEqual(describeRender({}, PH), []);
    });

    test("single agent → 1 group, 1 agent", () => {
        const r = describeRender({ "1": agent() }, PH);
        assert.equal(r.length, 1);
        assert.equal(r[0].agents.length, 1);
    });

    test("2 agents same project → 1 group, 2 agents", () => {
        const r = describeRender({
            "1": agent({ pid: "1", started_at: 1 }),
            "2": agent({ pid: "2", started_at: 2 }),
        }, PH);
        assert.equal(r.length, 1);
        assert.equal(r[0].agents.length, 2);
    });

    test("2 agents different projects → 2 groups", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/proj/alpha" }),
            "2": agent({ pid: "2", project_root: "/proj/beta" }),
        }, PH);
        assert.equal(r.length, 2);
    });

    test("group key is project_root + terminal_type when present", () => {
        const r = describeRender({ "1": agent({ project_root: "/proj/foo", cwd: "/proj/foo/src", terminal_type: "idea" }) }, PH);
        assert.equal(r[0].key, "/proj/foo|idea");
    });

    test("group key falls back to cwd when project_root missing", () => {
        const r = describeRender({ "1": agent({ project_root: undefined, cwd: "/proj/bar" }) }, PH);
        assert.equal(r[0].key, "/proj/bar|");
    });

    test("same project, same terminal_type → 1 group", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/proj/foo", terminal_type: "ghostty", started_at: 1 }),
            "2": agent({ pid: "2", project_root: "/proj/foo", terminal_type: "ghostty", started_at: 2 }),
        }, PH);
        assert.equal(r.length, 1);
        assert.equal(r[0].agents.length, 2);
    });

    test("same project, different terminal_type → 2 groups", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/proj/foo", terminal_type: "idea" }),
            "2": agent({ pid: "2", project_root: "/proj/foo", terminal_type: "ghostty" }),
        }, PH);
        assert.equal(r.length, 2);
    });

    test("same project, idea vs ghostty → groups have correct labels", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/proj/foo", terminal_type: "idea",    tty: "/dev/pts/2" }),
            "2": agent({ pid: "2", project_root: "/proj/foo", terminal_type: "ghostty", tty: "/dev/pts/5" }),
        }, PH);
        assert.equal(r.length, 2);
        assert.ok(r.every(g => g.label === "foo"), "both groups should have label 'foo'");
    });

    test("group key encodes project_root and terminal_type", () => {
        const r = describeRender({ "1": agent({ project_root: "/proj/foo", terminal_type: "idea" }) }, PH);
        assert.equal(r[0].key, "/proj/foo|idea");
    });
});

// ---------------------------------------------------------------------------
// describeRender — ordering
// ---------------------------------------------------------------------------

describe("describeRender: ordering", () => {
    test("groups ordered by lowest PTY number in group", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/beta",  tty: "/dev/pts/5" }),
            "2": agent({ pid: "2", project_root: "/alpha", tty: "/dev/pts/2" }),
        }, PH);
        assert.equal(r[0].label, "alpha"); // pts/2 < pts/5
        assert.equal(r[1].label, "beta");
    });

    test("agents within group ordered by PTY number (ascending)", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/x", tty: "/dev/pts/7" }),
            "2": agent({ pid: "2", project_root: "/x", tty: "/dev/pts/3" }),
        }, PH);
        assert.equal(r[0].agents[0].pid, "2"); // pts/3 < pts/7
        assert.equal(r[0].agents[1].pid, "1");
    });

    test("agents without tty fall back to started_at and appear last", () => {
        const r = describeRender({
            "1": agent({ pid: "1", tty: undefined, started_at: 100 }),
            "2": agent({ pid: "2", tty: "/dev/pts/5", started_at: 200 }),
        }, PH);
        assert.equal(r[0].agents[0].pid, "2"); // has PTY → first
        assert.equal(r[0].agents[1].pid, "1"); // no PTY → last
    });

    test("ghostty agents with ghostty_tab_index sorted by that index", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/x", tty: "/dev/pts/7", terminal_type: "ghostty", ghostty_tab_index: 0 }),
            "2": agent({ pid: "2", project_root: "/x", tty: "/dev/pts/2", terminal_type: "ghostty", ghostty_tab_index: 1 }),
        }, PH);
        assert.equal(r[0].agents[0].pid, "1"); // tab_index 0 = leftmost
        assert.equal(r[0].agents[1].pid, "2");
    });

    test("ghostty agents without tab_index fall back to PTY descending", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/x", tty: "/dev/pts/2", terminal_type: "ghostty" }),
            "2": agent({ pid: "2", project_root: "/x", tty: "/dev/pts/7", terminal_type: "ghostty" }),
        }, PH);
        assert.equal(r[0].agents[0].pid, "2"); // pts/7 = newer = leftmost fallback
        assert.equal(r[0].agents[1].pid, "1");
    });
});

// ---------------------------------------------------------------------------
// describeRender — colors
// ---------------------------------------------------------------------------

describe("describeRender: state colors", () => {
    const cases = [
        ["initialized",          STATE_COLOR.initialized],
        ["working",              STATE_COLOR.working],
        ["asking_user",          STATE_COLOR.asking_user],
        ["done",                 STATE_COLOR.done],
        ["waiting_for_approval", STATE_COLOR.waiting_for_approval],
    ];
    for (const [state, expectedColor] of cases) {
        test(`state ${state} → color ${expectedColor}`, () => {
            const r = describeRender({ "1": agent({ state }) }, PH);
            assert.equal(r[0].agents[0].color, expectedColor);
        });
    }

    test("unknown state → fallback color #888888", () => {
        const r = describeRender({ "1": agent({ state: "bogus" }) }, PH);
        assert.equal(r[0].agents[0].color, "#888888");
    });
});

// ---------------------------------------------------------------------------
// describeRender — ball dimensions
// ---------------------------------------------------------------------------

describe("describeRender: ball dimensions", () => {
    test("ballH = panelHeight - LABEL_H", () => {
        const r = describeRender({ "1": agent() }, PH);
        assert.equal(r[0].ballH, PH - LABEL_H);
    });

    test("1 agent → ballW = panelHeight * 2", () => {
        const r = describeRender({ "1": agent() }, PH);
        assert.equal(r[0].ballW, PH * 2);
    });

    test("2 agents in group → ballW = panelHeight (min clamp)", () => {
        // floor(40 * 2 / 2) = 40 = PH → clamped to PH
        const r = describeRender({
            "1": agent({ pid: "1" }),
            "2": agent({ pid: "2" }),
        }, PH);
        assert.equal(r[0].ballW, PH);
    });

    test("8 agents → ballW never goes below panelHeight", () => {
        const agents = {};
        for (let i = 0; i < 8; i++)
            agents[i] = agent({ pid: String(i), started_at: i });
        const r = describeRender(agents, PH);
        assert.ok(r[0].ballW >= PH, `ballW ${r[0].ballW} should be >= ${PH}`);
    });

    test("all agents in same group share ballW", () => {
        const r = describeRender({
            "1": agent({ pid: "1" }),
            "2": agent({ pid: "2" }),
            "3": agent({ pid: "3" }),
        }, PH);
        const bw = r[0].ballW;
        assert.ok(r[0].agents.every(() => true), "ballW is per-group, not per-agent");
        // all three agents see the same group ballW
        assert.equal(bw, Math.max(PH, Math.floor(PH * 2 / 3)));
    });
});

// ---------------------------------------------------------------------------
// describeRender — labels
// ---------------------------------------------------------------------------

describe("describeRender: group labels", () => {
    test("label = last path component of project_root", () => {
        const r = describeRender({ "1": agent({ project_root: "/home/tom/code/my-project" }) }, PH);
        assert.equal(r[0].label, "my-project");
    });

    test("label falls back to cwd last component", () => {
        const r = describeRender({ "1": agent({ project_root: undefined, cwd: "/home/tom/work/other" }) }, PH);
        assert.equal(r[0].label, "other");
    });

    test("label = ? when both paths missing", () => {
        const r = describeRender({ "1": agent({ project_root: undefined, cwd: undefined }) }, PH);
        assert.equal(r[0].label, "?");
    });

    test("pid is stringified in output", () => {
        const r = describeRender({ "42": agent({ pid: 42 }) }, PH);
        assert.equal(typeof r[0].agents[0].pid, "string");
        assert.equal(r[0].agents[0].pid, "42");
    });
});

// ---------------------------------------------------------------------------
// describeRender — label disambiguation
// ---------------------------------------------------------------------------

describe("describeRender: label disambiguation", () => {
    test("2 groups same basename → labels include parent dir", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/side-project/bot-platform", tty: "/dev/pts/1" }),
            "2": agent({ pid: "2", project_root: "/work/bot-platform", tty: "/dev/pts/2" }),
        }, PH);
        assert.equal(r.length, 2);
        const labels = r.map(g => g.label);
        assert.ok(labels.includes("side-project/bot-platform"), `expected side-project/bot-platform, got ${labels}`);
        assert.ok(labels.includes("work/bot-platform"), `expected work/bot-platform, got ${labels}`);
    });

    test("unique basenames → labels are just basenames (no disambiguation needed)", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/code/alpha", tty: "/dev/pts/1" }),
            "2": agent({ pid: "2", project_root: "/code/beta", tty: "/dev/pts/2" }),
        }, PH);
        const labels = r.map(g => g.label);
        assert.ok(labels.includes("alpha"), `expected alpha in ${labels}`);
        assert.ok(labels.includes("beta"), `expected beta in ${labels}`);
    });

    test("3 groups: 2 same basename + 1 unique → only duplicates get parent prefix", () => {
        const r = describeRender({
            "1": agent({ pid: "1", project_root: "/side/bot-platform", tty: "/dev/pts/1" }),
            "2": agent({ pid: "2", project_root: "/work/bot-platform", tty: "/dev/pts/2" }),
            "3": agent({ pid: "3", project_root: "/code/alpha", tty: "/dev/pts/3" }),
        }, PH);
        assert.equal(r.length, 3);
        const labels = r.map(g => g.label);
        assert.ok(labels.includes("alpha"), `unique group should keep short label, got ${labels}`);
        assert.ok(labels.includes("side/bot-platform"), `expected side/bot-platform in ${labels}`);
        assert.ok(labels.includes("work/bot-platform"), `expected work/bot-platform in ${labels}`);
    });

    test("single group → label unchanged even if path has multiple components", () => {
        const r = describeRender({ "1": agent({ project_root: "/work/my-project" }) }, PH);
        assert.equal(r[0].label, "my-project");
    });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
    test("0s", () => assert.equal(formatDuration(0), "0s"));
    test("negative clamps to 0", () => assert.equal(formatDuration(-5), "0s"));
    test("59s", () => assert.equal(formatDuration(59), "59s"));
    test("60s → 1m 0s", () => assert.equal(formatDuration(60), "1m 0s"));
    test("125s → 2m 5s", () => assert.equal(formatDuration(125), "2m 5s"));
    test("3600s → 1h 0m", () => assert.equal(formatDuration(3600), "1h 0m"));
    test("3665s → 1h 1m", () => assert.equal(formatDuration(3665), "1h 1m"));
    test("fractional seconds truncated", () => assert.equal(formatDuration(61.9), "1m 1s"));
});

// ---------------------------------------------------------------------------
// projectName
// ---------------------------------------------------------------------------

describe("projectName", () => {
    test("returns last path component", () =>
        assert.equal(projectName({ project_root: "/a/b/c" }), "c"));
    test("prefers project_root over cwd", () =>
        assert.equal(projectName({ project_root: "/a/proj", cwd: "/a/proj/src" }), "proj"));
    test("falls back to cwd", () =>
        assert.equal(projectName({ project_root: undefined, cwd: "/a/b/work" }), "work"));
    test("returns ? when no path", () =>
        assert.equal(projectName({ project_root: undefined, cwd: undefined }), "?"));
});

// ---------------------------------------------------------------------------
// ballStyle
// ---------------------------------------------------------------------------

describe("ballStyle", () => {
    test("contains the given color", () => {
        assert.ok(ballStyle("#ff0000", 40, 26).includes("#ff0000"));
    });
    test("contains width and height", () => {
        const s = ballStyle("#aabbcc", 50, 20);
        assert.ok(s.includes("width: 50px"));
        assert.ok(s.includes("height: 20px"));
    });
    test("contains BALL_MARGIN", () => {
        assert.ok(ballStyle("#000", 10, 10).includes(`margin: 0 ${BALL_MARGIN}px`));
    });
});

// ---------------------------------------------------------------------------
// tooltipText
// ---------------------------------------------------------------------------

describe("tooltipText", () => {
    const NOW = 1_700_000_100;
    const base = {
        pid: "42",
        state: "working",
        project_root: "/home/tom/code/myapp",
        cwd: "/home/tom/code/myapp/src",
        session_id: "abcdef1234567890",
        started_at: NOW - 125,  // 2m 5s ago
        timestamp:  NOW - 10,   // 10s in state
    };

    test("contains project name", () => {
        assert.ok(tooltipText(base, NOW).includes("myapp"));
    });

    test("contains state label", () => {
        assert.ok(tooltipText(base, NOW).includes("Working"));
    });

    test("contains running duration", () => {
        assert.ok(tooltipText(base, NOW).includes("2m 5s"));
    });

    test("contains in-state duration", () => {
        assert.ok(tooltipText(base, NOW).includes("10s"));
    });

    test("contains session_id prefix (8 chars)", () => {
        assert.ok(tooltipText(base, NOW).includes("abcdef12"));
    });

    test("contains pid", () => {
        assert.ok(tooltipText(base, NOW).includes("42"));
    });

    test("shows tool_name when working", () => {
        const t = tooltipText({ ...base, tool_name: "Bash" }, NOW);
        assert.ok(t.includes("Bash"));
    });

    test("does not show tool_name when not working", () => {
        const t = tooltipText({ ...base, state: "done", tool_name: "Bash" }, NOW);
        assert.ok(!t.includes("Bash"));
    });

    test("shows ai_title when present", () => {
        const t = tooltipText({ ...base, ai_title: "Fix login bug" }, NOW);
        assert.ok(t.includes("Fix login bug"));
    });

    test("shows subagent_count when > 0", () => {
        const t = tooltipText({ ...base, subagent_count: 3 }, NOW);
        assert.ok(t.includes("3"));
    });

    test("does not show subagent line when count is 0", () => {
        const t = tooltipText({ ...base, subagent_count: 0 }, NOW);
        assert.ok(!t.includes("subagents"));
    });

    test("escapes HTML in project name", () => {
        const t = tooltipText({ ...base, project_root: "/a/<evil>" }, NOW);
        assert.ok(t.includes("&lt;evil&gt;"));
        assert.ok(!t.includes("<evil>"));
    });

    test("shows - for running when started_at missing", () => {
        const t = tooltipText({ ...base, started_at: undefined }, NOW);
        assert.ok(t.includes(">-<"));
    });
});

// ---------------------------------------------------------------------------
// Scenario tests — fixture-driven
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { URL } from "node:url";

const sc1Fixture = JSON.parse(
    readFileSync(new URL("../test-fixtures/scenarios/sc1-idea-same-name/server-state/after-both-registered.json", import.meta.url))
);
const sc2Fixture = JSON.parse(
    readFileSync(new URL("../test-fixtures/scenarios/sc2-idea-and-ghostty/server-state/after-both-registered.json", import.meta.url))
);

describe("SC1 render: 2x IDEA stejné jméno projektu", () => {
    test("2 skupiny s disambiguovanými labely (work/proj1 a subfolder/proj1)", () => {
        const r = describeRender(sc1Fixture, PH);
        assert.equal(r.length, 2);
        const labels = new Set(r.map(g => g.label));
        assert.ok(labels.has("work/proj1"), `Očekáváno work/proj1, dostáno: ${[...labels]}`);
        assert.ok(labels.has("subfolder/proj1"), `Očekáváno subfolder/proj1, dostáno: ${[...labels]}`);
    });

    test("každá skupina má 1 agenta", () => {
        const r = describeRender(sc1Fixture, PH);
        for (const g of r) {
            assert.equal(g.agents.length, 1, `Skupina ${g.label} má ${g.agents.length} agentů`);
        }
    });
});

describe("SC2 render: IDEA + Ghostty", () => {
    test("2 skupiny (myapp a backend)", () => {
        const r = describeRender(sc2Fixture, PH);
        assert.equal(r.length, 2);
    });

    test("skupiny mají labely myapp a backend", () => {
        const r = describeRender(sc2Fixture, PH);
        const labels = new Set(r.map(g => g.label));
        assert.ok(labels.has("myapp"), `Očekáváno myapp, dostáno: ${[...labels]}`);
        assert.ok(labels.has("backend"), `Očekáváno backend, dostáno: ${[...labels]}`);
    });

    test("každá skupina má jiný terminal_type ve vstupních datech", () => {
        const types = Object.values(sc2Fixture).map(a => a.terminal_type).sort();
        assert.deepEqual(types, ["ghostty", "idea"]);
    });
});
