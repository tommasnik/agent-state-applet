// ---------------------------------------------------------------------------
// Claude Agent State — Cinnamon adapter (loader)
//
// Thin wrapper that:
//   1) imports Cinnamon/GJS legacy modules,
//   2) loads the shared core (applet/core.js, generated from shared/core.mjs
//      by the Makefile's sed transform),
//   3) wires platform-specific host API + onClick semantics,
//   4) attaches the indicator's `box` to this Applet's actor.
//
// All visual/feature logic lives in core. To change a behavior, edit
// shared/core.mjs (the ESM source) — Cinnamon's copy is regenerated.
// ---------------------------------------------------------------------------

const Applet   = imports.ui.applet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Clutter  = imports.gi.Clutter;
const Pango    = imports.gi.Pango;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang     = imports.lang;
const Util     = imports.misc.util;
const Main     = imports.ui.main;

const UUID = "claude-agent-state@tommasnik";

// Load shared core from this applet's directory.
// AppletManager exposes every file in the applet dir under
// `imports.ui.appletManager.applets[UUID].<basename-without-ext>`.
const core = imports.ui.appletManager.applets[UUID].core;

function ClaudeAgentStateApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

ClaudeAgentStateApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);

        this._ph          = panel_height;
        this._orientation = orientation;

        let self = this;

        this._indicator = core.createIndicator({
            deps: { St: St, GLib: GLib, Gio: Gio, Clutter: Clutter, Pango: Pango, Main: Main },
            host: {
                spawn:          function(argv) { Util.spawn(argv); },
                panelHeight:    function() { return self._ph; },
                panelPosition:  function() { return self._panelPosition(); },
                getPointer:     function() { return global.get_pointer(); },
                screenSize:     function() { return [global.screen_width, global.screen_height]; },
                getFocusedXid:  function() {
                    try {
                        let win = global.display.focus_window;
                        if (win) return win.get_xwindow();
                    } catch (_) {}
                    return null;
                },
                getWindowActors: function() { return global.get_window_actors(); },
                // resolveAppIcon(window_id, pid, size) → Clutter actor (icon texture) or null.
                //
                // Looks up the application owning the given window (by X11 window ID hex string)
                // via Cinnamon.WindowTracker. Falls back to PID-based lookup when window_id is
                // unavailable. Returns null when the app cannot be resolved or icon creation fails,
                // so callers must always handle null gracefully.
                //
                // @param {string|null} windowIdHex  — X11 window ID as hex string (e.g. "0x3a00005") or null
                // @param {string}      pid           — agent PID (string)
                // @param {number}      size          — icon size in pixels
                // @returns {Clutter.Actor|null}
                resolveAppIcon: function(windowIdHex, pid, size) {
                    try {
                        const tracker = Cinnamon.WindowTracker.get_default();
                        let app = null;

                        // Try window_id first — most precise, avoids PID reuse races.
                        if (windowIdHex) {
                            let targetXid = parseInt(windowIdHex, 16);
                            let actors = global.get_window_actors();
                            for (let i = 0; i < actors.length; i++) {
                                let mw = actors[i].get_meta_window && actors[i].get_meta_window();
                                if (!mw) continue;
                                let xid = mw.get_xwindow ? mw.get_xwindow() : 0;
                                if (xid === targetXid) {
                                    app = tracker.get_window_app(mw);
                                    break;
                                }
                            }
                        }

                        // Fallback to PID when window_id is absent or lookup failed.
                        if (!app && pid) {
                            app = tracker.get_app_from_pid(parseInt(pid, 10));
                        }

                        if (!app) return null;
                        return app.create_icon_texture(size || 20);
                    } catch (_) {
                        return null;
                    }
                },
            },
            config:  {},   // future: feed from Settings.AppletSettings here
            onClick: function(pid, agent, action) { self._onClick(pid, agent, action); },
        });

        // Dashboard button — always visible, opens web UI at :7855.
        let dashBtn = new St.Label({
            text:        "⚙",
            style:       "color: #7ecfff; font-size: 20px; padding: 0 10px;",
            reactive:    true,
            track_hover: true,
            y_align:     Clutter.ActorAlign.CENTER,
        });
        dashBtn.connect("button-press-event", function() {
            Util.spawn(["xdg-open", "http://127.0.0.1:7855/"]);
            return Clutter.EVENT_STOP;
        });

        this.actor.add_actor(dashBtn);
        this.actor.add_actor(this._indicator.box);
        this.actor.set_style("padding: 0;");

        // Listen for FlashWindow D-Bus signals emitted by the server after web UI focus
        this._dbusFlashId = Gio.DBus.session.signal_subscribe(
            null,
            "org.claude.State",
            "FlashWindow",
            "/org/claude/State",
            null,
            Gio.DBusSignalFlags.NONE,
            function(_conn, _sender, _path, _iface, _signal, params) {
                try {
                    let xid = params.get_child_value(0).get_string()[0];
                    if (xid) {
                        Mainloop.timeout_add(300, function() {
                            self._indicator.flashWindow(xid);
                            return false;
                        });
                    }
                } catch (_) {}
            },
            null
        );
    },

    _panelPosition: function() {
        // Cinnamon orientation: St.Side.{TOP,BOTTOM,LEFT,RIGHT}
        return (this._orientation === St.Side.TOP) ? "top" : "bottom";
    },

    _agentWindowFocused: function(agent) {
        if (!agent || !agent.window_id) return false;
        let focusedXid;
        try {
            let win = global.display.focus_window;
            focusedXid = win ? win.get_xwindow() : null;
        } catch (_) { focusedXid = null; }
        if (focusedXid === null) return false;
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

    _onClick: function(pid, agent, action) {
        if (action === "reset") {
            this._resetAgent(pid);
        }
        this._focusAgent(pid);
    },

    _resetAgent: function(pid) {
        let body = JSON.stringify({ pid: parseInt(pid, 10), state: "initialized" });
        Util.spawn([
            "curl", "-s", "-X", "POST",
            "http://127.0.0.1:7855/agent",
            "-H", "Content-Type: application/json",
            "-d", body,
        ]);
    },

    _focusAgent: function(pid) {
        let body = JSON.stringify({ pid: parseInt(pid, 10) });
        let self = this;
        let proc = new Gio.Subprocess({
            argv: [
                "curl", "-s", "-X", "POST",
                "http://127.0.0.1:7855/focus",
                "-H", "Content-Type: application/json",
                "-d", body,
            ],
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });
        try { proc.init(null); } catch (_) { return; }

        // Read response so we can flash the (possibly server-resolved) window.
        proc.communicate_utf8_async(null, null, function(p, res) {
            let windowId = null;
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                let data = JSON.parse(stdout || "{}");
                windowId = data.window_id || null;
            } catch (_) {}
            if (windowId) {
                Mainloop.timeout_add(300, function() {
                    self._indicator.flashWindow(windowId);
                    return false;
                });
            }
        });
    },

    on_applet_removed_from_panel: function() {
        if (this._dbusFlashId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusFlashId);
            this._dbusFlashId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    },
};

function main(metadata, orientation, panel_height, instance_id) {
    return new ClaudeAgentStateApplet(metadata, orientation, panel_height, instance_id);
}
