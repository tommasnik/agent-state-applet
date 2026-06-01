import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createIndicator, STATE_COLOR, DEFAULT_CONFIG, TERMINAL_ICON } from "../shared/core.mjs";
import { makeFakeEnv, FakeActor } from "./fakes/gjs-fakes.mjs";

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

// Walk the indicator's box tree looking for tile widgets (those whose style
// contains "background-color: #" — the per-state color).
function findTiles(box) {
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
    test("single agent → 1 group block, 1 tile", () => {
        const { ind } = setup({ agents: { "1": agent() } });
        const tiles = findTiles(ind.box);
        assert.equal(tiles.length, 1);
        // tile color matches "working" state
        assert.ok(tiles[0].style.includes(STATE_COLOR.working), "tile uses working color");
        ind.destroy();
    });

    test("2 agents same project → 1 group, 2 tiles", () => {
        const { ind } = setup({ agents: {
            "1": agent({ pid: "1", started_at: 1 }),
            "2": agent({ pid: "2", started_at: 2 }),
        }});
        const tiles = findTiles(ind.box);
        assert.equal(tiles.length, 2);
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

    test("group label for idea shows only project name (no terminal icon prefix)", () => {
        const { ind } = setup({ agents: { "1": agent({ project_root: "/x/myproject", terminal_type: "idea" }) } });
        const labels = findLabels(ind.box);
        const found = labels.find(l => l._text && l._text.includes("myproject"));
        assert.ok(found, "label with project name not found");
        assert.strictEqual(found._text, "myproject", `Label should be just 'myproject', got '${found._text}'`);
        ind.destroy();
    });

    test("group label for ghostty shows only project name (no terminal icon prefix)", () => {
        const { ind } = setup({ agents: { "1": agent({ project_root: "/x/myproject", terminal_type: "ghostty" }) } });
        const labels = findLabels(ind.box);
        const found = labels.find(l => l._text && l._text.includes("myproject"));
        assert.ok(found, "label with project name not found");
        assert.strictEqual(found._text, "myproject", `Label should be just 'myproject', got '${found._text}'`);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
describe("createIndicator: state transitions", () => {
    test("tile widget persists across re-renders for same pid", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        const tileBefore = ind.__test_getEntries()["1"].tile;
        ind.__test_setState({ agents: { "1": agent({ state: "done" }) } });
        const tileAfter = ind.__test_getEntries()["1"].tile;
        assert.strictEqual(tileBefore, tileAfter, "same tile widget reused");
        assert.ok(tileAfter.style.includes(STATE_COLOR.done), "tile restyled to done color");
        assert.equal(ind.__test_getEntries()["1"].state, "done");
        ind.destroy();
    });

    test("stale pid → tile destroyed", () => {
        const { ind } = setup({ agents: {
            "1": agent({ pid: "1" }),
            "2": agent({ pid: "2" }),
        }});
        const tile1 = ind.__test_getEntries()["1"].tile;
        ind.__test_setState({ agents: { "2": agent({ pid: "2" }) } });
        assert.ok(tile1._destroyed, "pid 1 tile was destroyed");
        assert.equal(Object.keys(ind.__test_getEntries()).length, 1);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// Click handling — unified across platforms
// ---------------------------------------------------------------------------
describe("createIndicator: clicks", () => {
    test("click on working tile → onClick(pid, agent, 'focus')", () => {
        const { ind, clicks } = setup({ agents: { "1": agent({ state: "working" }) } });
        const tile = ind.__test_getEntries()["1"].tile;
        tile.emit("button-press-event", { get_button: () => 1 });
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].pid, "1");
        assert.equal(clicks[0].action, "focus");
        ind.destroy();
    });

    test("click on done tile → onClick(pid, agent, 'reset')", () => {
        const { ind, clicks } = setup({ agents: { "1": agent({ state: "done" }) } });
        const tile = ind.__test_getEntries()["1"].tile;
        tile.emit("button-press-event", { get_button: () => 1 });
        assert.equal(clicks.length, 1);
        assert.equal(clicks[0].action, "reset");
        ind.destroy();
    });

    test("right-click → no onClick", () => {
        const { ind, clicks } = setup({ agents: { "1": agent() } });
        const tile = ind.__test_getEntries()["1"].tile;
        tile.emit("button-press-event", { get_button: () => 3 });
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
    test("tile hover → tooltip shown with state label", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        const entry = ind.__test_getEntries()["1"];
        entry.tile.emit("enter-event");
        const markup = entry.tooltip._actor.clutter_text._markup;
        assert.ok(markup.includes("Working"), "tooltip contains state label");
        assert.ok(markup.includes("foo"),     "tooltip contains project name");
        ind.destroy();
    });

    test("leave hides tooltip", () => {
        const { ind } = setup({ agents: { "1": agent() } });
        const entry = ind.__test_getEntries()["1"];
        entry.tile.emit("enter-event");
        assert.equal(entry.tooltip._actor._visible, true);
        entry.tile.emit("leave-event");
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
        assert.equal(findTiles(ind.box).length, 0);
        env.setFile(STATE_FILE, { agents: { "1": agent() } });
        env.triggerFileChange(STATE_FILE);
        // Drain the debounce timer
        env.runAllTimers();
        // The timer callback calls update() which reads the new file
        assert.equal(findTiles(ind.box).length, 1, "tile appeared after file change");
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// applyConfig
// ---------------------------------------------------------------------------
describe("createIndicator: applyConfig", () => {
    test("override colors → tile restyled on next render", () => {
        const { ind } = setup({ agents: { "1": agent({ state: "working" }) } });
        ind.applyConfig({ colors: { ...STATE_COLOR, working: "#deadbeef" } });
        const tile = ind.__test_getEntries()["1"].tile;
        assert.ok(tile.style.includes("#deadbeef"), "custom color applied");
        ind.destroy();
    });

    test("partial config merges with defaults", () => {
        const { ind } = setup({ agents: {} });
        ind.applyConfig({ tileBorderRadius: 99 });
        const cfg = ind.__test_getCfg();
        assert.equal(cfg.tileBorderRadius, 99);
        assert.equal(cfg.tileMargin, DEFAULT_CONFIG.tileMargin, "other defaults preserved");
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
        entry.tile.emit("enter-event");
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
        entry.tile.emit("enter-event");
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
        entry.tile.emit("enter-event");
        const ty = entry.tooltip._actor.y;
        assert.ok(ty < 200, `forced 'above' should still place tooltip above cursor; got y=${ty}`);
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// App icons (host.resolveAppIcon)
// ---------------------------------------------------------------------------

// Helper: build a setup where host.resolveAppIcon returns a fake icon actor.
function setupWithIcon(initialState, resolveAppIconFn) {
    const env = makeFakeEnv();
    const STATE_FILE = "/tmp/claude-agents-icon-test.json";
    env.setFile(STATE_FILE, initialState || { agents: {} });
    const host = makeHost();
    host.resolveAppIcon = resolveAppIconFn || (() => new FakeActor());
    const ind = createIndicator({
        deps:   env.deps,
        host,
        config: { stateFile: STATE_FILE },
        onClick: () => {},
    });
    return { env, host, ind, STATE_FILE };
}

describe("createIndicator: app icons", () => {
    test("host.resolveAppIcon present → icon actor added as child of tile", () => {
        const iconActor = new FakeActor();
        const { ind } = setupWithIcon(
            { agents: { "1": agent({ window_id: "0x100001" }) } },
            () => iconActor
        );
        const entry = ind.__test_getEntries()["1"];
        assert.ok(entry.tile.children.includes(iconActor),
            "icon actor should be a child of the tile widget");
        ind.destroy();
    });

    test("host.resolveAppIcon returns null → no icon child, no error", () => {
        const { ind } = setupWithIcon(
            { agents: { "1": agent() } },
            () => null
        );
        const entry = ind.__test_getEntries()["1"];
        assert.equal(entry.iconActor, null,
            "iconActor should be null when resolveAppIcon returns null");
        // Tile should have no children (no icon was added).
        assert.equal(entry.tile.children.length, 0,
            "tile should have no children when icon is null");
        ind.destroy();
    });

    test("host.resolveAppIcon absent → no icon, no error", () => {
        // Standard setup without resolveAppIcon on host.
        const { ind } = setup({ agents: { "1": agent() } });
        const entry = ind.__test_getEntries()["1"];
        assert.equal(entry.iconActor, null,
            "iconActor should be null when host has no resolveAppIcon");
        ind.destroy();
    });

    test("host.resolveAppIcon called with correct window_id, pid, size", () => {
        const calls = [];
        // The dict key must match pid so tooltipText can look up the agent.
        const { ind } = setupWithIcon(
            { agents: { "99": agent({ pid: "99", window_id: "0xABCD" }) } },
            (winId, pid, size) => {
                calls.push({ winId, pid, size });
                return null;
            }
        );
        assert.equal(calls.length, 1, "resolveAppIcon should be called once");
        assert.equal(calls[0].winId, "0xABCD", "window_id passed correctly");
        assert.equal(calls[0].pid,   "99",     "pid passed correctly");
        assert.ok(calls[0].size > 0,            "size should be positive");
        ind.destroy();
    });

    test("icon cached: resolveAppIcon not called again within TTL (1 h)", () => {
        const calls = [];
        const { ind } = setupWithIcon(
            { agents: { "1": agent({ window_id: "0x200001" }) } },
            (winId, pid, size) => {
                calls.push({ winId, pid, size });
                return new FakeActor();
            }
        );
        assert.equal(calls.length, 1, "first render calls resolveAppIcon once");

        // Re-render without advancing time — icon should come from cache.
        ind.__test_setState({ agents: { "1": agent({ window_id: "0x200001" }) } });
        assert.equal(calls.length, 1,
            "second render within TTL must NOT call resolveAppIcon again (cache hit)");
        ind.destroy();
    });

    test("icon cache TTL 1 h: resolveAppIcon called again after TTL expires", () => {
        const calls = [];
        // Patch Date.now to control time.
        const origDateNow = Date.now;
        let fakeNow = 1_000_000;
        Date.now = () => fakeNow;

        try {
            const { ind } = setupWithIcon(
                { agents: { "1": agent({ window_id: "0x300001" }) } },
                (winId, pid, size) => {
                    calls.push({ winId, pid, size });
                    return new FakeActor();
                }
            );
            assert.equal(calls.length, 1, "initial render calls resolveAppIcon");

            // Advance time by 1 ms less than TTL — still within cache window.
            fakeNow += 3600 * 1000 - 1;
            ind.__test_setState({ agents: { "1": agent({ window_id: "0x300001" }) } });
            assert.equal(calls.length, 1, "1 ms before TTL icon still served from cache");

            // Advance to exactly at TTL — cache condition is strict < so this is a miss.
            fakeNow += 1;
            ind.__test_setState({ agents: { "1": agent({ window_id: "0x300001" }) } });
            assert.equal(calls.length, 2,
                "at TTL (not strictly less-than) resolveAppIcon must be called again (cache miss)");
            ind.destroy();
        } finally {
            Date.now = origDateNow;
        }
    });

    test("fallback to pid-based cache key when window_id absent", () => {
        const calls = [];
        // Dict key must match pid field.
        const { ind } = setupWithIcon(
            { agents: { "77": agent({ pid: "77", window_id: undefined }) } },
            (winId, pid, size) => {
                calls.push({ winId, pid });
                return new FakeActor();
            }
        );
        assert.equal(calls.length, 1);
        // window_id is undefined/null (absent from agent data)
        assert.ok(calls[0].winId == null, "window_id should be null/undefined when absent");
        assert.equal(calls[0].pid, "77", "pid passed as fallback cache key");

        // Re-render — should still be cached by "pid:77".
        ind.__test_setState({ agents: { "77": agent({ pid: "77", window_id: undefined }) } });
        assert.equal(calls.length, 1, "pid-keyed cache hit on re-render");
        ind.destroy();
    });

    test("unknown terminal type → icon resolved and displayed without error", () => {
        const iconActor = new FakeActor();
        const { ind } = setupWithIcon(
            { agents: { "1": agent({ terminal_type: "unknown-term" }) } },
            () => iconActor
        );
        const entry = ind.__test_getEntries()["1"];
        assert.ok(entry.tile.children.includes(iconActor),
            "icon should appear regardless of terminal_type");
        ind.destroy();
    });
});

// ---------------------------------------------------------------------------
// Shortcut launch buttons (configured agents with a shortcut_icon)
// ---------------------------------------------------------------------------
function setupWithShortcuts(initialState) {
    const env = makeFakeEnv();
    const STATE_FILE = "/tmp/claude-agents-shortcut-test.json";
    env.setFile(STATE_FILE, initialState || { agents: {} });
    const host = makeHost();
    const shortcutClicks = [];
    const ind = createIndicator({
        deps:   env.deps,
        host,
        config: { stateFile: STATE_FILE },
        onClick: () => {},
        onShortcutClick: (id) => shortcutClicks.push(id),
    });
    return { env, host, ind, shortcutClicks, STATE_FILE };
}

describe("createIndicator: shortcut buttons", () => {
    test("shortcut entry renders a button label with its icon", () => {
        const { ind } = setupWithShortcuts({
            agents: {},
            shortcuts: [{ id: 7, name: "Type sweep", shortcut_icon: "🚀" }],
        });
        const labels = findLabels(ind.box);
        assert.ok(labels.some(l => l._text === "🚀"), "shortcut icon rendered as a label");
        ind.destroy();
    });

    test("multi-char text icon (e.g. 'TS') is supported", () => {
        const { ind } = setupWithShortcuts({
            agents: {},
            shortcuts: [{ id: 3, name: "Tests", shortcut_icon: "TS" }],
        });
        const labels = findLabels(ind.box);
        assert.ok(labels.some(l => l._text === "TS"), "two-letter icon rendered");
        ind.destroy();
    });

    test("no shortcuts → no extra buttons", () => {
        const { ind } = setupWithShortcuts({ agents: { "1": agent() }, shortcuts: [] });
        const labels = findLabels(ind.box);
        // only the project group label, no shortcut label
        assert.ok(!labels.some(l => l._text === "🚀"));
        ind.destroy();
    });

    test("shortcut buttons render before agent tiles in the box", () => {
        const { ind } = setupWithShortcuts({
            agents: { "1": agent() },
            shortcuts: [{ id: 1, name: "Go", shortcut_icon: "▶" }],
        });
        // First direct child of the box is the shortcut button (a label), not a group.
        const first = ind.box.children[0];
        assert.equal(first._text, "▶", "shortcut button is the first box child");
        ind.destroy();
    });

    test("__test_clickShortcut dispatches the agent id to onShortcutClick", () => {
        const { ind, shortcutClicks } = setupWithShortcuts({
            agents: {},
            shortcuts: [{ id: 42, name: "Deploy", shortcut_icon: "D" }],
        });
        ind.__test_clickShortcut(42);
        assert.deepEqual(shortcutClicks, [42]);
        ind.destroy();
    });
});
