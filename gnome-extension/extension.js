// ---------------------------------------------------------------------------
// Claude Agent State — GNOME Shell 45+ adapter (loader)
//
// Thin wrapper that:
//   1) imports GNOME's ESM modules,
//   2) loads the shared core from ./core.mjs (same source as Cinnamon's
//      generated applet/core.js),
//   3) wires platform-specific host API + onClick semantics,
//   4) inserts the indicator's `box` into a PanelMenu.Button.
//
// All visual/feature logic lives in core. Edit shared/core.mjs.
// ---------------------------------------------------------------------------

'use strict';

import GObject from 'gi://GObject';
import St      from 'gi://St';
import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango   from 'gi://Pango';
import Shell   from 'gi://Shell';

import {Extension}       from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main         from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu    from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util         from 'resource:///org/gnome/shell/misc/util.js';

import { createIndicator } from './core.mjs';

const UUID       = 'claude-agent-state@tommasnik';
const DEFAULT_PH = 32;

const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init() {
        // true = no dropdown menu
        super._init(0.0, 'Claude Agent State', true);

        const self = this;

        this._indicator = createIndicator({
            deps: { St, GLib, Gio, Clutter, Pango, Main },
            host: {
                spawn:          (argv) => Util.spawn(argv),
                panelHeight:    () => {
                    let h = Main.panel ? Main.panel.height : 0;
                    return h && h > 18 ? h : DEFAULT_PH;
                },
                panelPosition:  () => 'top',
                getPointer:     () => global.get_pointer(),
                screenSize:     () => [global.screen_width, global.screen_height],
                getFocusedXid:  () => {
                    try {
                        let win = global.display.focus_window;
                        if (win) return win.get_xwindow();
                    } catch (_) {}
                    return null;
                },
                getWindowActors: () => global.get_window_actors(),
                // resolveAppIcon(window_id, pid, size) → Clutter actor (icon texture) or null.
                // Uses Shell.WindowTracker to look up the app owning the given X11 window,
                // falling back to PID-based lookup. Mirrors Cinnamon adapter behavior.
                resolveAppIcon: (windowIdHex, pid, size) => {
                    const log = (msg) => {
                        try {
                            const f = Gio.File.new_for_path('/tmp/claude-icon.log');
                            const out = f.append_to(Gio.FileCreateFlags.NONE, null);
                            out.write_bytes(new GLib.Bytes('[icon] ' + msg + '\n'), null);
                            out.close(null);
                        } catch (_) {}
                    };
                    try {
                        const tracker = Shell.WindowTracker.get_default();
                        let app = null;

                        if (windowIdHex) {
                            const targetXid = parseInt(windowIdHex, 16);
                            const actors = global.get_window_actors();
                            log('lookup win=' + windowIdHex + ' target=' + targetXid + ' actors=' + actors.length);
                            for (let i = 0; i < actors.length; i++) {
                                const mw = actors[i].get_meta_window && actors[i].get_meta_window();
                                if (!mw) continue;
                                const xid = mw.get_xwindow ? mw.get_xwindow() : 0;
                                if (xid === targetXid) {
                                    app = tracker.get_window_app(mw);
                                    log('window match xid=' + xid + ' app=' + (app ? app.get_id() : 'null'));
                                    break;
                                }
                            }
                        }

                        if (!app && pid) {
                            app = tracker.get_app_from_pid(parseInt(pid, 10));
                            log('pid fallback pid=' + pid + ' app=' + (app ? app.get_id() : 'null'));
                        }

                        if (!app) { log('no app win=' + windowIdHex + ' pid=' + pid); return null; }
                        const tex = app.create_icon_texture(size || 20);
                        log('returned tex for app=' + app.get_id() + ' size=' + size);
                        return tex;
                    } catch (e) {
                        log('ERROR ' + e.message);
                        return null;
                    }
                },
            },
            config:  {},   // future: feed from this.getSettings()
            onClick: (pid, agent, action) => self._onClick(pid, agent, action),
            onShortcutClick: (agentId) => self._runAgent(agentId),
        });

        // Dashboard button — always visible, opens web UI at :7855.
        const dashStyle = 'color: #7ecfff; font-size: 20px; padding: 0 10px;';
        const dashBtn = new St.Label({
            text:        '⚙',
            style:       dashStyle,
            reactive:    true,
            track_hover: true,
            y_align:     Clutter.ActorAlign.CENTER,
        });
        // Hover affordance — signal the gear is clickable (opens the web UI).
        dashBtn.connect('notify::hover', () => {
            dashBtn.set_style(dashBtn.hover
                ? dashStyle + ' background-color: rgba(255,255,255,0.16); border-radius: 4px;'
                : dashStyle);
        });
        dashBtn.connect('button-press-event', () => {
            Util.spawn(['xdg-open', 'http://127.0.0.1:7855/']);
            return Clutter.EVENT_STOP;
        });

        // PanelMenu.Button uses BinLayout (overlays children), so wrap dashBtn +
        // indicator box in a horizontal BoxLayout to lay them side-by-side.
        const wrap = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER });
        wrap.add_child(dashBtn);
        wrap.add_child(this._indicator.box);
        this.add_child(wrap);
        this.set_style('padding: 0;');

        // Listen for FlashWindow D-Bus signals emitted by the server after web UI focus
        this._dbusFlashId = Gio.DBus.session.signal_subscribe(
            null,
            'org.claude.State',
            'FlashWindow',
            '/org/claude/State',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                try {
                    const xid = params.get_child_value(0).get_string()[0];
                    if (xid) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                            self._indicator.flashWindow(xid);
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                } catch (_) {}
            }
        );
    }

    _agentWindowFocused(agent) {
        if (!agent || !agent.window_id) return false;
        let focusedXid;
        try {
            let win = global.display.focus_window;
            focusedXid = win ? win.get_xwindow() : null;
        } catch (_) { focusedXid = null; }
        if (focusedXid === null) return false;
        return focusedXid === Number(agent.window_id);
    }

    _sendNotification(agent, title, body, urgency) {
        if (this._agentWindowFocused(agent)) return;
        Util.spawn([
            'notify-send',
            '--app-name=Claude Code',
            '--urgency=' + (urgency || 'normal'),
            '--icon=dialog-information',
            title, body,
        ]);
    }

    _onClick(pid, agent, action) {
        if (action === 'reset') {
            this._resetAgent(pid);
        }
        this._focusAgent(pid);
    }

    _resetAgent(pid) {
        Util.spawn([
            'curl', '-s', '-X', 'POST',
            'http://127.0.0.1:7855/agent',
            '-H', 'Content-Type: application/json',
            '-d', JSON.stringify({ pid: parseInt(pid, 10), state: 'initialized' }),
        ]);
    }

    // Launch a configured agent (shortcut button) — same path as the web UI.
    _runAgent(agentId) {
        Util.spawn([
            'curl', '-s', '-X', 'POST',
            'http://127.0.0.1:7855/api/agents/' + parseInt(agentId, 10) + '/run',
        ]);
    }

    _focusAgent(pid) {
        // Spawn curl to /focus and read response for the (possibly server-resolved)
        // window_id, then flash it. Using Gio.Subprocess to capture stdout.
        const self = this;
        let proc;
        try {
            proc = new Gio.Subprocess({
                argv: [
                    'curl', '-s', '-X', 'POST',
                    'http://127.0.0.1:7855/focus',
                    '-H', 'Content-Type: application/json',
                    '-d', JSON.stringify({ pid: parseInt(pid, 10) }),
                ],
                flags: Gio.SubprocessFlags.STDOUT_PIPE,
            });
            proc.init(null);
        } catch (_) { return; }

        proc.communicate_utf8_async(null, null, (p, res) => {
            let windowId = null;
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                let data = JSON.parse(stdout || '{}');
                windowId = data.window_id || null;
            } catch (_) {}
            if (windowId) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    self._indicator.flashWindow(windowId);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    destroy() {
        if (this._dbusFlashId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusFlashId);
            this._dbusFlashId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        super.destroy();
    }
});

export default class ClaudeAgentStateExtension extends Extension {
    enable() {
        GLib.spawn_command_line_async('sh -c ' + GLib.shell_quote('echo "[enable] ' + Date.now() + '" >> /tmp/claude-icon.log'));
        this._indicator = new ClaudeIndicator();
        Main.panel.addToStatusArea(UUID, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
