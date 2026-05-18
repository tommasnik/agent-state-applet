'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const UUID       = 'claude-agent-state@tommasnik';
const STATE_FILE = '/tmp/claude-agents.json';
const FALLBACK_MS = 3000;
const BALL_SIZE   = 16;
const BALL_MARGIN = 2;
const LABEL_MAX   = 12;

const STATE_COLOR = {
    initialized:          '#888888',
    working:              '#e8c000',
    asking_user:          '#4499ff',
    done:                 '#44bb44',
    waiting_for_approval: '#ffaa00',
};

const STATE_LABEL = {
    initialized:          'Initialized',
    working:              'Working',
    asking_user:          'Asking user',
    done:                 'Done',
    waiting_for_approval: 'Waiting for approval',
};

function formatDuration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60)   return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
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
// Tooltip — floats above the cursor so it stays on-screen on a top panel
// ---------------------------------------------------------------------------
class AgentTooltip {
    constructor(ball) {
        this._text    = '';
        this._visible = false;
        this._ball    = ball;

        this._actor = new St.Label({
            style: 'background-color: rgba(20,20,20,0.93);'
                 + 'color: #e0e0e0;'
                 + 'padding: 7px 10px;'
                 + 'border-radius: 4px;'
                 + 'font-size: 11px;',
        });
        this._actor.clutter_text.single_line_mode = false;
        this._actor.clutter_text.line_wrap = false;
        this._actor.hide();
        Main.uiGroup.add_child(this._actor);

        this._enterSig  = ball.connect('enter-event',  this._onEnter.bind(this));
        this._leaveSig  = ball.connect('leave-event',  this._onLeave.bind(this));
        this._motionSig = ball.connect('motion-event', this._onMotion.bind(this));
    }

    _onEnter() {
        this._actor.set_text(this._text);
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
        let aw = this._actor.width  || 220;
        let ah = this._actor.height || 80;
        let sw = global.screen_width || 1920;

        // On a top panel push the tooltip below the cursor instead of above
        let ty = my + 28;
        if (ty + ah > (global.screen_height || 1080) - 8) ty = my - ah - 14;

        let tx = mx + 10;
        if (tx + aw > sw - 8) tx = sw - aw - 8;
        if (tx < 4) tx = 4;

        this._actor.set_position(tx, ty);
    }

