import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface RunRow {
  id: number;
  agent_id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  output: string | null;
  ai_title: string | null;
  duration_ms: number | null;
  pid?: number | null;
  launch_type?: string | null;
}

interface Agent {
  id: number;
  name: string;
  project_path: string;
  prompt: string | null;
  cron: string | null;
  type: "interactive" | "headless" | "calendar_agent" | "calendar_agent_cli";
  enabled: boolean;
  shortcut_icon: string | null;
  created_at: string;
  last_run: RunRow | null;
  next_run_at: string | null;
  is_running: boolean;
}

interface Project {
  name: string;
  path: string;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function projectColor(path: string): string {
  let hash = 0;
  for (const ch of path) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function projectBasename(path: string): string {
  if (!path) return "unknown";
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

function fmtAbs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(started: string, finished: string | null): string {
  if (!finished) return "running";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function firstLine(s: string | null | undefined): string {
  if (!s) return "";
  const i = s.indexOf("\n");
  return i === -1 ? s : s.slice(0, i);
}

const RUN_STATUS_META: Record<string, { label: string; color: string }> = {
  success: { label: "Success", color: "#3fb950" },
  failed: { label: "Failed", color: "#f85149" },
  error: { label: "Error", color: "#f85149" },
  running: { label: "Running", color: "#f5a623" },
};

function runStatusMeta(status: string | null): { label: string; color: string } {
  if (!status) return { label: "Unknown", color: "#888" };
  return RUN_STATUS_META[status.toLowerCase()] ?? { label: status, color: "#888" };
}

function buildCron(date: string, time: string, recurrence: string): string {
  const dt = new Date(`${date}T${time}`);
  const min = dt.getMinutes();
  const hour = dt.getHours();
  const day = dt.getDate();
  const month = dt.getMonth() + 1;
  const dow = dt.getDay();
  if (recurrence === "daily") return `${min} ${hour} * * *`;
  if (recurrence === "weekly") return `${min} ${hour} * * ${dow}`;
  // once
  return `${min} ${hour} ${day} ${month} *`;
}

function parseCron(cron: string): { date: string; time: string; recurrence: string } {
  const parts = cron.trim().split(/\s+/);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (parts.length !== 5) return { date: defaultDate(), time: defaultTime(), recurrence: "once" };
  const [min, hour, day, month, dow] = parts;
  const time = `${pad(parseInt(hour) || 0)}:${pad(parseInt(min) || 0)}`;
  if (day === "*" && month === "*") {
    // daily or weekly
    const now = new Date();
    if (dow !== "*") {
      // weekly — find next occurrence of that weekday
      const target = parseInt(dow);
      const d = new Date(now);
      d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7 || 7));
      return { date: d.toISOString().slice(0, 10), time, recurrence: "weekly" };
    }
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: d.toISOString().slice(0, 10), time, recurrence: "daily" };
  }
  // once — reconstruct date from day+month, use current or next year
  const now = new Date();
  const year = now.getFullYear();
  const d = new Date(year, parseInt(month) - 1, parseInt(day));
  if (d < now) d.setFullYear(year + 1);
  return { date: d.toISOString().slice(0, 10), time, recurrence: "once" };
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultTime(): string {
  return "02:30";
}

function formatNextRun(nextRunAt: string | null): string {
  if (!nextRunAt) return "Unknown";
  const next = new Date(nextRunAt);
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);

  const isToday = next.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = next.toDateString() === tomorrow.toDateString();

  const timeStr = next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const relStr = diffH > 0 ? `in ${diffH}h ${diffM}m` : `in ${diffM}m`;

  let dayStr: string;
  if (isToday) dayStr = `today ${timeStr}`;
  else if (isTomorrow) dayStr = `tomorrow ${timeStr}`;
  else dayStr = `${next.toLocaleDateString()} ${timeStr}`;

  return `${dayStr} (${relStr})`;
}

function fmtRunDuration(durationMs: number | null, startedAt: string, finishedAt: string | null): string {
  if (finishedAt === null) {
    return fmtDuration(startedAt, null);
  }
  if (durationMs !== null) {
    const s = Math.floor(durationMs / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}m ${rem}s` : `${s}s`;
  }
  return fmtDuration(startedAt, finishedAt);
}

// ----------------------------------------------------------------
// RunDetailModal
// ----------------------------------------------------------------

interface RunDetailModalProps {
  agent: Agent;
  run: RunRow;
  onClose: () => void;
  onRerun: () => void;
}

function RunDetailModal({ agent, run, onClose, onRerun }: RunDetailModalProps) {
  const meta = runStatusMeta(run.status);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="run-status-dot" style={{ background: meta.color }} />
          <div className="modal-title">{agent.name}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-meta">
            <span className="modal-meta-k">Project</span>
            <span className="modal-meta-v" style={{ color: projectColor(agent.project_path) }}>
              {projectBasename(agent.project_path)}
            </span>

            <span className="modal-meta-k">Status</span>
            <span className="modal-meta-v" style={{ color: meta.color }}>
              {meta.label}
            </span>

            <span className="modal-meta-k">Started</span>
            <span className="modal-meta-v">{fmtAbs(run.started_at)}</span>

            <span className="modal-meta-k">Duration</span>
            <span className="modal-meta-v">{fmtDuration(run.started_at, run.finished_at)}</span>

            <span className="modal-meta-k">Output</span>
            <span className="modal-meta-v run-output-preview">
              {truncate(firstLine(run.output), 80) || "—"}
            </span>
          </div>

          <div className="run-io">
            <div className="run-io-label">Input (prompt)</div>
            <pre className="run-io-box">{agent.prompt || "(runs Claude without a prompt)"}</pre>
          </div>

          <div className="run-io">
            <div className="run-io-label">Output</div>
            <pre className="run-io-box">{run.output || "(no output)"}</pre>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onRerun}>
            Re-run now
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// AgentModal
// ----------------------------------------------------------------

interface AgentModalProps {
  projects: Project[];
  initialAgent?: Agent;
  onClose: () => void;
  onSaved: () => void;
}

function AgentModal({ projects, initialAgent, onClose, onSaved }: AgentModalProps) {
  const parsed = initialAgent?.cron ? parseCron(initialAgent.cron) : null;
  const [projectPath, setProjectPath] = useState(initialAgent?.project_path ?? projects[0]?.path ?? "");
  const [title, setTitle] = useState(initialAgent?.name ?? "");
  const [type, setType] = useState<"interactive" | "headless" | "calendar_agent" | "calendar_agent_cli">(initialAgent?.type ?? "interactive");
  // Terminal-only: open a shell in the project, no prompt (interactive agents only).
  const [justTerminal, setJustTerminal] = useState(
    initialAgent ? initialAgent.type === "interactive" && !initialAgent.prompt : false
  );
  const [prompt, setPrompt] = useState(initialAgent?.prompt ?? "");
  const [shortcutIcon, setShortcutIcon] = useState(initialAgent?.shortcut_icon ?? "");
  const [scheduled, setScheduled] = useState(!!initialAgent?.cron);
  const [whenDate, setWhenDate] = useState(parsed?.date ?? defaultDate());
  const [whenTime, setWhenTime] = useState(parsed?.time ?? defaultTime());
  const [recurrence, setRecurrence] = useState(parsed?.recurrence ?? "once");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initialAgent;
  // Terminal-only mode only applies to interactive agents.
  const terminalOnly = type === "interactive" && justTerminal;
  // calendar-agent (SDK host) and calendar-agent-cli (claude -p /sync-calendar)
  // are driven by their own config + skill, not a free-text prompt, so no prompt
  // is required for either.
  const promptNeeded = !terminalOnly && type !== "calendar_agent" && type !== "calendar_agent_cli";
  const canSubmit = (!promptNeeded || prompt.trim().length > 0) && !submitting;

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const cron = scheduled ? buildCron(whenDate, whenTime, recurrence) : null;
      const payload = {
        name: title.trim() || "Untitled",
        project_path: projectPath,
        prompt: promptNeeded ? prompt.trim() : null,
        cron,
        type,
        enabled: initialAgent?.enabled ?? true,
        shortcut_icon: shortcutIcon.trim() || null,
      };
      const url = isEdit ? `/api/agents/${initialAgent!.id}` : "/api/agents";
      const method = isEdit ? "PUT" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `HTTP ${resp.status}`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{isEdit ? "Edit agent" : "New agent"}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Project (workdir)</label>
              <select
                className="field-select"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
              >
                {projects.length === 0 && (
                  <option value="">No projects found</option>
                )}
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name} — {p.path}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Title (optional)</label>
              <input
                className="field-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Nightly type-check sweep"
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label">Type</label>
                <select
                  className="field-select"
                  value={type}
                  onChange={(e) => setType(e.target.value as "interactive" | "headless" | "calendar_agent" | "calendar_agent_cli")}
                >
                  <option value="interactive">Interactive (Ghostty)</option>
                  <option value="headless">Headless</option>
                  <option value="calendar_agent">Calendar Agent (long-lived)</option>
                  <option value="calendar_agent_cli">Calendar Agent CLI</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Shortcut icon (optional)</label>
                <input
                  className="field-input"
                  value={shortcutIcon}
                  onChange={(e) => setShortcutIcon(e.target.value)}
                  placeholder="e.g. 🚀 or TS"
                  data-testid="shortcut-icon-input"
                />
              </div>
            </div>

            {type === "interactive" && (
              <div className="field">
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={justTerminal}
                    onChange={(e) => setJustTerminal(e.target.checked)}
                    data-testid="just-terminal-checkbox"
                  />
                  <span>Run Claude without a prompt</span>
                </label>
              </div>
            )}

            {promptNeeded && (
              <div className="field">
                <label className="field-label">Prompt *</label>
                <textarea
                  className="field-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What should the agent do? Paste a multi-line prompt here."
                  rows={5}
                />
              </div>
            )}

            <div className="field">
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={scheduled}
                  onChange={(e) => setScheduled(e.target.checked)}
                  data-testid="scheduled-checkbox"
                />
                <span>Run on a schedule</span>
              </label>
            </div>

            {scheduled && (
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Date</label>
                  <input
                    className="field-input"
                    type="date"
                    value={whenDate}
                    onChange={(e) => setWhenDate(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Time</label>
                  <input
                    className="field-input"
                    type="time"
                    value={whenTime}
                    onChange={(e) => setWhenTime(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Recurrence</label>
                  <select
                    className="field-select"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                  >
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save" : "Create")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// AgentCard
// ----------------------------------------------------------------

interface AgentCardProps {
  agent: Agent;
  isOpen: boolean;
  onToggle: () => void;
  onOpenRun: (run: RunRow) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function AgentCard({ agent, isOpen, onToggle, onOpenRun, onToggleEnabled, onRunNow, onEdit, onDelete }: AgentCardProps) {
  const color = projectColor(agent.project_path);
  const basename = projectBasename(agent.project_path);
  const lastRun = agent.last_run;
  const lastRunMeta = lastRun ? runStatusMeta(lastRun.status) : null;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!isOpen || runsLoaded) return;
    fetch(`/api/agents/${agent.id}/runs`)
      .then((r) => r.json())
      .then((data: RunRow[]) => {
        setRuns(data);
        setRunsLoaded(true);
      })
      .catch(() => setRunsLoaded(true));
  }, [isOpen, runsLoaded, agent.id]);

  function handleEnabledChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    onToggleEnabled(e.target.checked);
  }

  function handleEnabledClick(e: React.MouseEvent) {
    e.stopPropagation();
  }

  async function handleRunNow(e: React.MouseEvent) {
    e.stopPropagation();
    if (running) return;
    setRunning(true);
    try {
      await fetch(`/api/agents/${agent.id}/run`, { method: "POST" });
      onRunNow();
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={`schedule-card ${isOpen ? "open" : ""}`}>
      <header className="schedule-header" onClick={onToggle}>
        <div className="schedule-bar" style={{ background: color }} />
        <div className="schedule-meta">
          <div className="schedule-title-row">
            {agent.shortcut_icon && (
              <span className="schedule-badge" data-testid="shortcut-badge" title="Shortcut icon">
                {agent.shortcut_icon}
              </span>
            )}
            <span className="schedule-name">{agent.name}</span>
            <span className="schedule-badge">{agent.type}</span>
            <label className="schedule-toggle" onClick={handleEnabledClick}>
              <input
                type="checkbox"
                checked={agent.enabled}
                onChange={handleEnabledChange}
              />
              <span className="schedule-toggle-label">
                {agent.enabled ? "enabled" : "disabled"}
              </span>
            </label>
          </div>
          <div className="schedule-sub">
            <span style={{ color }}>{basename}</span>
            <span className="schedule-sep">·</span>
            <span className="schedule-cron">{agent.cron || "on-demand"}</span>
          </div>
        </div>
        <div className="schedule-last-run">
          {lastRunMeta ? (
            <>
              <span className="run-status-dot" style={{ background: lastRunMeta.color }} />
              <span style={{ color: lastRunMeta.color, fontSize: 12 }}>{lastRunMeta.label}</span>
              {lastRun!.finished_at && (
                <span style={{ fontSize: 11, color: "#57606a", marginLeft: 4 }}>
                  {fmtDuration(lastRun!.started_at, lastRun!.finished_at)}
                </span>
              )}
              {lastRun!.ai_title && (
                <span style={{ fontSize: 11, color: "#57606a", marginLeft: 4 }}>
                  "{lastRun!.ai_title}"
                </span>
              )}
            </>
          ) : (
            <span className="schedule-no-runs" data-testid="never-run">Never run</span>
          )}
        </div>
        {agent.enabled && agent.next_run_at && (
          <div style={{ fontSize: 11, color: "#57606a", marginRight: 8 }} data-testid="next-run-time">
            Next: {formatNextRun(agent.next_run_at)}
          </div>
        )}
        <button
          className="btn"
          style={{ fontSize: 12, padding: "2px 10px", marginRight: 4 }}
          onClick={handleRunNow}
          disabled={running || agent.is_running}
          title="Run now"
          data-testid="run-now-btn"
        >
          {(running || agent.is_running) ? "…" : "▶ Run now"}
        </button>
        <button
          className="btn"
          style={{ fontSize: 12, padding: "2px 8px", marginRight: 4 }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit agent"
        >
          Edit
        </button>
        <button
          className="btn btn-danger"
          style={{ fontSize: 12, padding: "2px 8px", marginRight: 4 }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete agent"
        >
          Delete
        </button>
        <svg
          className={`chevron ${isOpen ? "open" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </header>

      {isOpen && (
        <div className="schedule-body">
          <div className="schedule-prompt-section">
            <div className="schedule-section-label">Prompt</div>
            <pre className="run-io-box">{agent.prompt || "(runs Claude without a prompt)"}</pre>
          </div>

          <div className="schedule-runs-section">
            <div className="schedule-section-label">
              Run history
              {runsLoaded && (
                <span className="section-count" style={{ marginLeft: 6 }}>
                  {runs.length}
                </span>
              )}
            </div>
            {!runsLoaded ? (
              <div className="empty-state">Loading…</div>
            ) : runs.length === 0 ? (
              <div className="empty-state">No runs yet.</div>
            ) : (
              <>
                <div className="run-table">
                  <div className="run-table-header">
                    <span className="rt-col-when">When</span>
                    <span className="rt-col-status">Status</span>
                    <span className="rt-col-dur">Duration</span>
                    <span className="rt-col-out">Output</span>
                  </div>
                  {runs.slice(0, 5).map((run) => {
                    const rm = runStatusMeta(run.status);
                    return (
                      <button
                        key={run.id}
                        className="run-table-row"
                        onClick={() => onOpenRun(run)}
                      >
                        <span className="rt-col-when mono">{fmtAbs(run.started_at)}</span>
                        <span className="rt-col-status">
                          <span className="run-status-dot" style={{ background: rm.color }} />
                          <span style={{ color: rm.color }}>{rm.label}</span>
                        </span>
                        <span className="rt-col-dur mono">{fmtRunDuration(run.duration_ms, run.started_at, run.finished_at)}</span>
                        <span className="rt-col-out">
                          {run.ai_title ? (
                            <span style={{ fontStyle: "italic" }}>{truncate(run.ai_title, 48)}</span>
                          ) : (
                            truncate(firstLine(run.output), 64)
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Link to="/runs" data-testid="view-all-runs-link">View all runs →</Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------
// AgentsPage
// ----------------------------------------------------------------

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openRun, setOpenRun] = useState<{ agent: Agent; run: RunRow } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: Agent[]) => setAgents(data))
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    loadAgents();
    const t = setInterval(loadAgents, 30_000);
    return () => clearInterval(t);
  }, [loadAgents]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => setProjects(data))
      .catch(() => {/* ignore */});
  }, []);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleToggleEnabled(agent: Agent, enabled: boolean) {
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      loadAgents();
    } catch {/* ignore */}
  }

  async function handleDelete(agent: Agent) {
    if (!window.confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      loadAgents();
    } catch {/* ignore */}
  }

  async function handleRerun(agentId: number) {
    try {
      await fetch(`/api/agents/${agentId}/run`, { method: "POST" });
      setOpenRun(null);
      loadAgents();
    } catch {/* ignore */}
  }

  return (
    <div className="schedules-page">
      <div className="page-header">
        <h1>Agents</h1>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New agent
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="empty-state">No agents yet.</p>
      ) : (
        <div className="sv-list">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              isOpen={expanded.has(a.id)}
              onToggle={() => toggleExpand(a.id)}
              onOpenRun={(run) => setOpenRun({ agent: a, run })}
              onToggleEnabled={(enabled) => handleToggleEnabled(a, enabled)}
              onRunNow={loadAgents}
              onEdit={() => setEditingAgent(a)}
              onDelete={() => handleDelete(a)}
            />
          ))}
        </div>
      )}

      {openRun && (
        <RunDetailModal
          agent={openRun.agent}
          run={openRun.run}
          onClose={() => setOpenRun(null)}
          onRerun={() => handleRerun(openRun.agent.id)}
        />
      )}

      {showCreate && (
        <AgentModal
          projects={projects}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            loadAgents();
          }}
        />
      )}

      {editingAgent && (
        <AgentModal
          projects={projects}
          initialAgent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSaved={() => {
            setEditingAgent(null);
            loadAgents();
          }}
        />
      )}
    </div>
  );
}
