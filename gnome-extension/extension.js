'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {
    describeRender,
    ballStyle,
    tooltipText,
    STATE_COLOR,
    LABEL_H,
} from './render-logic.mjs';

const UUID        = 'claude-agent-state@tommasnik';
const STATE_FILE  = '/tmp/claude-agents.json';
const FALLBACK_MS = 3000;
const DEFAULT_PH  = 32;  // fallback panel height if Main.panel.height not ready

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
// Tooltip — Pango-markup rich tooltip, mirrors the Cinnamon applet.
// Floats above the cursor; on a top panel it falls back to below.
// ---------------------------------------------------------------------------
class AgentTooltip {
    constructor(ball) {
        this._markup  = '';
        this._visible = false;
        this._ball    = ball;

        this._actor = new St.Label({
            style: 'background-color: rgba(18,18,22,0.96);'
                 + 'color: #e0e0e0;'
                 + 'padding: 12px 16px;'
                 + 'border-radius: 6px;'
                 + 'font-size: 13px;'
                 + 'border: 1px solid rgba(255,255,255,0.08);',
        });
        this._actor.clutter_text.single_line_mode = false;
        this._actor.clutter_text.line_wrap = false;
        this._actor.clutter_text.use_markup = true;
        this._actor.hide();
        Main.uiGroup.add_child(this._actor);

        this._enterSig  = ball.connect('enter-event',  this._onEnter.bind(this));
        this._leaveSig  = ball.connect('leave-event',  this._onLeave.bind(this));
        this._motionSig = ball.connect('motion-event', this._onMotion.bind(this));
    }

    _onEnter() {
        this._actor.clutter_text.set_markup(this._markup);
        this._actor.show();
        this._visible = true;
        this._reposition();
    }

    _onLeave() {
        this._actor.hide();
        this._visible = false;
    }

    _onMotion() {
        if (this._visible) this._reposition();
    }

    _reposition() {
        let [mx, my] = global.get_pointer();
        let aw = this._actor.width  || 320;
        let ah = this._actor.height || 120;
        let sw = global.screen_width  || 1920;
        let sh = global.screen_height || 1080;

        // GNOME usually has a top panel — push tooltip below the cursor first.
        let ty = my + 22;
        if (ty + ah > sh - 8) ty = my - ah - 14;
        if (ty < 4) ty = 4;

        let tx = mx + 10;
        if (tx + aw > sw - 8) tx = sw - aw - 8;
        if (tx < 4) tx = 4;

        this._actor.set_position(tx, ty);
    }

    set_text(markup) {
        this._markup = markup;
        if (this._visible) {
            this._actor.clutter_text.set_markup(markup);
            this._reposition();
        }
    }

    destroy() {
        try { this._ball.disconnect(this._enterSig);  } catch (_) {}
        try { this._ball.disconnect(this._leaveSig);  } catch (_) {}
        try { this._ball.disconnect(this._motionSig); } catch (_) {}
        this._actor.hide();
        this._actor.destroy();
    }
}

