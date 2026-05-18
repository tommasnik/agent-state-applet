// ---------------------------------------------------------------------------
// Minimal GJS/Clutter/St fakes for Node-based unit tests.
//
// Goals:
//   - Let shared/core.mjs's createIndicator run under `node --test` without
//     a real Gnome/Cinnamon shell.
//   - Record widget tree operations so tests can assert structure & lifecycle.
//   - Be intentionally lazy: only model the surface area core.mjs actually
//     touches. If you add a new St/Clutter call in core, extend the fake.
// ---------------------------------------------------------------------------

let _id = 0;
function nextId() { return ++_id; }

export class FakeActor {
    constructor(props = {}) {
        this._id        = nextId();
        this._destroyed = false;
        this._parent    = null;
        this.children   = [];
        this._sigs      = {};        // signal name → [cb, …]
        this.style      = "";
        this.width      = 0;
        this.height     = 0;
        this._visible   = true;
        this._props     = {};
        // Mirror constructor props (track_hover, reactive, vertical, x, y, …)
        Object.assign(this, props);
        this._props = { ...props };
        // clutter_text shim for St.Label
        this.clutter_text = new FakeClutterText();
    }

    add_child(child) {
        if (!child) return;
        if (child._parent && child._parent !== this) child._parent.remove_child(child);
        this.children.push(child);
        child._parent = this;
    }

    remove_child(child) {
        if (!child) return;
        let idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        if (child._parent === this) child._parent = null;
    }

    // Cinnamon legacy alias
    add_actor(child)    { return this.add_child(child); }
    remove_actor(child) { return this.remove_child(child); }

    get_parent()   { return this._parent; }
    get_children() { return this.children.slice(); }

    set_style(s) { this.style = s; }
    set_text(t)  { this._text = t; if (this.clutter_text) this.clutter_text._text = t; }
    set_position(x, y) { this.x = x; this.y = y; }

    show() { this._visible = true; }
    hide() { this._visible = false; }

    connect(sig, cb) {
        (this._sigs[sig] = this._sigs[sig] || []).push(cb);
        return nextId();
    }
    disconnect(_id) { /* noop for tests */ }

    emit(sig, ...args) {
        let cbs = this._sigs[sig] || [];
        let result;
        for (let cb of cbs) result = cb(this, ...args);
        return result;
    }

    ease(opts) {
        // Synchronous fake: run onComplete immediately if provided
        if (opts && typeof opts.onComplete === "function") opts.onComplete();
    }

    destroy() {
        this._destroyed = true;
        if (this._parent) this._parent.remove_child(this);
        for (let c of this.children.slice()) c.destroy();
        this.children = [];
    }
}

class FakeClutterText {
    constructor() {
        this.single_line_mode = false;
        this.line_wrap        = false;
        this.use_markup       = false;
        this._markup          = "";
        this._text            = "";
    }
    set_markup(m)            { this._markup = m; }
    set_ellipsize(_m)        { /* noop */ }
    set_single_line_mode(b)  { this.single_line_mode = b; }
}

// ---------------------------------------------------------------------------
// Module fakes
// ---------------------------------------------------------------------------

class FakeFileMonitor extends FakeActor {
    cancel() { this._cancelled = true; }
}

class FakeGioFile {
    constructor(path, env) { this.path = path; this._env = env; }
    monitor_directory(_flags, _cancellable) {
        let mon = new FakeFileMonitor();
        this._env.monitors.push({ path: this.path, monitor: mon });
        return mon;
    }
    load_contents(_cancellable) {
        let raw = this._env.fileContents.get(this.path);
        if (raw === undefined) throw new Error("ENOENT " + this.path);
        let bytes = new TextEncoder().encode(raw);
        return [true, bytes];
    }
}

function makeGioFakes(env) {
    return {
        File: { new_for_path: (p) => new FakeGioFile(p, env) },
        FileMonitorFlags: { NONE: 0 },
        Subprocess: function() {},          // not used in core; adapters call it
        SubprocessFlags: { STDOUT_PIPE: 1 },
    };
}

function makeGLibFakes(env) {
    return {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE:   false,
        SOURCE_CONTINUE: true,
        timeout_add: (_pri, ms, fn) => {
            let id = nextId();
            env.timers.set(id, { ms, fn });
            return id;
        },
        source_remove: (id) => {
            return env.timers.delete(id);
        },
    };
}

function makeStFakes() {
    return {
        BoxLayout: FakeActor,
        Widget:    FakeActor,
        Label:     FakeActor,
        Bin:       FakeActor,
        Side:      { TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3 },
    };
}

function makeClutterFakes() {
    class FakeColor {
        constructor(props) { Object.assign(this, props); }
    }
    return {
        EVENT_STOP:     true,
        EVENT_PROPAGATE: false,
        Color:          FakeColor,
        Actor:          FakeActor,
        AnimationMode:  { EASE_OUT_QUAD: 1 },
    };
}

function makePangoFakes() {
    return { EllipsizeMode: { MIDDLE: 1, END: 2, START: 3 } };
}

function makeMainFakes() {
    return {
        uiGroup: new FakeActor(),
        panel:   { height: 32 },
    };
}

// ---------------------------------------------------------------------------
// Top-level entry: build a clean test environment.
// ---------------------------------------------------------------------------
export function makeFakeEnv() {
    const env = {
        fileContents: new Map(),  // path → string
        monitors:     [],         // [{ path, monitor }]
        timers:       new Map(),  // id → { ms, fn }
    };

    const deps = {
        St:      makeStFakes(),
        GLib:    makeGLibFakes(env),
        Gio:     makeGioFakes(env),
        Clutter: makeClutterFakes(),
        Pango:   makePangoFakes(),
        Main:    makeMainFakes(),
    };

    // Helpers exposed to tests
    return {
        deps,
        env,
        setFile(path, obj) {
            env.fileContents.set(path, typeof obj === "string" ? obj : JSON.stringify(obj));
        },
        triggerFileChange(path) {
            // Match the directory monitor that watches the parent of `path`.
            let lastSlash = path.lastIndexOf("/");
            let dirPath   = lastSlash > 0 ? path.slice(0, lastSlash) : "/";
            let basename  = path.slice(lastSlash + 1);
            for (let m of env.monitors) {
                if (m.path !== dirPath) continue;
                let fakeFile = { get_basename: () => basename };
                m.monitor.emit("changed", fakeFile, null);
            }
        },
        runAllTimers() {
            // Drain pending timers (one-shot). Continues timers re-add themselves
            // only if their callback returns SOURCE_CONTINUE; we don't loop those
            // here — tests drive iterations explicitly.
            for (let [id, t] of Array.from(env.timers.entries())) {
                env.timers.delete(id);
                let r = t.fn();
                if (r === true) {
                    // SOURCE_CONTINUE — re-arm with same id slot (lightweight model)
                    env.timers.set(id, t);
                }
            }
        },
    };
}