    set_text(text) {
        this._text = text;
        if (this._visible) {
            this._actor.set_text(text);
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
        this.set_style('padding: 0 4px;');

        this._entries       = {};  // pid (str) → { ball, tooltip, color, state, inBox }
        this._transient     = [];  // labels + separators rebuilt each tick
        this._prevStates    = {};
        this._pendingUpdate = null;
        this._timer         = null;
        this._fileMonitor   = null;

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

    _update() {
        let data = readJSON(STATE_FILE);
        if (!data) return;

        let agents = data.agents || {};
        let sorted = Object.values(agents).sort((a, b) => (a.started_at || 0) - (b.started_at || 0));

        let livePids = {};
        for (let a of sorted) livePids[String(a.pid)] = true;

        // Remove stale entries
        for (let pid in this._entries) {
            if (!livePids[pid]) {
                let e = this._entries[pid];
                if (e.inBox) this._box.remove_child(e.ball);
                e.tooltip.destroy();
                e.ball.destroy();
                delete this._entries[pid];
                delete this._prevStates[pid];
            }
        }

        // Create new ball widgets (persist across ticks)
        for (let agent of sorted) {
            let pid = String(agent.pid);
            if (!this._entries[pid]) {
                let ball = new St.Widget({
                    reactive:    true,
                    track_hover: true,
                    style:       this._ballStyle(STATE_COLOR.initialized),
                });
                ball.connect('button-press-event', (actor, event) => {
                    if (event.get_button() === 1) {
                        let e = this._entries[pid];
                        if (e && e.state === 'done') {
                            this._resetAgent(pid);
                        } else {
                            this._focusAgent(pid);
                        }
                    }
                    return Clutter.EVENT_STOP;
                });
                let tip = new AgentTooltip(ball);
                this._entries[pid] = { ball, tooltip: tip, color: STATE_COLOR.initialized, state: 'initialized', inBox: false };
            }
        }

        // Rebuild transient decorations (labels + separators)
        this._transient.forEach(w => w.destroy());
        this._transient = [];

        // Group by project_root (fallback: cwd)
        let groupOrder = [];
        let groupMap   = {};
        for (let agent of sorted) {
            let gkey = agent.project_root || agent.cwd || '';
            if (!groupMap[gkey]) { groupMap[gkey] = []; groupOrder.push(gkey); }
            groupMap[gkey].push(agent);
        }

        // Build desired child sequence: [sep?, label, ball, ball, …]
        let desired = [];
        for (let gi = 0; gi < groupOrder.length; gi++) {
            if (gi > 0) desired.push({ type: 'sep' });
            let group    = groupMap[groupOrder[gi]];
            let focusPid = String(group[0].pid);
            for (let a of group) { if (a.window_id) { focusPid = String(a.pid); break; } }
            desired.push({ type: 'label', text: this._projectName(group[0]), pid: focusPid });
            for (let a of group) desired.push({ type: 'ball', pid: String(a.pid) });
        }

        // Only rebuild DOM when order/structure actually changed
        let current     = this._box.get_children();
        let needRebuild = current.length !== desired.length;
        if (!needRebuild) {
            for (let i = 0; i < desired.length; i++) {
                let d = desired[i];
                if (d.type === 'ball') {
                    if (current[i] !== this._entries[d.pid].ball) { needRebuild = true; break; }
                } else {
                    needRebuild = true; break;
                }
            }
        }

        if (needRebuild) {
            current.forEach(c => this._box.remove_child(c));
            for (let pid in this._entries) this._entries[pid].inBox = false;

            for (let d of desired) {
                if (d.type === 'sep') {
                    let sep = new St.Widget({ style: 'width: 1px; background-color: #555555; margin: 3px 5px;' });
                    this._box.add_child(sep);
                    this._transient.push(sep);
                } else if (d.type === 'label') {
                    let focusPid = d.pid;
                    let lbl = new St.Label({
                        text:        d.text,
                        style:       'font-size: 10px; color: #aaaaaa; margin: 0 3px 0 0;',
                        reactive:    true,
                        track_hover: true,
                    });
                    lbl.connect('button-press-event', (actor, event) => {
                        if (event.get_button() === 1) this._focusAgent(focusPid);
                        return Clutter.EVENT_STOP;
                    });
                    this._box.add_child(lbl);
                    this._transient.push(lbl);
                } else {
                    let entry = this._entries[d.pid];
                    this._box.add_child(entry.ball);
                    entry.inBox = true;
                }
            }
        } else {
            for (let pid in this._entries) {
                let e = this._entries[pid];
                if (!e.inBox) { this._box.add_child(e.ball); e.inBox = true; }
            }
        }

        // Update colors and tooltips
        let now = Date.now() / 1000;
        for (let agent of sorted) {
            let pid   = String(agent.pid);
            let entry = this._entries[pid];
            let color = STATE_COLOR[agent.state] || '#888888';

            if (entry.color !== color) {
                entry.color = color;
                entry.ball.set_style(this._ballStyle(color));
            }
            entry.state = agent.state;
            this._prevStates[pid] = agent.state;
            entry.tooltip.set_text(this._tooltipText(agent, now));
        }
    }

    _projectName(agent) {
        let path  = agent.project_root || agent.cwd;
        if (!path) return '?';
        let parts = path.split('/').filter(Boolean);
        let name  = parts[parts.length - 1] || '?';
        return name.length > LABEL_MAX ? name.slice(0, LABEL_MAX - 1) + '…' : name;
    }

    _ballStyle(color) {
        return 'background-color: ' + color + ';'
             + ' width: '         + BALL_SIZE + 'px;'
             + ' height: '        + BALL_SIZE + 'px;'
             + ' border-radius: ' + (BALL_SIZE / 2) + 'px;'
             + ' margin: 0 '      + BALL_MARGIN + 'px;';
    }

    _tooltipText(agent, now) {
        let project    = (agent.project_root || agent.cwd || '').split('/').filter(Boolean).pop() || 'unknown';
        let stateLabel = STATE_LABEL[agent.state] || agent.state;
        let toolInfo   = (agent.state === 'working' && agent.tool_name) ? ': ' + agent.tool_name : '';
        let inState    = agent.timestamp  ? formatDuration(now - agent.timestamp)  : '-';
        let running    = agent.started_at ? formatDuration(now - agent.started_at) : '-';

        let lines = [
            'Project:  ' + project,
            'Path:     ' + (agent.cwd || '-'),
            'State:    ' + stateLabel + toolInfo,
            'Event:    ' + (agent.hook_event || '-'),
            'Session:  ' + (agent.session_id ? agent.session_id.slice(0, 8) : '-'),
            'In state: ' + inState,
            'Running:  ' + running,
            'PID:      ' + agent.pid,
        ];
        if (agent.subagent_count > 0) lines.push('Subagents: ' + agent.subagent_count);
        return lines.join('\n');
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
