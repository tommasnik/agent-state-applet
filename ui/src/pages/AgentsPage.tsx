import { useState, useEffect, useMemo, useCallback } from "react";
import { useAgentsStore, stateColor, stateLabel } from "../store/agents";
import type { Agent } from "../store/agents";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function ttyOrder(agent: Agent): number {
  if (agent.terminal_type === "ghostty") {
    if (agent.ghostty_tab_index != null) return agent.ghostty_tab_index;
  }
  const m = (agent.tty || "").match(/\/dev\/pts\/(\d+)$/);
  if (m) return parseInt(m[1], 10);
  return 9999;
}

function projectName(projectRoot: string): string {
  if (!projectRoot) return "unknown";
  return projectRoot.replace(/\/+$/, "").split("/").pop() || projectRoot;
}

function timeAgo(now: number, ts: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function sessionTitle(agent: Agent): string {
  if (agent.ai_title) return agent.ai_title;
  if (agent.session_id) return agent.session_id.slice(0, 8);
  return agent.tab_name || String(agent.pid);
}

interface ProjectGroup {
  key: string;
  name: string;
  agents: Agent[];
}

function buildGroups(agents: Record<string, Agent>): ProjectGroup[] {
  const sorted = Object.values(agents).sort((a, b) => ttyOrder(a) - ttyOrder(b));
  const order: string[] = [];
  const map: Record<string, Agent[]> = {};
  for (const agent of sorted) {
    const key = agent.project_root || agent.cwd || "";
    if (!map[key]) {
      map[key] = [];
      order.push(key);
    }
    map[key].push(agent);
  }
  return order.map((key) => ({
    key,
    name: projectName(key),
    agents: map[key],
  }));
}

// ----------------------------------------------------------------
// useNow — ticks every second
// ----------------------------------------------------------------

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ----------------------------------------------------------------
// AgentRow
// ----------------------------------------------------------------

interface AgentRowProps {
  agent: Agent;
  now: number;
  onClick: () => void;
}

function AgentRow({ agent, now, onClick }: AgentRowProps) {
  const color = stateColor(agent.state);
  const label = stateLabel(agent.state);
  const title = sessionTitle(agent);
  const ago = agent.timestamp ? timeAgo(now, agent.timestamp * 1000) : "—";
  const isAnimated = agent.state === "working" || agent.state === "initialized";
  const needsInput = agent.state === "asking_user" || agent.state === "waiting_for_approval";

  return (
    <button className={`agent-row${needsInput ? " agent-row--needs-input" : ""}`} onClick={onClick}>
      <span
        className={`agent-row-dot${isAnimated ? " agent-row-dot--pulse" : ""}`}
        style={{ background: color }}
      />
      <div className="agent-row-body">
        <div className="agent-row-title">{title}</div>
        <div className="agent-row-meta">
          <span style={{ color }}>{label}</span>
          <span className="agent-row-sep">·</span>
          <span>{ago}</span>
          {agent.subagent_count > 0 && (
            <>
              <span className="agent-row-sep">·</span>
              <span>{agent.subagent_count} sub</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------
// ProjectColumn
// ----------------------------------------------------------------

interface ProjectColumnProps {
  group: ProjectGroup;
  now: number;
  onOpen: (pid: string) => void;
}

function ProjectColumn({ group, now, onOpen }: ProjectColumnProps) {
  return (
    <div className="project-col">
      <div className="project-col-head">
        <span className="project-col-name">{group.name}</span>
        <span className="project-col-count">{group.agents.length}</span>
      </div>
      <div className="project-col-agents">
        {group.agents.map((agent) => (
          <AgentRow
            key={agent.pid}
            agent={agent}
            now={now}
            onClick={() => onOpen(String(agent.pid))}
          />
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// AgentDetailModal
// ----------------------------------------------------------------

interface ModalProps {
  agent: Agent;
  now: number;
  onClose: () => void;
}

function AgentDetailModal({ agent, now, onClose }: ModalProps) {
  const color = stateColor(agent.state);
  const name = projectName(agent.project_root);
  const title = sessionTitle(agent);

  const handleAttach = useCallback(() => {
    fetch("/api/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: agent.pid }),
    }).catch(() => {});
    onClose();
  }, [agent.pid, onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-status-dot" style={{ background: color }} />
          <div className="modal-title">
            <span>{name}</span>
            {" · "}
            {title}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <div className="modal-meta">
            <span className="modal-meta-k">Status</span>
            <span className="modal-meta-v" style={{ color }}>{stateLabel(agent.state)}</span>

            <span className="modal-meta-k">Terminal</span>
            <span className="modal-meta-v">{agent.tab_name || "—"}</span>

            <span className="modal-meta-k">Started</span>
            <span className="modal-meta-v">
              {agent.started_at ? timeAgo(now, agent.started_at * 1000) + " ago" : "—"}
            </span>

            <span className="modal-meta-k">Last event</span>
            <span className="modal-meta-v">
              {agent.timestamp ? timeAgo(now, agent.timestamp * 1000) + " ago" : "—"}
            </span>

            {agent.subagent_count > 0 && (
              <>
                <span className="modal-meta-k">Subagents</span>
                <span className="modal-meta-v">{agent.subagent_count}</span>
              </>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={handleAttach}>Go to terminal →</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// AgentsPage
// ----------------------------------------------------------------

export function AgentsPage() {
  const { agents, connected } = useAgentsStore();
  const now = useNow();
  const [openPid, setOpenPid] = useState<string | null>(null);

  const groups = useMemo(() => buildGroups(agents), [agents]);
  const openAgent = openPid != null ? agents[openPid] : null;

  return (
    <div className="agents-page">
      <div className="page-header">
        <h1>Agents</h1>
        <span className={`connection-badge ${connected ? "connected" : "disconnected"}`}>
          {connected ? "live" : "disconnected"}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="empty-state">All quiet. No active agents.</p>
      ) : (
        <div className="projects-board">
          {groups.map((group) => (
            <ProjectColumn
              key={group.key}
              group={group}
              now={now}
              onOpen={setOpenPid}
            />
          ))}
        </div>
      )}

      {openAgent && (
        <AgentDetailModal
          agent={openAgent}
          now={now}
          onClose={() => setOpenPid(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// TopbarStats — exported for use in Layout
// ----------------------------------------------------------------

export function TopbarStats() {
  const { agents } = useAgentsStore();
  const agentList = useMemo(() => Object.values(agents), [agents]);

  const needs = agentList.filter(
    (a) => a.state === "asking_user" || a.state === "waiting_for_approval"
  ).length;
  const working = agentList.filter(
    (a) => a.state === "working" || a.state === "initialized"
  ).length;
  const done = agentList.filter((a) => a.state === "done").length;

  return (
    <div className="topbar-stats">
      <span className="topbar-stat" title="Needs input">
        <span className="topbar-stat-dot" style={{ background: "var(--color-asking-user)" }} />
        <b>{needs}</b>
        <span className="topbar-stat-label">&nbsp;needs</span>
      </span>
      <span className="topbar-stat" title="Working">
        <span className="topbar-stat-dot" style={{ background: "var(--color-working)" }} />
        <b>{working}</b>
        <span className="topbar-stat-label">&nbsp;working</span>
      </span>
      <span className="topbar-stat" title="Done">
        <span className="topbar-stat-dot" style={{ background: "var(--color-done)" }} />
        <b>{done}</b>
        <span className="topbar-stat-label">&nbsp;done</span>
      </span>
    </div>
  );
}
