// Pure rendering logic — no Cinnamon/GJS dependencies.
// Imported directly by the GNOME extension (ESM) and the Node test runner.
// The Cinnamon applet (no ESM support) keeps an inlined copy in applet.js
// that must stay in sync with this file.

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

export function ballStyle(color, w, h) {
    return "background-color: " + color + ";"
         + " width: " + w + "px;"
         + " height: " + h + "px;"
         + " border-radius: 2px;"
         + " margin: 0 " + BALL_MARGIN + "px;";
}

// Returns array of group descriptors from an agents dict (pid → agent object).
// Groups are ordered by the earliest started_at in each group.
// Each group: { key, label, ballW, ballH, agents: [{ pid, state, color }] }
export function describeRender(agents, panelHeight) {
    let sorted = Object.values(agents).sort(function(a, b) {
        return (a.started_at || 0) - (b.started_at || 0);
    });

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

    let groups = [];
    for (let gi = 0; gi < groupOrder.length; gi++) {
        let gkey  = groupOrder[gi];
        let group = groupMap[gkey];
        let n     = group.length;
        let ballW = Math.max(panelHeight, Math.floor(panelHeight * 2 / n));
        let ballH = panelHeight - LABEL_H;
        groups.push({
            key:    gkey,
            label:  projectName(group[0]),
            ballW:  ballW,
            ballH:  ballH,
            agents: group.map(function(agent) {
                return {
                    pid:   String(agent.pid),
                    state: agent.state,
                    color: STATE_COLOR[agent.state] || "#888888",
                };
            }),
        });
    }
    return groups;
}

export function tooltipText(agent, now) {
    let project    = (agent.project_root || agent.cwd || "").split("/").filter(Boolean).pop() || "unknown";
    let stateLabel = STATE_LABEL[agent.state] || agent.state;
    let stateColor = STATE_COLOR[agent.state] || "#888888";
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
