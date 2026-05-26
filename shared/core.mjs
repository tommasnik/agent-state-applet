// ---------------------------------------------------------------------------
// Claude Agent State — shared core
//
// Single source of truth for:
//   - pure render logic (describeRender, tooltipText, formatDuration, …)
//   - UI factory createIndicator({ deps, host, config, onClick })
//   - tooltip / file-watcher / flash-window helpers
//
// Consumed by:
//   - shared/core.mjs          (GNOME 45+ ESM, copied as-is)
//   - applet/core.js           (auto-generated for Cinnamon: `export` stripped)
//   - test/render.test.mjs     (Node pure-logic tests)
//   - test/ui.test.mjs         (Node UI tests with fake GJS deps)
//
// Keep this file ESM-clean: top-level `export` is the only thing the sed
// build strips. Don't use `import` — Cinnamon side has no module resolver.
// ---------------------------------------------------------------------------

export const STATE_FILE  = "/tmp/claude-agents.json";
export const FALLBACK_MS = 3000;

// Back-compat exports kept for existing tests & callers.
// (DEFAULT_CONFIG below is the authoritative source.)
export const BALL_MARGIN = 1;
export const LABEL_H     = 14;

export const STATE_COLOR = {
    initialized:          "#888888",
    working:              "#e8c000",
    asking_user:          "#4499ff",
    done:                 "#44bb44",
    waiting_for_approval: "#ff2222",
};

export const STATE_LABEL = {
    initialized:          "Initialized",
    working:              "Working",
    asking_user:          "Asking user",
    done:                 "Done",
    waiting_for_approval: "Waiting for approval",
};

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG — every visual / behavioral knob lives here.
// Adapters may pass a partial `config` to createIndicator; missing keys
// fall back to defaults. Future settings UIs feed values into this object.
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
    // Layout
    ballMargin:        BALL_MARGIN,
    ballBorderRadius:  2,
    labelHeight:       LABEL_H,
    labelFontSize:     10,
    groupLabelColor:   "rgba(255,255,255,0.85)",
    separatorColor:    "rgba(255,255,255,0.18)",

    // Colors / labels (per-state, overridable)
    colors:            STATE_COLOR,
    labels:            STATE_LABEL,

    // Tooltip
    tooltipPlacement:  "auto",   // "auto" | "above" | "below"
    tooltipStyle:      "background-color: rgba(18,18,22,0.96);"
                     + "color: #e0e0e0;"
                     + "padding: 12px 16px;"
                     + "border-radius: 6px;"
                     + "font-size: 13px;"
                     + "border: 1px solid rgba(255,255,255,0.08);",

    // Future: text/panel orientation
    textOrientation:   "horizontal",  // "horizontal" | "vertical"  (not yet implemented)

    // Flash window animation
    flashDuration:     700,
    flashColor:        { red: 255, green: 140, blue: 0, alpha: 220 },
    flashThickness:    6,

    // Polling / file watcher
    stateFile:         STATE_FILE,
    fallbackMs:        FALLBACK_MS,
    debounceMs:        30,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60)   return seconds + "s";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
    return Math.floor(seconds / 3600) + "h " + Math.floor((seconds % 3600) / 60) + "m";
}

export function projectName(agent) {
    let path = agent.project_root || agent.cwd;
    if (!path) return "?";
    let parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || "?";
}

export function ballStyle(color, w, h, cfg) {
    let c = cfg || DEFAULT_CONFIG;
    return "background-color: " + color + ";"
         + " width: "  + w + "px;"
         + " height: " + h + "px;"
         + " border-radius: " + c.ballBorderRadius + "px;"
         + " margin: 0 " + c.ballMargin + "px;";
}

