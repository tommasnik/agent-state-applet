import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createIndicator, STATE_COLOR, DEFAULT_CONFIG, TERMINAL_ICON } from "../shared/core.mjs";
import { makeFakeEnv } from "./fakes/gjs-fakes.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function agent(overrides) {
    return {
        pid:          "1",
        state:        "working",
        project_root: "/proj/foo",
        cwd:          "/proj/foo",
        started_at:   1000,
        ...overrides,
    };
}

function makeHost() {
    return {
        spawnCalls: [],
        windowId:   null,
        spawn(argv)        { this.spawnCalls.push(argv); },
        panelHeight()      { return 40; },
        panelPosition()    { return "bottom"; },
        getPointer()       { return [100, 200]; },
        screenSize()       { return [1920, 1080]; },
        getFocusedXid()    { return this.windowId; },
        getWindowActors()  { return []; },
    };
}

function setup(initialState) {
    const env = makeFakeEnv();
    const STATE_FILE = "/tmp/claude-agents-test.json";
    env.setFile(STATE_FILE, initialState || { agents: {} });
    const host = makeHost();
    const clicks = [];
    const ind = createIndicator({
        deps:   env.deps,
        host,
        config: { stateFile: STATE_FILE },
        onClick: (pid, agent, action) => clicks.push({ pid, agent, action }),
    });
    return { env, host, ind, clicks, STATE_FILE };
}

// Walk the indicator's box tree looking for ball widgets (those whose style
// contains "background-color: #" — the per-state color).
function findBalls(box) {
    const out = [];
    function visit(node) {
        if (!node) return;
        if (typeof node.style === "string" && /background-color:\s*#/.test(node.style)
            && /border-radius/.test(node.style)) out.push(node);
        for (const c of node.children || []) visit(c);
    }
    visit(box);
    return out;
}

