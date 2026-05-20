import { useState, useEffect, useMemo, useCallback } from "react";
import { useAgentsStore, stateLabel } from "../store/agents";
import type { Agent } from "../store/agents";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function projectColor(projectRoot: string): string {
  let hash = 0;
  for (const ch of projectRoot) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
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

const NEEDS_INPUT_STATES = new Set(["asking_user", "waiting_for_approval"]);
const WORKING_STATES = new Set(["working", "initialized"]);

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
// AgentTerminalModal
// ----------------------------------------------------------------

interface ModalProps {
  agent: Agent;
  now: number;
  onClose: () => void;
}

function AgentTerminalModal({ agent, now, onClose }: ModalProps) {
  const color = projectColor(agent.project_root);
  const name = projectName(agent.project_root);
  const title = sessionTitle(agent);
  const isNeedsInput = NEEDS_INPUT_STATES.has(agent.state);

  const handleAttach = useCallback(() => {
    fetch("/api/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: agent.pid }),
    }).catch(() => {/* ignore */});
    onClose();
  }, [agent.pid, onClose]);

  // Close on backdrop click
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-head">
          <span
            className="modal-status-dot"
            style={{ background: projectColor(agent.project_root) }}
          />
          <div className="modal-title">
            <span style={{ color }}>{name}</span>
            {" · "}
            {title}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Meta grid */}
          <div className="modal-meta">
            <span className="modal-meta-k">Status</span>
            <span className="modal-meta-v">{stateLabel(agent.state)}</span>

            <span className="modal-meta-k">Terminal</span>
            <span className="modal-meta-v">{agent.tab_name || "—"}</span>

            <span className="modal-meta-k">Started</span>
            <span className="modal-meta-v">
              {agent.started_at
                ? timeAgo(now, agent.started_at * 1000) + " ago"
                : "—"}
            </span>

            <span className="modal-meta-k">Last event</span>
            <span className="modal-meta-v">
              {agent.timestamp
                ? timeAgo(now, agent.timestamp * 1000) + " ago"
                : "—"}
            </span>
          </div>

          {/* Notice */}
          <div className="modal-notice">
            Read-only view. To interact, use the terminal directly.
          </div>

          {/* Terminal log placeholder */}
          <div className="modal-term">
            <span className="modal-term-empty">No log data available.</span>
          </div>

          {/* Quick reply — only for needs-input agents */}
          {isNeedsInput && (
            <div className="modal-reply">
              <label className="modal-reply-label">Quick reply</label>
              <textarea
                className="modal-reply-textarea"
                disabled
                placeholder="Type to reply…"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={handleAttach}>
            Go to terminal →
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// AttentionCard
// ----------------------------------------------------------------

interface AttentionCardProps {
  agent: Agent;
  now: number;
  onOpen: () => void;
}

function AttentionCard({ agent, now, onOpen }: AttentionCardProps) {
  const color = projectColor(agent.project_root);
  const name = projectName(agent.project_root);
  const title = sessionTitle(agent);
  const question = agent.tool_name || agent.hook_event || null;

  return (
    <button className="attention-card" onClick={onOpen}>
      <div className="attention-bar" style={{ background: color }} />
      <div className="attention-body">
        <div className="attention-head">
          <span className="attention-project" style={{ color }}>
            {name}
          </span>
          <span className="attention-status">
            <span className="status-pulse needs-input" />
            Needs input
          </span>
          <span className="attention-ago">
            {agent.timestamp
              ? timeAgo(now, agent.timestamp * 1000) + " ago"
              : "—"}
          </span>
        </div>
        <div className="attention-title">{title}</div>
        {question && (
          <div className="attention-question">
            <span className="q-mark">?</span>
            {question}
          </div>
        )}
        <div className="attention-foot">
          <span className="terminal-tag">{agent.tab_name}</span>
          <span className="attention-cta">Reply →</span>
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------
// WorkingCard
// ----------------------------------------------------------------

interface WorkingCardProps {
  agent: Agent;
  now: number;
  onOpen: () => void;
}

function WorkingCard({ agent, now, onOpen }: WorkingCardProps) {
  const color = projectColor(agent.project_root);
  const name = projectName(agent.project_root);
  const title = sessionTitle(agent);

  return (
    <button className="working-card" onClick={onOpen}>
      <div className="working-mark" style={{ background: color }} />
      <div className="working-body">
        <div className="working-head">
          <span className="working-project" style={{ color }}>
            {name}
          </span>
          <span className="working-sep">·</span>
          <span className="working-title">{title}</span>
        </div>
        <div className="working-sub">
          <span className="status-pulse working" />
          <b>Working</b>
          <span className="working-sep">·</span>
          <span className="terminal-tag">{agent.tab_name}</span>
          <span className="working-sep">·</span>
          <span>
            last{" "}
            {agent.timestamp ? timeAgo(now, agent.timestamp * 1000) : "—"}
          </span>
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------
// AgentsPage
// ----------------------------------------------------------------

export function AgentsPage() {
  const { agents, connected } = useAgentsStore();
  const now = useNow();
  const [openPid, setOpenPid] = useState<string | null>(null);

  const agentList = useMemo(() => Object.values(agents), [agents]);

  const needsInputAgents = useMemo(
    () =>
      agentList
        .filter((a) => NEEDS_INPUT_STATES.has(a.state))
        .sort((a, b) => b.timestamp - a.timestamp),
    [agentList]
  );

  const workingAgents = useMemo(
    () =>
      agentList
        .filter((a) => WORKING_STATES.has(a.state))
        .sort((a, b) => b.timestamp - a.timestamp),
    [agentList]
  );

  const doneAgents = useMemo(
    () =>
      agentList
        .filter((a) => a.state === "done")
        .sort((a, b) => b.timestamp - a.timestamp),
    [agentList]
  );

  const openAgent = openPid != null ? agents[openPid] : null;

  const hasAny = needsInputAgents.length > 0 || workingAgents.length > 0 || doneAgents.length > 0;

  return (
    <div className="agents-page">
      {/* Page header with connection badge */}
      <div className="page-header">
        <h1>Agents</h1>
        <span
          className={`connection-badge ${connected ? "connected" : "disconnected"}`}
        >
          {connected ? "live" : "disconnected"}
        </span>
      </div>

      {/* Needs attention section */}
      {needsInputAgents.length > 0 && (
        <section className="active-section attention">
          <h2 className="active-section-title">
            <span className="status-pulse needs-input" />
            Needs your attention
            <span className="section-count">{needsInputAgents.length}</span>
          </h2>
          <div className="attention-cards">
            {needsInputAgents.map((agent) => (
              <AttentionCard
                key={agent.pid}
                agent={agent}
                now={now}
                onOpen={() => setOpenPid(String(agent.pid))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Working section */}
      {workingAgents.length > 0 && (
        <section className="active-section">
          <h2 className="active-section-title">
            <span className="status-pulse working" />
            Working
            <span className="section-count">{workingAgents.length}</span>
          </h2>
          <div className="working-cards">
            {workingAgents.map((agent) => (
              <WorkingCard
                key={agent.pid}
                agent={agent}
                now={now}
                onOpen={() => setOpenPid(String(agent.pid))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Done section */}
      {doneAgents.length > 0 && (
        <section className="active-section done">
          <h2 className="active-section-title">
            <span className="status-dot done" />
            Done
            <span className="section-count">{doneAgents.length}</span>
          </h2>
          <div className="working-cards">
            {doneAgents.map((agent) => (
              <WorkingCard
                key={agent.pid}
                agent={agent}
                now={now}
                onOpen={() => setOpenPid(String(agent.pid))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!hasAny && (
        <p className="empty-state">All quiet. No active agents.</p>
      )}

      {/* Modal */}
      {openAgent && (
        <AgentTerminalModal
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

  const needs = agentList.filter((a) => NEEDS_INPUT_STATES.has(a.state)).length;
  const working = agentList.filter((a) => WORKING_STATES.has(a.state)).length;
  const idle = agentList.filter((a) => a.state === "done").length;

  return (
    <div className="topbar-stats">
      <span className="topbar-stat" title="Needs input">
        <span className="topbar-stat-dot" style={{ background: "#f59e0b" }} />
        <b>{needs}</b>
        <span className="topbar-stat-label">&nbsp;needs</span>
      </span>
      <span className="topbar-stat" title="Working">
        <span className="topbar-stat-dot" style={{ background: "#3fb950" }} />
        <b>{working}</b>
        <span className="topbar-stat-label">&nbsp;working</span>
      </span>
      <span className="topbar-stat" title="Idle">
        <span className="topbar-stat-dot" style={{ background: "#6e7681" }} />
        <b>{idle}</b>
        <span className="topbar-stat-label">&nbsp;idle</span>
      </span>
    </div>
  );
}