// Returns array of group descriptors from an agents dict (pid → agent object).
// Groups and agents within groups are ordered by PTY number (/dev/pts/N),
// which matches the visual tab order in IDEA/Ghostty. Falls back to started_at
// for agents without a tty.
// Each group: { key, label, ballW, ballH, agents: [{ pid, state, color }] }
export function describeRender(agents, panelHeight, cfg) {
    let c = cfg || DEFAULT_CONFIG;
    let colors = c.colors || STATE_COLOR;

    // Ghostty: use ghostty_tab_index (0=leftmost) when the server has it
    // (populated by AT-SPI polling). Falls back to PTY-descending heuristic
    // when the index isn't known yet (new session or Ghostty not running).
    // Other terminals (IDEA, generic): sort by PTY ascending (tab creation order).
    function ttyOrder(agent) {
        if (agent.terminal_type === "ghostty") {
            let idx = agent.ghostty_tab_index;
            if (idx !== null && idx !== undefined) return idx;
            // fallback: higher PTY = newer = further left in Ghostty
            let m = (agent.tty || "").match(/\/dev\/pts\/(\d+)$/);
            return m ? -parseInt(m[1], 10) : Infinity;
        }
        let m = (agent.tty || "").match(/\/dev\/pts\/(\d+)$/);
        return m ? parseInt(m[1], 10) : Infinity;
    }

    let sorted = Object.values(agents).sort(function(a, b) {
        let ta = ttyOrder(a), tb = ttyOrder(b);
        if (ta !== tb) return ta - tb;
        return (a.started_at || 0) - (b.started_at || 0);
    });

    let groupOrder = [];
    let groupMap   = {};
    for (let i = 0; i < sorted.length; i++) {
        let agent = sorted[i];
        let gkey  = (agent.project_root || agent.cwd || "") + "|" + (agent.terminal_type || "");
        if (!groupMap[gkey]) {
            groupMap[gkey] = [];
            groupOrder.push(gkey);
        }
        groupMap[gkey].push(agent);
    }

    let groups = [];
    for (let gi = 0; gi < groupOrder.length; gi++) {
        let gkey  = groupOrder[gi];
        let group = groupMap[gkey];
        let n     = group.length;
        let ballW = Math.max(panelHeight, Math.floor(panelHeight * 2 / n));
        let ballH = panelHeight - c.labelHeight;
        let path  = group[0].project_root || group[0].cwd || "";
        groups.push({
            key:    gkey,
            label:  projectName(group[0]),
            _path:  path,
            ballW:  ballW,
            ballH:  ballH,
            agents: group.map(function(agent) {
                return {
                    pid:   String(agent.pid),
                    state: agent.state,
                    color: colors[agent.state] || "#888888",
                };
            }),
        });
    }

    // Disambiguate groups that share the same label but have DIFFERENT project_roots.
    // Same project open in two terminal types (idea + ghostty) keeps the short label.
    let labelPaths = {};
    for (let gi = 0; gi < groups.length; gi++) {
        let lbl = groups[gi].label;
        let path = groups[gi]._path || "";
        if (!labelPaths[lbl]) labelPaths[lbl] = new Set();
        labelPaths[lbl].add(path);
    }
    for (let gi = 0; gi < groups.length; gi++) {
        if (labelPaths[groups[gi].label].size > 1) {
            let parts = (groups[gi]._path || "").split("/").filter(Boolean);
            if (parts.length >= 2) {
                groups[gi].label = parts[parts.length - 2] + "/" + parts[parts.length - 1];
            }
        }
        delete groups[gi]._path;
    }

    return groups;
}