function findLabels(box) {
    const out = [];
    function visit(node) {
        if (!node) return;
        if (node._text !== undefined && node._text !== "" && node._text != null) out.push(node);
        for (const c of node.children || []) visit(c);
    }
    visit(box);
    return out;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
describe("createIndicator: lifecycle", () => {
    test("empty state → box has no group children", () => {
        const { ind } = setup({ agents: {} });
        assert.equal(ind.box.children.length, 0);
        ind.destroy();
    });

    test("destroy clears all entries and timers", () => {
        const { ind, env } = setup({ agents: { "1": agent() } });
        assert.ok(env.env.timers.size > 0, "fallback timer registered");
        const entries = ind.__test_getEntries();
        assert.equal(Object.keys(entries).length, 1);
        ind.destroy();
        assert.equal(env.env.timers.size, 0, "all timers removed on destroy");
        assert.equal(Object.keys(ind.__test_getEntries()).length, 0);
    });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe("createIndicator: rendering", () => {
    test("single agent → 1 group block, 1 ball", () => {
        const { ind } = setup({ agents: { "1": agent() } });
        const balls = findBalls(ind.box);
        assert.equal(balls.length, 1);
        // ball color matches "working" state
        assert.ok(balls[0].style.includes(STATE_COLOR.working), "ball uses working color");
        ind.destroy();
    });

    test("2 agents same project → 1 group, 2 balls", () => {
        const { ind } = setup({ agents: {
            "1": agent({ pid: "1", started_at: 1 }),
            "2": agent({ pid: "2", started_at: 2 }),
        }});
        const balls = findBalls(ind.box);
        assert.equal(balls.length, 2);
        // Only one group block = one direct child + (no separator before first)
        assert.equal(ind.box.children.length, 1);
        ind.destroy();
    });

    test("2 agents different projects → 2 groups + separator", () => {
        const { ind } = setup({ agents: {
            "1": agent({ pid: "1", project_root: "/proj/a", cwd: "/proj/a" }),
            "2": agent({ pid: "2", project_root: "/proj/b", cwd: "/proj/b" }),
        }});
        // children: groupA, sep, groupB
        assert.equal(ind.box.children.length, 3);
        ind.destroy();
    });

    test("group label shows project name (no terminal_type → no icon prefix)", () => {
        const { ind } = setup({ agents: { "1": agent({ project_root: "/x/myproject" }) } });
        const labels = findLabels(ind.box);
        const hasName = labels.some(l => l._text === "myproject");
        assert.ok(hasName, "project name appears as a label");
        ind.destroy();
    });

    test("group label includes terminal icon for idea", () => {
        const { ind } = setup({ agents: { "1": agent({ project_root: "/x/myproject", terminal_type: "idea" }) } });
        const labels = findLabels(ind.box);
        const found = labels.find(l => l._text && l._text.includes("myproject"));
        assert.ok(found, "label with project name not found");
        assert.ok(found._text.includes(TERMINAL_ICON.idea),
            `Label '${found._text}' neobsahuje IDEA ikonu '${TERMINAL_ICON.idea}'`);
        ind.destroy();
    });

    test("group label includes terminal icon for ghostty", () => {
        const { ind } = setup({ agents: { "1": agent({ project_root: "/x/myproject", terminal_type: "ghostty" }) } });
        const labels = findLabels(ind.box);
        const found = labels.find(l => l._text && l._text.includes("myproject"));
        assert.ok(found, "label with project name not found");
        assert.ok(found._text.includes(TERMINAL_ICON.ghostty),
            `Label '${found._text}' neobsahuje Ghostty ikonu '${TERMINAL_ICON.ghostty}'`);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
describe("createIndicator: state transitions", () => {
    test("ball widget persists across re-renders for same pid", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        const ballBefore = ind.__test_getEntries()["1"].ball;
        ind.__test_setState({ agents: { "1": agent({ state: "done" }) } });
        const ballAfter = ind.__test_getEntries()["1"].ball;
        assert.strictEqual(ballBefore, ballAfter, "same ball widget reused");
        assert.ok(ballAfter.style.includes(STATE_COLOR.done), "ball restyled to done color");
        assert.equal(ind.__test_getEntries()["1"].state, "done");
        ind.destroy();
    });

    test("stale pid → ball destroyed", () => {
        const { ind } = setup({ agents: {
            "1": agent({ pid: "1" }),
            "2": agent({ pid: "2" }),
        }});
        const ball1 = ind.__test_getEntries()["1"].ball;
        ind.__test_setState({ agents: { "2": agent({ pid: "2" }) } });
        assert.ok(ball1._destroyed, "pid 1 ball was destroyed");
        assert.equal(Object.keys(ind.__test_getEntries()).length, 1);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// Click handling — unified across platforms
// ---------------------------------------------------------------------------
describe("createIndicator: clicks", () => {
    test("click on working ball → onClick(pid, agent, 'focus')", () => {
        const { ind, clicks } = setup({ agents: { "1": agent({ state: "working" }) } });
        const ball = ind.__test_getEntries()["1"].ball;
        ball.emit("button-press-event", { get_button: () => 1 });
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "1");
        assert.equal(clicks[0].action, "focus");
        ind.destroy();
    });

    test("click on done ball → onClick(pid, agent, 'reset')", () => {
        const { ind, clicks } = setup({ agents: { "1": agent({ state: "done" }) } });
        const ball = ind.__test_getEntries()["1"].ball;
        ball.emit("button-press-event", { get_button: () => 1 });
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].action, "reset");
        ind.destroy();
    });

    test("right-click → no onClick", () => {
        const { ind, clicks } = setup({ agents: { "1": agent() } });
        const ball = ind.__test_getEntries()["1"].ball;
        ball.emit("button-press-event", { get_button: () => 3 });
        assert.equal(clicks.length, 0);
        ind.destroy();
    });

    test("group label click → onClick with focus action", () => {
        const { ind, clicks } = setup({ agents: { "1": agent({ window_id: "0x100" }) } });
        const labels = findLabels(ind.box);
        const groupLbl = labels.find(l => l._text === "foo");
        assert.ok(groupLbl, "group label exists");
        groupLbl.emit("button-press-event", { get_button: () => 1 });
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "1");
        assert.equal(clicks[0].action, "focus");
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
describe("createIndicator: tooltip", () => {
    test("ball hover → tooltip shown with state label", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        const entry = ind.__test_getEntries()["1"];
        entry.ball.emit("enter-event");
        const markup = entry.tooltip._actor.clutter_text._markup;
        assert.ok(markup.includes("Working"), "tooltip contains state label");
        assert.ok(markup.includes("foo"),     "tooltip contains project name");
        ind.destroy();
    });

    test("leave hides tooltip", () => {
        const { ind } = setup({ agents: { "1": agent() } });
        const entry = ind.__test_getEntries()["1"];
        entry.ball.emit("enter-event");
        assert.equal(entry.tooltip._actor._visible, true);
        entry.ball.emit("leave-event");
        assert.equal(entry.tooltip._actor._visible, false);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------
describe("createIndicator: file watcher", () => {
    test("file change → debounced update", () => {
        const { ind, env, STATE_FILE } = setup({ agents: {} });
        assert.equal(findBalls(ind.box).length, 0);
        env.setFile(STATE_FILE, { agents: { "1": agent() } });
        env.triggerFileChange(STATE_FILE);
        // Drain the debounce timer
        env.runAllTimers();
        // The timer callback calls update() which reads the new file
        assert.equal(findBalls(ind.box).length, 1, "ball appeared after file change");
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// applyConfig
// ---------------------------------------------------------------------------
describe("createIndicator: applyConfig", () => {
    test("override colors → ball restyled on next render", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        ind.applyConfig({ colors: { ...STATE_COLOR, working: "#deadbeef" } });
        const ball = ind.__test_getEntries()["1"].ball;
        assert.ok(ball.style.includes("#deadbeef"), "custom color applied");
        ind.destroy();
    });

    test("partial config merges with defaults", () => {
        const { ind } = setup({ agents: {} });
        ind.applyConfig({ ballBorderRadius: 99 });
        const cfg = ind.__test_getCfg();
        assert.equal(cfg.ballBorderRadius, 99);
        assert.equal(cfg.ballMargin, DEFAULT_CONFIG.ballMargin, "other defaults preserved");
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// Tooltip placement (settings-future-proofing)
// ---------------------------------------------------------------------------
describe("createIndicator: tooltip placement", () => {
    test("panelPosition 'bottom' → tooltip above cursor", () => {
        const { ind, host } = setup({ agents: { "1": agent() } });
        host.panelPosition = () => "bottom";
        const entry = ind.__test_getEntries()["1"];
        // Make the tooltip actor have known size for math
        entry.tooltip._actor.width  = 100;
        entry.tooltip._actor.height = 50;
        entry.ball.emit("enter-event");
        const ty = entry.tooltip._actor.y;
        assert.ok(ty < 200, `tooltip y ${ty} should be above cursor y=200`);
        ind.destroy();
    });

    test("panelPosition 'top' → tooltip below cursor", () => {
        const { ind, host } = setup({ agents: { "1": agent() } });
        host.panelPosition = () => "top";
        const entry = ind.__test_getEntries()["1"];
        entry.tooltip._actor.width  = 100;
        entry.tooltip._actor.height = 50;
        entry.ball.emit("enter-event");
        const ty = entry.tooltip._actor.y;
        assert.ok(ty > 200, `tooltip y ${ty} should be below cursor y=200`);
        ind.destroy();
    });

    test("forced placement: 'above' overrides panel position", () => {
        const { ind, host } = setup({ agents: { "1": agent() } });
        host.panelPosition = () => "top";
        ind.applyConfig({ tooltipPlacement: "above" });
        const entry = ind.__test_getEntries()["1"];
        entry.tooltip._actor.width  = 100;
        entry.tooltip._actor.height = 50;
        entry.ball.emit("enter-event");
        const ty = entry.tooltip._actor.y;
        assert.ok(ty < 200, `forced 'above' should still place tooltip above cursor; got y=${ty}`);
        ind.destroy();
    });
});
