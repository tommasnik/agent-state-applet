const Applet = imports.ui.applet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Util = imports.misc.util;
const Main = imports.ui.main;

const UUID = "claude-agent-state@daktela";
const STATE_FILE = "/tmp/claude-agents.json";
const FALLBACK_MS = 3000;  // fallback poll if inotify misses something
const BALL_SIZE = 16;
const BALL_MARGIN = 2;
const LABEL_MAX = 12;

const STATE_COLOR = {
    initialized:          "#888888",
    working:              "#e8c000",
    asking_user:          "#4499ff",
    done:                 "#44bb44",
    waiting_for_approval: "#ffaa00",
};

const STATE_LABEL = {
    initialized:          "Initialized",
    working:              "Working",
    asking_user:          "Asking user",
    done:                 "Done",
    waiting_for_approval: "Waiting for approval",
};

function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60)   return seconds + "s";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
    return Math.floor(seconds / 3600) + "h " + Math.floor((seconds % 3600) / 60) + "m";
}

function readJSON(path) {
    try {
        let file = Gio.File.new_for_path(path);
        let [ok, contents] = file.load_contents(null);
        if (!ok) return null;
        let text = contents instanceof Uint8Array
            ? new TextDecoder().decode(contents)
            : contents.toString();
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Custom tooltip — positions ABOVE the cursor so it stays on-screen on a
// bottom panel.  Uses Main.uiGroup so it floats over everything.
// ---------------------------------------------------------------------------
function AgentTooltip(ball) {
    this._text    = "";
    this._visible = false;
    this._ball    = ball;

    this._actor = new St.Label({
        style: "background-color: rgba(20,20,20,0.93);"
             + "color: #e0e0e0;"
             + "padding: 7px 10px;"
             + "border-radius: 4px;"
             + "font-size: 11px;",
    });
    this._actor.clutter_text.single_line_mode = false;
    this._actor.clutter_text.line_wrap = false;
    this._actor.hide();
    Main.uiGroup.add_actor(this._actor);

    this._enterSig  = ball.connect("enter-event",  Lang.bind(this, this._onEnter));
    this._leaveSig  = ball.connect("leave-event",  Lang.bind(this, this._onLeave));
    this._motionSig = ball.connect("motion-event", Lang.bind(this, this._onMotion));
}

AgentTooltip.prototype = {
    _onEnter: function() {
        this._actor.set_text(this._text);
        this._actor.show();
        this._visible = true;
        this._reposition();
    },

    _onLeave: function() {
        this._actor.hide();
        this._visible = false;
    },

    _onMotion: function() {
        if (this._visible) this._reposition();
    },

    _reposition: function() {
        let [mx, my] = global.get_pointer();
        let aw = this._actor.width  || 220;
        let ah = this._actor.height || 80;
        let sw = global.screen_width  || 1920;

        let ty = my - ah - 14;
        if (ty < 4) ty = my + 22;

        let tx = mx + 10;
        if (tx + aw > sw - 8) tx = sw - aw - 8;
        if (tx < 4) tx = 4;

        this._actor.set_position(tx, ty);
    },

    set_text: function(text) {
        this._text = text;
        if (this._visible) {
            this._actor.set_text(text);
            this._reposition();
        }
    },

    destroy: function() {
        try { this._ball.disconnect(this._enterSig);  } catch (_) {}
        try { this._ball.disconnect(this._leaveSig);  } catch (_) {}
        try { this._ball.disconnect(this._motionSig); } catch (_) {}
        this._actor.hide();
        this._actor.destroy();
    },
};

// ---------------------------------------------------------------------------
// Applet
// ---------------------------------------------------------------------------
function ClaudeAgentStateApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

ClaudeAgentStateApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);

        this._box = new St.BoxLayout({ vertical: false });
        this.actor.add_actor(this._box);
        this.actor.set_style("padding: 0 4px;");

        // pid (str) -> { ball, tooltip: AgentTooltip, color, inBox }
        this._entries       = {};
        // transient decorations (labels, separators) rebuilt each tick
        this._transient     = [];
        // pid -> last seen state (for transition detection)
        this._prevStates    = {};
        // pending debounced update timer id
        this._pendingUpdate = null;

        // inotify: watch for changes to the state file (including atomic replace)
        this._setupFileMonitor();

        // Fallback poll in case inotify misses anything
        this._timer = Mainloop.timeout_add(FALLBACK_MS, Lang.bind(this, this._tick));

        // Initial read
        this._update();
    },

    _setupFileMonitor: function() {
        try {
            // Monitor the directory so atomic rename (os.replace) is caught reliably.
            // GLib internally watches IN_MOVED_TO in the parent dir for file monitors,
            // but directory monitoring is more explicit about it.
            let dir = Gio.File.new_for_path("/tmp");
            this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorSig  = this._fileMonitor.connect(
                "changed", Lang.bind(this, this._onDirChanged)
            );
        } catch (_) {
            this._fileMonitor = null;
        }
    },

    _onDirChanged: function(monitor, file, otherFile) {
        // Filter to only the state file (including the tmp file being renamed)
        let name      = file      ? file.get_basename()      : "";
        let otherName = otherFile ? otherFile.get_basename() : "";
        if (name !== "claude-agents.json" && otherName !== "claude-agents.json") return;

        // Debounce: coalesce rapid events (write + rename) into one update
        if (this._pendingUpdate) return;
        this._pendingUpdate = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30,
            Lang.bind(this, function() {
                this._pendingUpdate = null;
                this._update();
                return GLib.SOURCE_REMOVE;
            })
        );
    },

    // Returns numeric X11 window ID of the currently focused window, or null.
    _getFocusedXid: function() {
        try {
            let win = global.display.focus_window;
            if (win) return win.get_xwindow();
        } catch (_) {}
        return null;
    },

    // Returns true if the agent's IDE window is currently focused.
    _agentWindowFocused: function(agent) {
        if (!agent.window_id) return false;
        let focusedXid = this._getFocusedXid();
        if (focusedXid === null) return false;
        // window_id may be hex ("0x...") or decimal — Number() handles both
        return focusedXid === Number(agent.window_id);
    },

    _sendNotification: function(agent, title, body, urgency) {
        if (this._agentWindowFocused(agent)) return;
        Util.spawn([
            "notify-send",
            "--app-name=Claude Code",
            "--urgency=" + (urgency || "normal"),
            "--icon=dialog-information",
            title, body,
        ]);
    },

    _tick: function() {
        this._update();
        return GLib.SOURCE_CONTINUE;
    },

    _update: function() {
        let data = readJSON(STATE_FILE);
        // On read failure keep whatever is currently displayed — don't clear balls.
        if (!data) return;

        let agents = data.agents || {};

        // Sort oldest first (leftmost in panel)
        let sorted = Object.values(agents).sort(function(a, b) {
            return (a.started_at || 0) - (b.started_at || 0);
        });

        let livePids = {};
        for (let i = 0; i < sorted.length; i++) {
            livePids[String(sorted[i].pid)] = true;
        }

        // Remove stale entries
        for (let pid in this._entries) {
            if (!livePids[pid]) {
                let e = this._entries[pid];
                if (e.inBox) this._box.remove_actor(e.ball);
                e.tooltip.destroy();
                e.ball.destroy();
                delete this._entries[pid];
                delete this._prevStates[pid];
            }
        }

        // Create new entries (balls stay alive across ticks)
        for (let i = 0; i < sorted.length; i++) {
            let agent = sorted[i];
            let pid   = String(agent.pid);
            if (!this._entries[pid]) {
                let clickPid = pid;
                let ball = new St.Widget({
                    reactive:    true,
                    track_hover: true,
                    style:       this._ballStyle(STATE_COLOR.initialized),
                });
                ball.connect("button-press-event", Lang.bind(this, function(actor, event) {
                    if (event.get_button() === 1) {
                        this._focusAgent(clickPid);
                    }
                    return true;
                }));
                let tip = new AgentTooltip(ball);
                this._entries[pid] = { ball: ball, tooltip: tip, color: STATE_COLOR.initialized, inBox: false };
            }
        }

        // Rebuild the box layout:
        //   • Remove transient decorations (labels, separators)
        //   • Keep ball actors in the box if possible; move them when order changes
        // -----------------------------------------------------------------------

        // Tear down transient decorations
        this._transient.forEach(function(w) { w.destroy(); });
        this._transient = [];

        // Group agents by project_root (fallback: cwd) — one group per IDE project
        let groupOrder = [];
        let groupMap   = {};
        for (let i = 0; i < sorted.length; i++) {
            let agent = sorted[i];
            let gkey  = agent.project_root || agent.cwd || "";
            if (!groupMap[gkey]) {
                groupMap[gkey] = [];
                groupOrder.push(gkey);
            }
            groupMap[gkey].push(agent);
        }

        // Determine desired box child sequence: [sep?, label, ball, ball, …, sep?, …]
        // label carries firstPid so clicking it focuses the IDE window via the server.
        let desired = [];
        for (let gi = 0; gi < groupOrder.length; gi++) {
            if (gi > 0) desired.push({ type: "sep" });
            let gkey     = groupOrder[gi];
            let group    = groupMap[gkey];
            // Prefer a pid that has window_id set so clicking the label focuses the right IDEA.
            let focusPid = String(group[0].pid);
            for (let i = 0; i < group.length; i++) {
                if (group[i].window_id) { focusPid = String(group[i].pid); break; }
            }
            desired.push({ type: "label", text: this._projectName(group[0]), pid: focusPid });
            for (let i = 0; i < group.length; i++) {
                desired.push({ type: "ball", pid: String(group[i].pid) });
            }
        }

        // Check whether current box children already match the desired sequence
        let current = this._box.get_children();
        let needRebuild = current.length !== desired.length;
        if (!needRebuild) {
            for (let i = 0; i < desired.length; i++) {
                let d = desired[i];
                if (d.type === "ball") {
                    if (current[i] !== this._entries[d.pid].ball) { needRebuild = true; break; }
                } else {
                    needRebuild = true; break;
                }
            }
        }

        if (needRebuild) {
            current.forEach(Lang.bind(this, function(c) { this._box.remove_actor(c); }));
            for (let pid in this._entries) this._entries[pid].inBox = false;

            for (let i = 0; i < desired.length; i++) {
                let d = desired[i];
                if (d.type === "sep") {
                    let sep = new St.Widget({
                        style: "width: 1px; background-color: #555555; margin: 3px 5px;",
                    });
                    this._box.add_actor(sep);
                    this._transient.push(sep);
                } else if (d.type === "label") {
                    let clickPid = d.pid;
                    let lbl = new St.Label({
                        text:        d.text,
                        style:       "font-size: 10px; color: #aaaaaa; margin: 0 3px 0 0;",
                        reactive:    true,
                        track_hover: true,
                    });
                    lbl.connect("button-press-event", Lang.bind(this, function(actor, event) {
                        if (event.get_button() === 1) this._focusAgent(clickPid);
                        return true;
                    }));
                    this._box.add_actor(lbl);
                    this._transient.push(lbl);
                } else {
                    let entry = this._entries[d.pid];
                    this._box.add_actor(entry.ball);
                    entry.inBox = true;
                }
            }
        } else {
            for (let pid in this._entries) {
                let entry = this._entries[pid];
                if (!entry.inBox) {
                    this._box.add_actor(entry.ball);
                    entry.inBox = true;
                }
            }
        }

        // Update ball styles, tooltips, and fire notifications for state transitions
        let now = Date.now() / 1000;
        for (let i = 0; i < sorted.length; i++) {
            let agent = sorted[i];
            let pid   = String(agent.pid);
            let entry = this._entries[pid];
            let color = STATE_COLOR[agent.state] || "#888888";

            if (entry.color !== color) {
                entry.color = color;
                entry.ball.set_style(this._ballStyle(color));
            }

            let prevState = this._prevStates[pid];

            // Notify: Claude finished its turn
            if (agent.state === "done" && prevState !== "done") {
                let project = this._projectName(agent);
                this._sendNotification(agent,
                    project + ": Claude finished",
                    "Turn complete — ready for your reply.",
                    "normal"
                );
            }

            // Notify: needs approval
            if (agent.state === "waiting_for_approval" && prevState !== "waiting_for_approval") {
                let project = this._projectName(agent);
                this._sendNotification(agent,
                    project + ": Needs approval",
                    "Claude Code is waiting for your input.",
                    "critical"
                );
            }

            this._prevStates[pid] = agent.state;

            entry.tooltip.set_text(this._tooltipText(agent, now));
        }
    },

    _projectName: function(agent) {
        let path = agent.project_root || agent.cwd;
        if (!path) return "?";
        let parts = path.split("/").filter(Boolean);
        let name  = parts[parts.length - 1] || "?";
        return name.length > LABEL_MAX ? name.slice(0, LABEL_MAX - 1) + "…" : name;
    },

    _ballStyle: function(color) {
        return "background-color: " + color + ";"
             + " width: " + BALL_SIZE + "px;"
             + " height: " + BALL_SIZE + "px;"
             + " border-radius: " + (BALL_SIZE / 2) + "px;"
             + " margin: 0 " + BALL_MARGIN + "px;";
    },

    _tooltipText: function(agent, now) {
        let project    = (agent.project_root || agent.cwd || "").split("/").filter(Boolean).pop() || "unknown";
        let stateLabel = STATE_LABEL[agent.state] || agent.state;
        let toolInfo   = (agent.state === "working" && agent.tool_name) ? ": " + agent.tool_name : "";
        let inState    = agent.timestamp  ? formatDuration(now - agent.timestamp)  : "-";
        let running    = agent.started_at ? formatDuration(now - agent.started_at) : "-";

        let lines = [
            "Project:  " + project,
            "Path:     " + (agent.cwd || "-"),
            "State:    " + stateLabel + toolInfo,
            "Event:    " + (agent.hook_event || "-"),
            "Session:  " + (agent.session_id ? agent.session_id.slice(0, 8) : "-"),
            "In state: " + inState,
            "Running:  " + running,
            "PID:      " + agent.pid,
        ];
        if (agent.subagent_count > 0) lines.push("Subagents: " + agent.subagent_count);
        return lines.join("\n");
    },

    _focusAgent: function(pid) {
        Util.spawn([
            "curl", "-s", "-X", "POST",
            "http://127.0.0.1:7855/focus",
            "-H", "Content-Type: application/json",
            "-d", JSON.stringify({ pid: parseInt(pid, 10) }),
        ]);
    },

    on_applet_removed_from_panel: function() {
        if (this._timer) {
            Mainloop.source_remove(this._timer);
            this._timer = null;
        }
        if (this._pendingUpdate) {
            GLib.source_remove(this._pendingUpdate);
            this._pendingUpdate = null;
        }
        if (this._fileMonitor) {
            try { this._fileMonitor.disconnect(this._monitorSig); } catch (_) {}
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        this._transient.forEach(function(w) { w.destroy(); });
        this._transient = [];
        for (let pid in this._entries) {
            let e = this._entries[pid];
            e.tooltip.destroy();
            e.ball.destroy();
        }
        this._entries = {};
    },
};

function main(metadata, orientation, panel_height, instance_id) {
    return new ClaudeAgentStateApplet(metadata, orientation, panel_height, instance_id);
}