export function tooltipText(agent, now, cfg) {
    let c = cfg || DEFAULT_CONFIG;
    let colors = c.colors || STATE_COLOR;
    let labels = c.labels || STATE_LABEL;

    let project    = (agent.project_root || agent.cwd || "").split("/").filter(Boolean).pop() || "unknown";
    let stateLabel = labels[agent.state] || agent.state;
    let stateColor = colors[agent.state] || "#888888";
    let toolInfo   = (agent.state === "working" && agent.tool_name) ? ": " + agent.tool_name : "";
    let inState    = agent.timestamp  ? formatDuration(now - agent.timestamp)  : "-";
    let running    = agent.started_at ? formatDuration(now - agent.started_at) : "-";

    function esc(s) {
        return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    let SEP = '<span color="#333344">────────────────────────────────</span>';

    let lines = [];

    if (agent.ai_title) {
        lines.push('<span size="large" weight="bold">' + esc(agent.ai_title) + '</span>');
        lines.push(SEP);
    }

    lines.push('<span size="large" weight="bold" color="#ffffff">' + esc(project) + '</span>');
    lines.push('<span color="' + stateColor + '" weight="bold">● ' + esc(stateLabel + toolInfo) + '</span>');
    lines.push(SEP);
    lines.push(
        '<span color="#888888">running </span><span weight="bold">' + running + '</span>'
        + '   <span color="#888888">in state </span><span weight="bold">' + inState + '</span>'
    );

    if (agent.subagent_count > 0) {
        lines.push('<span color="#888888">subagents </span><span weight="bold">' + agent.subagent_count + '</span>');
    }

    lines.push(SEP);
    lines.push('<span size="small" color="#666677">' + esc(agent.cwd || "-") + '</span>');
    lines.push(
        '<span size="small" color="#555566">session </span>'
        + '<span size="small" color="#777788">' + esc(agent.session_id ? agent.session_id.slice(0, 8) : "-") + '</span>'
        + '<span size="small" color="#555566">  pid </span>'
        + '<span size="small" color="#777788">' + agent.pid + '</span>'
    );

    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tooltip factory — Pango-markup tooltip floating over Main.uiGroup.
// Placement adapts to host.panelPosition() ("top" → below cursor,
// "bottom" → above cursor) or honors cfg.tooltipPlacement override.
// ---------------------------------------------------------------------------
export function makeAgentTooltipClass(deps, getCfg, host) {
    const St   = deps.St;
    const Main = deps.Main;

    function AgentTooltip(ball) {
        this._markup  = "";
        this._visible = false;
        this._ball    = ball;
        this._cfg     = getCfg;

        this._actor = new St.Label({ style: getCfg().tooltipStyle });
        this._actor.clutter_text.single_line_mode = false;
        this._actor.clutter_text.line_wrap = false;
        this._actor.clutter_text.use_markup = true;
        this._actor.hide();
        Main.uiGroup.add_child(this._actor);

        let self = this;
        this._enterSig  = ball.connect("enter-event",  function() { self._onEnter();  });
        this._leaveSig  = ball.connect("leave-event",  function() { self._onLeave();  });
        this._motionSig = ball.connect("motion-event", function() { self._onMotion(); });
    }

    AgentTooltip.prototype._onEnter = function() {
        this._actor.clutter_text.set_markup(this._markup);
        this._actor.show();
        this._visible = true;
        this._reposition();
    };

    AgentTooltip.prototype._onLeave = function() {
        this._actor.hide();
        this._visible = false;
    };

    AgentTooltip.prototype._onMotion = function() {
        if (this._visible) this._reposition();
    };

    AgentTooltip.prototype._reposition = function() {
        let cfg = this._cfg();
        let p   = host.getPointer ? host.getPointer() : [0, 0];
        let s   = host.screenSize ? host.screenSize() : [1920, 1080];
        let mx = p[0], my = p[1];
        let sw = s[0], sh = s[1];

        let aw = this._actor.width  || 320;
        let ah = this._actor.height || 120;

        let placement = cfg.tooltipPlacement;
        if (placement === "auto") {
            let pos = host.panelPosition ? host.panelPosition() : "bottom";
            placement = (pos === "top") ? "below" : "above";
        }

        let ty;
        if (placement === "below") {
            ty = my + 22;
            if (ty + ah > sh - 8) ty = my - ah - 14;
        } else {
            ty = my - ah - 14;
            if (ty < 4) ty = my + 22;
        }
        if (ty < 4) ty = 4;

        let tx = mx + 10;
        if (tx + aw > sw - 8) tx = sw - aw - 8;
        if (tx < 4) tx = 4;

        this._actor.set_position(tx, ty);
    };

    AgentTooltip.prototype.set_text = function(markup) {
        this._markup = markup;
        if (this._visible) {
            this._actor.clutter_text.set_markup(markup);
            this._reposition();
        }
    };

    AgentTooltip.prototype.destroy = function() {
        try { this._ball.disconnect(this._enterSig);  } catch (_) {}
        try { this._ball.disconnect(this._leaveSig);  } catch (_) {}
        try { this._ball.disconnect(this._motionSig); } catch (_) {}
        this._actor.hide();
        this._actor.destroy();
    };

    return AgentTooltip;
}

// ---------------------------------------------------------------------------
// File watcher: monitors the parent dir of `path` for the basename (incl.
// atomic rename via os.replace), debounces rapid events into one onChange.
// Returns { cancel() }.
// ---------------------------------------------------------------------------
export function makeFileWatcher(deps, path, onChange) {
    const Gio  = deps.Gio;
    const GLib = deps.GLib;

    let lastSlash = path.lastIndexOf("/");
    let dirPath   = lastSlash > 0 ? path.slice(0, lastSlash) : "/";
    let basename  = path.slice(lastSlash + 1);

    let pendingId = null;
    let monitor   = null;
    let sigId     = null;

    try {
        let dir = Gio.File.new_for_path(dirPath);
        monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        sigId = monitor.connect("changed", function(_m, file, otherFile) {
            let name      = file      ? file.get_basename()      : "";
            let otherName = otherFile ? otherFile.get_basename() : "";
            if (name !== basename && otherName !== basename) return;
            if (pendingId) return;
            pendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, function() {
                pendingId = null;
                onChange();
                return GLib.SOURCE_REMOVE;
            });
        });
    } catch (_) {
        monitor = null;
    }

    return {
        cancel: function() {
            if (pendingId) { try { GLib.source_remove(pendingId); } catch (_) {} pendingId = null; }
            if (monitor) {
                try { monitor.disconnect(sigId); } catch (_) {}
                try { monitor.cancel(); } catch (_) {}
                monitor = null;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Flash window: draws an orange border that fades out over cfg.flashDuration.
// `host.getWindowActors()` must return an array of MutterWindow actors.
//
// Uses St.Widget + CSS background-color instead of Clutter.Actor + Clutter.Color
// because Clutter.Color is undefined in GNOME Shell 47+ (Mutter 15) — the old
// constructor was removed. CSS rgba() is portable across both Cinnamon (Muffin)
// and GNOME (Mutter).
// ---------------------------------------------------------------------------
function rgbaCss(col) {
    let r = col && col.red   != null ? col.red   : 255;
    let g = col && col.green != null ? col.green : 140;
    let b = col && col.blue  != null ? col.blue  : 0;
    let a = col && col.alpha != null ? col.alpha : 220;
    return "rgba(" + r + "," + g + "," + b + "," + (a / 255) + ")";
}

export function flashWindow(deps, host, xidHexOrDec, cfg) {
    function dbg(msg) {
        try { if (typeof console !== "undefined" && console.log) console.log("[claude-flash] " + msg); } catch (_) {}
        try { if (typeof log === "function") log("[claude-flash] " + msg); } catch (_) {}
        try {
            if (deps.GLib && deps.GLib.file_set_contents) {
                let ts = new Date().toISOString();
                deps.GLib.spawn_command_line_async('sh -c "echo \\"' + ts + ' ' + msg.replace(/"/g, '\\"') + '\\" >> /tmp/claude-flash.log"');
            }
        } catch (_) {}
    }

    if (!xidHexOrDec) { dbg("no xid passed"); return; }
    let targetXid;
    try {
        let s = String(xidHexOrDec);
        targetXid = s.indexOf("0x") === 0 ? parseInt(s, 16) : parseInt(s, 10);
    } catch (_) { dbg("xid parse fail"); return; }
    if (!targetXid) { dbg("xid=0"); return; }

    const St      = deps.St;
    const Clutter = deps.Clutter;
    const Main    = deps.Main;
    const c       = cfg || DEFAULT_CONFIG;
    const actors  = host && host.getWindowActors ? host.getWindowActors() : [];
    const stripBg = rgbaCss(c.flashColor);

    // Find target window actor by xid.
    //
    // Mutter 47 (GNOME 47) removed meta_window_get_xwindow() from the JS-facing
    // API; it now returns 0. Workaround: meta_window.get_description() returns
    // a string like "0x12345 (Title)" that includes the X11 window ID for X11
    // windows. Parse the xid out of it. Fall back to get_xwindow() (Cinnamon
    // / older Mutter still expose it correctly).
    function extractXidFromMeta(mw) {
        if (!mw) return 0;
        if (mw.get_xwindow) {
            let x = mw.get_xwindow();
            if (x) return x;
        }
        if (mw.get_description) {
            try {
                let d = mw.get_description() || "";
                let m = d.match(/0x[0-9a-fA-F]+/);
                if (m) return parseInt(m[0], 16);
            } catch (_) {}
        }
        return 0;
    }
    let actor = null, metaWin = null;
    let xidsSeen = [];
    for (let i = 0; i < actors.length; i++) {
        let mw = actors[i].get_meta_window ? actors[i].get_meta_window() : null;
        if (!mw) { xidsSeen.push("noMeta"); continue; }
        let xid = extractXidFromMeta(mw);
        let title = mw.get_title ? mw.get_title() : "";
        xidsSeen.push("0x" + (xid || 0).toString(16) + "(" + (title || "").slice(0, 20) + ")");
        if (xid === targetXid) { actor = actors[i]; metaWin = mw; break; }
    }
    if (!actor) {
        dbg("no actor for xid 0x" + targetXid.toString(16) + " (scanned " + actors.length + "): " + xidsSeen.join(", "));
        return;
    }

    // Use the window's frame_rect (stage coords, excludes invisible shadow).
    let x, y, W, H;
    if (metaWin && metaWin.get_frame_rect) {
        let fr = metaWin.get_frame_rect();
        x = fr.x; y = fr.y; W = fr.width; H = fr.height;
    } else {
        x = actor.x; y = actor.y; W = actor.width; H = actor.height;
    }

    // Place overlay strips in a top-level container that paints above all
    // windows. Prefer Main.uiGroup (always above window stack). On GNOME 47,
    // adding to global.window_group can be restacked away by Mutter, and
    // adding as a child of MetaWindowActor isn't painted on top of the X11
    // surface — Main.uiGroup avoids both problems and works on Cinnamon too.
    let container = (Main && Main.uiGroup) ? Main.uiGroup : (actor.get_parent && actor.get_parent());
    if (!container || !container.add_child) { dbg("no container"); return; }

    let T = c.flashThickness;
    let rects = [
        { x: x,         y: y,         width: W, height: T },
        { x: x,         y: y + H - T, width: W, height: T },
        { x: x,         y: y,         width: T, height: H },
        { x: x + W - T, y: y,         width: T, height: H },
    ];
    dbg("flashing xid=0x" + targetXid.toString(16) + " at " + x + "," + y + " " + W + "x" + H);

    rects.forEach(function(r) {
        let strip = new St.Widget({
            style:    "background-color: " + stripBg + ";",
            x:        r.x,
            y:        r.y,
            width:    r.width,
            height:   r.height,
            reactive: false,
        });
        container.add_child(strip);
        if (strip.ease) {
            strip.ease({
                opacity: 0,
                duration: c.flashDuration,
                mode: Clutter && Clutter.AnimationMode ? Clutter.AnimationMode.EASE_OUT_QUAD : 0,
                onComplete: function() { strip.destroy(); },
            });
        } else if (deps.GLib && deps.GLib.timeout_add) {
            deps.GLib.timeout_add(deps.GLib.PRIORITY_DEFAULT, c.flashDuration, function() {
                strip.destroy();
                return deps.GLib.SOURCE_REMOVE;
            });
        } else {
            strip.destroy();
        }
    });
}

// ---------------------------------------------------------------------------
// JSON read helper. `deps.Gio` must support File.new_for_path().load_contents().
// ---------------------------------------------------------------------------
function readJSONFile(deps, path) {
    try {
        let file = deps.Gio.File.new_for_path(path);
        let res  = file.load_contents(null);
        let ok = true, contents = res;
        if (Array.isArray(res)) { ok = res[0]; contents = res[1]; }
        if (!ok) return null;
        let text = (contents instanceof Uint8Array)
            ? new TextDecoder().decode(contents)
            : String(contents);
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// createIndicator — the UI factory shared by both adapters.
//
// Args:
//   deps   = { St, GLib, Gio, Clutter, Pango, Main }
//   host   = {
//              spawn(argv),                       // spawns subprocess (Util.spawn)
//              panelHeight()  -> px,              // current panel height
//              panelPosition() -> "top"|"bottom", // used for tooltip auto-placement
//              getPointer()   -> [x, y],          // global cursor pos
//              screenSize()   -> [w, h],
//              getFocusedXid() -> int|null,       // X11 id of focused window
//              getWindowActors() -> actors[],     // for flash
//            }
//   config = partial overrides on DEFAULT_CONFIG
//   onClick(pid, agent, action)                   // action: "focus" | "reset"
//
// Returns { box, update, applyConfig, flashWindow, destroy,
//           __test_setState, __test_render, __test_getEntries, __test_getCfg }.
// ---------------------------------------------------------------------------
export function createIndicator(opts) {
    const deps    = opts.deps;
    const host    = opts.host || {};
    const onClick = opts.onClick || function() {};
    let cfg       = Object.assign({}, DEFAULT_CONFIG, opts.config || {});

    const St      = deps.St;
    const GLib    = deps.GLib;
    const Pango   = deps.Pango;
    const Clutter = deps.Clutter;

    const box = new St.BoxLayout({ vertical: false });
    box.set_style("padding: 0;");

    // pid (str) → { ball, tooltip, color, state, inBox }
    let entries     = {};
    let transient   = [];
    let prevStates  = {};
    let lastAgents  = {};

    const TooltipClass = makeAgentTooltipClass(deps, function() { return cfg; }, host);

    function dispatchClick(pid) {
        let entry  = entries[pid];
        let agent  = lastAgents[pid];
        let action = (entry && entry.state === "done") ? "reset" : "focus";
        onClick(pid, agent, action);
    }

    function clickEventReturn() {
        return Clutter && Clutter.EVENT_STOP != null ? Clutter.EVENT_STOP : true;
    }

    function render(agents, scheduled) {
        try { deps.GLib.spawn_command_line_async('sh -c "echo render n=' + Object.keys(agents).length + ' >> /tmp/claude-flash.log"'); } catch (_) {}
        lastAgents = agents;
        lastScheduled = scheduled || [];

        let ph     = host.panelHeight ? host.panelHeight() : 32;
        let groups = describeRender(agents, ph, cfg);

        // Stale entry removal
        let livePids = {};
        for (let gi = 0; gi < groups.length; gi++)
            for (let ai = 0; ai < groups[gi].agents.length; ai++)
                livePids[groups[gi].agents[ai].pid] = true;
        for (let pid in entries) {
            if (!livePids[pid]) {
                let e = entries[pid];
                let parent = e.ball.get_parent && e.ball.get_parent();
                if (parent && parent.remove_child) parent.remove_child(e.ball);
                e.tooltip.destroy();
                e.ball.destroy();
                delete entries[pid];
                delete prevStates[pid];
            }
        }

        // Create new ball widgets (persist across renders)
        for (let gi = 0; gi < groups.length; gi++) {
            for (let ai = 0; ai < groups[gi].agents.length; ai++) {
                let pid = groups[gi].agents[ai].pid;
                if (!entries[pid]) {
                    let ball = new St.Widget({
                        reactive:    true,
                        track_hover: true,
                        style:       ballStyle((cfg.colors || STATE_COLOR).initialized, ph * 2, ph - cfg.labelHeight, cfg),
                    });
                    let clickPid = pid;
                    ball.connect("button-press-event", function(_actor, event) {
                        let btn = event && event.get_button ? event.get_button() : 1;
                        try { deps.GLib.spawn_command_line_async('sh -c "echo ball-press pid=' + clickPid + ' btn=' + btn + ' >> /tmp/claude-flash.log"'); } catch (_) {}
                        if (btn === 1) dispatchClick(clickPid);
                        return clickEventReturn();
                    });
                    let tip = new TooltipClass(ball);
                    entries[pid] = {
                        ball: ball, tooltip: tip,
                        color: (cfg.colors || STATE_COLOR).initialized,
                        state: "initialized",
                        inBox: false,
                    };
                }
            }
        }

        // Detach all balls from previous parents; tear down transient containers.
        for (let pid in entries) {
            let entry  = entries[pid];
            let parent = entry.ball.get_parent && entry.ball.get_parent();
            if (parent && parent.remove_child) parent.remove_child(entry.ball);
            entry.inBox = false;
        }
        transient.forEach(function(w) { w.destroy(); });
        transient = [];
        let children = box.get_children ? box.get_children() : [];
        children.forEach(function(c) { if (box.remove_child) box.remove_child(c); });

        // Build one vertical block per group: label on top, balls row below.
        let now = Date.now() / 1000;
        for (let gi = 0; gi < groups.length; gi++) {
            let g = groups[gi];

            if (gi > 0) {
                let sep = new St.Widget({
                    style: "width: 1px; background-color: " + cfg.separatorColor + ";"
                         + " height: " + ph + "px; margin: 0 2px;",
                });
                box.add_child(sep);
                transient.push(sep);
            }

            let groupBox = new St.BoxLayout({ vertical: true });

            // Pick a pid that has window_id for click-to-focus on the label
            let focusPid = g.agents[0].pid;
            for (let ai = 0; ai < g.agents.length; ai++) {
                let a = agents[g.agents[ai].pid];
                if (a && a.window_id) { focusPid = g.agents[ai].pid; break; }
            }

            let groupLbl = new St.Label({
                style: "color: " + cfg.groupLabelColor + ";"
                     + " font-size: " + cfg.labelFontSize + "px;"
                     + " padding: 0 3px; text-align: center;"
                     + " width: " + (g.agents.length * g.ballW) + "px;",
                reactive:    true,
                track_hover: true,
            });
            if (groupLbl.clutter_text && Pango && Pango.EllipsizeMode) {
                if (groupLbl.clutter_text.set_ellipsize)
                    groupLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
                if (groupLbl.clutter_text.set_single_line_mode)
                    groupLbl.clutter_text.set_single_line_mode(true);
            }
            if (groupLbl.set_text) groupLbl.set_text(g.label);
            let labelClickPid = focusPid;
            groupLbl.connect("button-press-event", function(_actor, event) {
                let btn = event && event.get_button ? event.get_button() : 1;
                if (btn === 1) dispatchClick(labelClickPid);
                return clickEventReturn();
            });
            groupBox.add_child(groupLbl);

            let ballsRow = new St.BoxLayout({ vertical: false });
            for (let ai = 0; ai < g.agents.length; ai++) {
                let agentDesc = g.agents[ai];
                let entry     = entries[agentDesc.pid];
                entry.ball.set_style(ballStyle(agentDesc.color, g.ballW, g.ballH, cfg));
                entry.color = agentDesc.color;
                entry.state = agentDesc.state;
                ballsRow.add_child(entry.ball);
                entry.inBox = true;

                entry.tooltip.set_text(tooltipText(agents[agentDesc.pid], now, cfg));
                prevStates[agentDesc.pid] = agentDesc.state;
            }
            groupBox.add_child(ballsRow);

            box.add_child(groupBox);
            transient.push(groupBox);
        }

        // Render scheduled entries (upcoming / waiting to fire)
        let schedList = scheduled || [];
        if (schedList.length > 0) {
            if (groups.length > 0) {
                let sep = new St.Widget({
                    style: "width: 1px; background-color: " + cfg.separatorColor + ";"
                         + " height: " + ph + "px; margin: 0 2px;",
                });
                box.add_child(sep);
                transient.push(sep);
            }
            for (let si = 0; si < schedList.length; si++) {
                let s = schedList[si];
                let proj = (s.project_path || s.name || "?").replace(/\/+$/, "").split("/").pop() || "?";
                let schedBox = new St.BoxLayout({ vertical: true });

                let lbl = new St.Label({
                    style: "color: rgba(200,200,200,0.55);"
                         + " font-size: " + cfg.labelFontSize + "px;"
                         + " padding: 0 2px; text-align: center;"
                         + " width: " + ph + "px;",
                });
                if (lbl.clutter_text && Pango && Pango.EllipsizeMode) {
                    if (lbl.clutter_text.set_ellipsize)
                        lbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                    if (lbl.clutter_text.set_single_line_mode)
                        lbl.clutter_text.set_single_line_mode(true);
                }
                if (lbl.set_text) lbl.set_text(proj);

                let dot = new St.BoxLayout({ vertical: false });
                dot.set_style("width: " + ph + "px; height: " + (ph - cfg.labelHeight) + "px; padding: 0;");

                let ball = new St.Widget({
                    style: "background-color: #444455;"
                         + " width: " + (ph - 4) + "px;"
                         + " height: " + (ph - cfg.labelHeight - 2) + "px;"
                         + " border-radius: " + cfg.ballBorderRadius + "px;"
                         + " margin: 1px auto;",
                });
                let clockLbl = new St.Label({
                    style: "color: rgba(220,220,255,0.7);"
                         + " font-size: " + Math.max(8, ph - cfg.labelHeight - 6) + "px;"
                         + " margin: 0; padding: 0;",
                });
                if (clockLbl.set_text) clockLbl.set_text("⏰");

                dot.add_child(ball);
                dot.add_child(clockLbl);
                schedBox.add_child(lbl);
                schedBox.add_child(dot);

                box.add_child(schedBox);
                transient.push(schedBox);
            }
        }
    }

    function update() {
        let data = readJSONFile(deps, cfg.stateFile);
        if (!data) return;  // keep current display on read failure
        render(data.agents || {}, data.scheduled || []);
    }

    // ---- timers / watchers ----
    let pendingId = null;
    let fallbackId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, cfg.fallbackMs, function() {
        update();
        return GLib.SOURCE_CONTINUE;
    });

    const watcher = makeFileWatcher(deps, cfg.stateFile, function() {
        if (pendingId) return;
        pendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, cfg.debounceMs, function() {
            pendingId = null;
            update();
            return GLib.SOURCE_REMOVE;
        });
    });

    let lastScheduled = [];

    function applyConfig(partial) {
        cfg = Object.assign({}, cfg, partial || {});
        if (Object.keys(lastAgents).length > 0) render(lastAgents, lastScheduled);
    }

    function destroy() {
        if (fallbackId) { try { GLib.source_remove(fallbackId); } catch (_) {} fallbackId = null; }
        if (pendingId)  { try { GLib.source_remove(pendingId);  } catch (_) {} pendingId  = null; }
        if (watcher) watcher.cancel();
        transient.forEach(function(w) { w.destroy(); });
        transient = [];
        for (let pid in entries) {
            entries[pid].tooltip.destroy();
            entries[pid].ball.destroy();
        }
        entries = {};
    }

    // Initial render
    update();

    return {
        box:      box,
        update:   update,
        applyConfig: applyConfig,
        flashWindow: function(xid) { flashWindow(deps, host, xid, cfg); },
        destroy:  destroy,

        // Test hooks — cheap & harmless to leave in production builds.
        __test_setState:   function(data) { render((data && data.agents) || {}, (data && data.scheduled) || []); },
        __test_render:     render,
        __test_getEntries: function() { return entries; },
        __test_getCfg:     function() { return cfg; },
        __test_clickPid:   function(pid) { dispatchClick(pid); },
    };
}