// ---------------------------------------------------------------------------
// Panel indicator
// ---------------------------------------------------------------------------
const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init() {
        // true = no dropdown menu
        super._init(0.0, 'Claude Agent State', true);

        this._box = new St.BoxLayout({ vertical: false });
        this.add_child(this._box);
        this.set_style('padding: 0;');

        // pid (str) → { ball, tooltip, color, state, inBox }
        this._entries       = {};
        // labels + group containers + separators (rebuilt each tick)
        this._transient     = [];
        this._prevStates    = {};
        this._pendingUpdate = null;
        this._timer         = null;
        this._fileMonitor   = null;
        this._lastAgents    = {};

        this._setupFileMonitor();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FALLBACK_MS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
        this._update();
    }

    _setupFileMonitor() {
        try {
            let dir = Gio.File.new_for_path('/tmp');
            this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorSig  = this._fileMonitor.connect('changed', (monitor, file, otherFile) => {
                let name      = file      ? file.get_basename()      : '';
                let otherName = otherFile ? otherFile.get_basename() : '';
                if (name !== 'claude-agents.json' && otherName !== 'claude-agents.json') return;
                if (this._pendingUpdate) return;
                this._pendingUpdate = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
                    this._pendingUpdate = null;
                    this._update();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (_) {
            this._fileMonitor = null;
        }
    }

    _getFocusedXid() {
        try {
            let win = global.display.focus_window;
            if (win) return win.get_xwindow();
        } catch (_) {}
        return null;
    }

    _agentWindowFocused(agent) {
        if (!agent.window_id) return false;
        let focusedXid = this._getFocusedXid();
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

    _panelHeight() {
        let h = Main.panel ? Main.panel.height : 0;
        return h && h > LABEL_H + 4 ? h : DEFAULT_PH;
    }

    _update() {
        let data = readJSON(STATE_FILE);
        if (!data) return;

        let agents = data.agents || {};
        this._lastAgents = agents;

        let ph     = this._panelHeight();
        let groups = describeRender(agents, ph);

        // Remove stale entries
        let livePids = {};
        for (let gi = 0; gi < groups.length; gi++)
            for (let ai = 0; ai < groups[gi].agents.length; ai++)
                livePids[groups[gi].agents[ai].pid] = true;
        for (let pid in this._entries) {
            if (!livePids[pid]) {
                let e = this._entries[pid];
                if (e.inBox) {
                    let parent = e.ball.get_parent();
                    if (parent) parent.remove_child(e.ball);
                }
                e.tooltip.destroy();
                e.ball.destroy();
                delete this._entries[pid];
                delete this._prevStates[pid];
            }
        }

        // Create new ball widgets (persist across ticks)
        for (let gi = 0; gi < groups.length; gi++) {
            for (let ai = 0; ai < groups[gi].agents.length; ai++) {
                let pid = groups[gi].agents[ai].pid;
                if (!this._entries[pid]) {
                    let clickPid = pid;
                    let ball = new St.Widget({
                        reactive:    true,
                        track_hover: true,
                        style:       ballStyle(STATE_COLOR.initialized, ph * 2, ph - LABEL_H),
                    });
                    ball.connect('button-press-event', (actor, event) => {
                        if (event.get_button() === 1) {
                            let e = this._entries[clickPid];
                            if (e && e.state === 'done') {
                                this._resetAgent(clickPid);
                            } else {
                                this._focusAgent(clickPid);
                            }
                        }
                        return Clutter.EVENT_STOP;
                    });
                    let tip = new AgentTooltip(ball);
                    this._entries[pid] = {
                        ball, tooltip: tip,
                        color: STATE_COLOR.initialized,
                        state: 'initialized',
                        inBox: false,
                    };
                }
            }
        }

        // Detach all balls from their previous parents, then tear down transient containers.
        for (let pid in this._entries) {
            let entry  = this._entries[pid];
            let parent = entry.ball.get_parent();
            if (parent) parent.remove_child(entry.ball);
            entry.inBox = false;
        }
        this._transient.forEach(w => w.destroy());
        this._transient = [];
        this._box.get_children().forEach(c => this._box.remove_child(c));

        // Build one vertical block per group: project label on top, balls row below.
        let now = Date.now() / 1000;
        for (let gi = 0; gi < groups.length; gi++) {
            let g = groups[gi];

            if (gi > 0) {
                let sep = new St.Widget({
                    style: 'width: 1px; background-color: rgba(255,255,255,0.18);'
                         + ' height: ' + ph + 'px; margin: 0 2px;',
                });
                this._box.add_child(sep);
                this._transient.push(sep);
            }

            let groupBox = new St.BoxLayout({ vertical: true });

            // Group label: pick a pid that has a window_id for click-to-focus
            let focusPid = g.agents[0].pid;
            for (let ai = 0; ai < g.agents.length; ai++) {
                let a = agents[g.agents[ai].pid];
                if (a && a.window_id) { focusPid = g.agents[ai].pid; break; }
            }

            let groupLbl = new St.Label({
                style: 'color: rgba(255,255,255,0.85); font-size: 10px;'
                     + ' padding: 0 3px; text-align: center;'
                     + ' width: ' + (g.agents.length * g.ballW) + 'px;',
                reactive:    true,
                track_hover: true,
            });
            groupLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            groupLbl.clutter_text.set_single_line_mode(true);
            groupLbl.set_text(g.label);
            let labelClickPid = focusPid;
            groupLbl.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) this._focusAgent(labelClickPid);
                return Clutter.EVENT_STOP;
            });
            groupBox.add_child(groupLbl);

            let ballsRow = new St.BoxLayout({ vertical: false });
            for (let ai = 0; ai < g.agents.length; ai++) {
                let agentDesc = g.agents[ai];
                let entry     = this._entries[agentDesc.pid];
                entry.ball.set_style(ballStyle(agentDesc.color, g.ballW, g.ballH));
                entry.color = agentDesc.color;
                entry.state = agentDesc.state;
                ballsRow.add_child(entry.ball);
                entry.inBox = true;

                entry.tooltip.set_text(tooltipText(agents[agentDesc.pid], now));
                this._prevStates[agentDesc.pid] = agentDesc.state;
            }
            groupBox.add_child(ballsRow);

            this._box.add_child(groupBox);
            this._transient.push(groupBox);
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
        Util.spawn([
            'curl', '-s', '-X', 'POST',
            'http://127.0.0.1:7855/focus',
            '-H', 'Content-Type: application/json',
            '-d', JSON.stringify({ pid: parseInt(pid, 10) }),
        ]);
    }

    destroy() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        if (this._pendingUpdate) { GLib.source_remove(this._pendingUpdate); this._pendingUpdate = null; }
        if (this._fileMonitor) {
            try { this._fileMonitor.disconnect(this._monitorSig); } catch (_) {}
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        this._transient.forEach(w => w.destroy());
        this._transient = [];
        for (let pid in this._entries) {
            let e = this._entries[pid];
            e.tooltip.destroy();
            e.ball.destroy();
        }
        this._entries = {};
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Extension lifecycle (GNOME Shell 45+ ESM API)
// ---------------------------------------------------------------------------
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
