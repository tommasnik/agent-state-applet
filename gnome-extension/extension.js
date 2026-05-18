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
            },
            config:  {},   // future: feed from this.getSettings()
            onClick: (pid, agent, action) => self._onClick(pid, agent, action),
        });

        this.add_child(this._indicator.box);
        this.set_style('padding: 0;');

        // DEBUG: log every event reaching the box
        this._indicator.box.connect('captured-event', (_a, event) => {
            let t = event && event.type ? event.type() : -1;
            GLib.spawn_command_line_async('sh -c "echo box-captured-event type=' + t + ' >> /tmp/claude-flash.log"');
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('button-press-event', () => {
            GLib.spawn_command_line_async('sh -c "echo PanelButton-press >> /tmp/claude-flash.log"');
            return Clutter.EVENT_PROPAGATE;
        });
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
        GLib.spawn_command_line_async('sh -c "echo \\"_onClick pid=' + pid + ' action=' + action + '\\" >> /tmp/claude-flash.log"');
        if (action === 'reset') {
            this._resetAgent(pid);
        } else {
            this._focusAgent(pid);
        }
    }

    _resetAgent(pid) {
        Util.spawn([
            'curl', '-s', '-X', 'POST',
            'http://127.0.0.1:7855/agent',
            '-H', 'Content-Type: application/json',
            '-d', JSON.stringify({ pid: parseInt(pid, 10), state: 'initialized' }),
        ]);
    }

    _focusAgent(pid) {
        GLib.spawn_command_line_async('sh -c "echo \\"_focusAgent pid=' + pid + '\\" >> /tmp/claude-flash.log"');
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
            } catch (e) {
                GLib.spawn_command_line_async('sh -c "echo \\"focus parse fail: ' + e + '\\" >> /tmp/claude-flash.log"');
            }
            GLib.spawn_command_line_async('sh -c "echo \\"focus pid=' + pid + ' window_id=' + windowId + '\\" >> /tmp/claude-flash.log"');
            if (windowId) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    self._indicator.flashWindow(windowId);
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    destroy() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        super.destroy();
    }
});

export default class ClaudeAgentStateExtension extends Extension {
    enable() {
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
