import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { useAgentsStore, stateColor, stateLabel } from "../store/agents";
import type { Agent } from "../store/agents";
import { BacklogSection } from "../components/BacklogSection";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface SubProject {
  name: string;
  path: string;
  hasBacklog: true;
}

interface Project {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasMcpJson: boolean;
  hasSkills: boolean;
  hasBacklog: boolean;
  subProjects: SubProject[];
}

interface Skill {
  name: string;
  path: string;
}

interface Config {
  projectRoots: string[];
}

interface PipelineJob {
  id: number;
  name: string;
  status: string;
  web_url: string;
  duration: number | null;
  started_at: string | null;
}

interface PipelineData {
  provider: "gitlab" | "github";
  status: string;
  ref: string;
  web_url: string;
  started_at: string | null;
  duration: number | null;
  jobs: PipelineJob[];
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function pipelineColor(status: string): string {
  switch (status) {
    case "success": return "#3fb950";
    case "failed": return "#f85149";
    case "running": return "#e8c000";
    case "pending": return "#4a90d9";
    case "canceled": return "#808080";
    case "skipped": return "#808080";
    default: return "#808080";
  }
}

function pipelineJobIcon(status: string): string {
  switch (status) {
    case "success": return "✓";
    case "failed": return "✗";
    case "running": return "⟳";
    case "pending": return "·";
    case "canceled": return "—";
    case "skipped": return "·";
    default: return "·";
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function projectColor(projectPath: string): string {
  let hash = 0;
  for (const ch of projectPath) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function encodePath(p: string): string {
  return btoa(p).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function sessionTitle(agent: Agent): string {
  if (agent.ai_title) return agent.ai_title;
  if (agent.session_id) return agent.session_id.slice(0, 8);
  return agent.tab_name || String(agent.pid);
}

const NEEDS_INPUT_STATES = new Set(["asking_user", "waiting_for_approval"]);
const WORKING_STATES = new Set(["working", "initialized"]);

// ----------------------------------------------------------------
// RunItem type and run helpers (for ProjectRunsTab)
// ----------------------------------------------------------------

interface RunItem {
  id: number;
  schedule_id: number | null;
  launch_type: string | null;
  terminal_type: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string | null;
  ai_title: string | null;
  schedule_name: string | null;
}

function runFormatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function runFormatDuration(ms: number | null, startedAt: string): string {
  if (ms === null) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    return runFormatMs(elapsed);
  }
  return runFormatMs(ms);
}

function runStatusBadge(status: string | null): { label: string; color: string; bgColor: string } {
  switch (status) {
    case "success":
      return { label: "✓", color: "#1a7f37", bgColor: "#dafbe1" };
    case "failed":
      return { label: "✗", color: "#cf222e", bgColor: "#ffebe9" };
    case "running":
      return { label: "●", color: "#9a6700", bgColor: "#fff8c5" };
    case "cancelled":
      return { label: "○", color: "#57606a", bgColor: "#f6f8fa" };
    default:
      return { label: "?", color: "#57606a", bgColor: "#f6f8fa" };
  }
}

function runTypeLabel(run: RunItem): string {
  if (run.launch_type === "scheduled") return "scheduled";
  if (run.launch_type === "manual_trigger") return "manual/trigger";
  if (run.terminal_type) return `manual/${run.terminal_type}`;
  return run.launch_type ?? "unknown";
}

function runFormatStarted(startedAt: string): string {
  const d = new Date(startedAt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday)
    return `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString();
}

// ----------------------------------------------------------------
// ProjectRunsTab
// ----------------------------------------------------------------

interface ProjectRunsTabProps {
  projectPath: string;
}

export function ProjectRunsTab({ projectPath }: ProjectRunsTabProps) {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 20;

  // Reset filters when project changes
  useEffect(() => {
    setTypeFilter("");
    setStatusFilter("");
    setPage(0);
  }, [projectPath]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("project", projectPath);
    if (typeFilter) params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    fetch(`/api/runs?${params}`)
      .then((r) => r.json())
      .then((data: { runs: RunItem[]; total: number }) => {
        setRuns(data.runs);
        setTotal(data.total);
      })
      .catch(console.error);
  }, [projectPath, typeFilter, statusFilter, page]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const pageCount = Math.ceil(total / limit);

  return (
    <section className="pd-block">
      {/* Filters — no project filter! */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          data-testid="runs-tab-filter-type"
        >
          <option value="">All types</option>
          <option value="scheduled">Scheduled</option>
          <option value="manual">Manual</option>
          <option value="manual_trigger">Manual trigger</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          data-testid="runs-tab-filter-status"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {runs.length === 0 ? (
        <div className="empty-state" data-testid="runs-tab-empty">No runs yet for this project.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["TYPE", "STARTED", "DURATION", "STATUS", "TITLE"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "4px 8px",
                    color: "var(--muted, #57606a)",
                    fontWeight: 500,
                    borderBottom: "1px solid var(--border, #e1e4e8)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const badge = runStatusBadge(run.status);
              return (
                <tr key={run.id}>
                  <td style={{ padding: "4px 8px" }}>
                    {run.launch_type === "scheduled" && run.schedule_id ? (
                      <Link to="/schedules" data-testid={`runs-tab-schedule-link-${run.id}`}>
                        {runTypeLabel(run)}
                      </Link>
                    ) : (
                      runTypeLabel(run)
                    )}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--muted, #57606a)" }}>
                    {runFormatStarted(run.started_at)}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    {run.status === "running"
                      ? runFormatDuration(null, run.started_at)
                      : run.duration_ms != null
                      ? runFormatDuration(run.duration_ms, run.started_at)
                      : "—"}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <span
                      data-testid={`runs-tab-status-${run.id}`}
                      style={{
                        color: badge.color,
                        backgroundColor: badge.bgColor,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {badge.label} {run.status}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--muted, #57606a)", fontStyle: "italic" }}>
                    {run.ai_title ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
            ← prev
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total}>
            next →
          </button>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------
// SubProjectDetail
// ----------------------------------------------------------------

interface SubProjectDetailProps {
  subProject: SubProject;
  rootProjectPath: string;
}

function SubProjectDetail({ subProject, rootProjectPath }: SubProjectDetailProps) {
  return (
    <div className="pd-container">
      <header className="pd-head">
        <div className="pd-mark pd-mark-backlog" />
        <div className="pd-meta">
          <h2 className="pd-name">{subProject.name}</h2>
          <div className="pd-path"><code>{subProject.path}</code></div>
          <div className="pd-flags">
            <span className="pd-flag">Backlog</span>
          </div>
        </div>
      </header>

      <BacklogSection
        backlogPath={subProject.path}
        actionRootPath={rootProjectPath}
        projectName={subProject.name}
      />
    </div>
  );
}

// ----------------------------------------------------------------
// AgentTerminalModal
// ----------------------------------------------------------------

interface ModalProps {
  agent: Agent;
  onClose: () => void;
}

function AgentTerminalModal({ agent, onClose }: ModalProps) {
  const color = projectColor(agent.project_root);
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

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
    [onClose]
  );

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-status-dot" style={{ background: color }} />
          <div className="modal-title">
            <span style={{ color }}>{agent.project_root.split("/").pop()}</span>
            {" · "}
            {title}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="modal-meta">
            <span className="modal-meta-k">Status</span>
            <span className="modal-meta-v">{stateLabel(agent.state)}</span>
            <span className="modal-meta-k">Terminal</span>
            <span className="modal-meta-v">{agent.tab_name || "—"}</span>
            <span className="modal-meta-k">Session</span>
            <span className="modal-meta-v">{agent.session_id?.slice(0, 12) || "—"}</span>
          </div>
          <div className="modal-notice">Read-only view. To interact, use the terminal directly.</div>
          <div className="modal-term">
            <span className="modal-term-empty">No log data available.</span>
          </div>
          {isNeedsInput && (
            <div className="modal-reply">
              <label className="modal-reply-label">Quick reply</label>
              <textarea className="modal-reply-textarea" disabled placeholder="Type to reply…" />
            </div>
          )}
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
// ProjectDetail
// ----------------------------------------------------------------

interface ProjectDetailProps {
  project: Project;
  agents: Agent[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenAgent: (agent: Agent) => void;
}

function ProjectDetail({ project, agents, isFavorite, onToggleFavorite, onOpenAgent }: ProjectDetailProps) {
  const encoded = encodePath(project.path);
  const color = projectColor(project.path);

  const [activeTab, setActiveTab] = useState<"overview" | "runs">("overview");

  useEffect(() => {
    setActiveTab("overview");
  }, [project.path]);

  const [claudeMd, setClaudeMd] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [skills, setSkills] = useState<Skill[]>([]);

  const [pipeline, setPipeline] = useState<PipelineData | null | undefined>(undefined);

  useEffect(() => {
    setClaudeMd(null);
    setEditMode(false);
    fetch(`/api/projects/${encoded}/claude-md`)
      .then((r) => r.json())
      .then((data: { content: string }) => setClaudeMd(data.content))
      .catch(() => setClaudeMd(""));
  }, [encoded]);

  useEffect(() => {
    setSkills([]);
    if (!project.hasSkills) return;
    fetch(`/api/projects/${encoded}/skills`)
      .then((r) => r.json())
      .then((data: Skill[]) => setSkills(data))
      .catch(() => setSkills([]));
  }, [encoded, project.hasSkills]);

  useEffect(() => {
    setPipeline(undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchPipeline = () => {
      fetch(`/api/projects/${encoded}/pipeline`)
        .then((r) => r.json())
        .then((data: PipelineData | null) => {
          setPipeline(data);
          const isActive = data && (data.status === "running" || data.status === "pending");
          const interval = isActive ? 5000 : 30000;
          timer = setTimeout(fetchPipeline, interval);
        })
        .catch(() => {
          setPipeline(null);
          timer = setTimeout(fetchPipeline, 30000);
        });
    };

    fetchPipeline();
    return () => { if (timer !== null) clearTimeout(timer); };
  }, [encoded]);

  const handleEditStart = useCallback(() => {
    setEditContent(claudeMd ?? "");
    setEditMode(true);
  }, [claudeMd]);

  const handleEditCancel = useCallback(() => setEditMode(false), []);

  const handleEditSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/projects/${encoded}/claude-md`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setClaudeMd(editContent);
      setEditMode(false);
    } catch {/* ignore */} finally {
      setSaving(false);
    }
  }, [encoded, editContent]);

  return (
    <div className="pd-container">
      <header className="pd-head">
        <div className="pd-mark" style={{ background: color }} />
        <div className="pd-meta">
          <h2 className="pd-name">
            {project.name}
            <button
              className={`pd-star-btn${isFavorite ? " pd-star-btn--active" : ""}`}
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              {isFavorite ? "★" : "☆"}
            </button>
          </h2>
          <div className="pd-path"><code>{project.path}</code></div>
          <div className="pd-flags">
            {project.hasClaudeMd && <span className="pd-flag">CLAUDE.md</span>}
            {project.hasMcpJson && <span className="pd-flag">MCP</span>}
            {project.hasSkills && <span className="pd-flag">Skills</span>}
            {project.hasBacklog && <span className="pd-flag">Backlog</span>}
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border, #e1e4e8)", marginBottom: 16 }}>
        {(["overview", "runs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            data-testid={`tab-${tab}`}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--accent, #0969da)" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "var(--accent, #0969da)" : "inherit",
              textTransform: "capitalize",
            }}
          >
            {tab === "overview" ? "Overview" : "Runs"}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <>
      {/* Skills */}
      {project.hasSkills && skills.length > 0 && (
        <section className="pd-block">
          <div className="pd-block-head">
            Skills <span className="section-count">{skills.length}</span>
          </div>
          <div className="pd-list">
            {skills.map((s) => (
              <div key={s.name} className="pd-list-row">
                <span className="pd-list-dot" style={{ background: "var(--accent)" }} />
                <span className="pd-list-name">/{s.name}</span>
                <span className="pd-list-tag">enabled</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Backlog */}
      {project.hasBacklog && (
        <BacklogSection
          backlogPath={project.path}
          actionRootPath={project.path}
          projectName={project.name}
        />
      )}

      {/* Pipeline */}
      {pipeline !== undefined && (
        <section className="pd-block pipeline-section">
          <div className="pd-block-head">
            Pipeline
            {pipeline && (
              <span
                className="pm-pip pm-pip-pipeline"
                style={{ background: pipelineColor(pipeline.status), color: "#fff" }}
              >
                {pipeline.status}
              </span>
            )}
          </div>
          {pipeline === null ? null : pipeline === undefined ? (
            <div className="empty-state">Loading…</div>
          ) : (
            <>
              <div className="pipeline-meta">
                <span className="pipeline-branch">
                  <code>{pipeline.ref}</code>
                </span>
                {pipeline.started_at && (
                  <span className="pipeline-time">{timeAgo(pipeline.started_at)}</span>
                )}
                {pipeline.duration !== null && (
                  <span className="pipeline-dur">{formatDuration(pipeline.duration)}</span>
                )}
                {pipeline.web_url && (
                  <a
                    href={pipeline.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pipeline-link"
                  >
                    Open in GitLab
                  </a>
                )}
              </div>
              {pipeline.jobs.length > 0 && (
                <div className="pipeline-jobs">
                  {pipeline.jobs.map((job) => (
                    <button
                      key={job.id}
                      className="pipeline-job"
                      onClick={() => window.open(job.web_url, "_blank")}
                      title={`Open job log: ${job.name}`}
                    >
                      <span
                        className="pipeline-job-icon"
                        style={{ color: pipelineColor(job.status) }}
                      >
                        {pipelineJobIcon(job.status)}
                      </span>
                      <span className="pipeline-job-name">{job.name}</span>
                      <span className="pipeline-job-status" style={{ color: pipelineColor(job.status) }}>
                        {job.status}
                      </span>
                      {job.duration !== null && (
                        <span className="pipeline-job-dur">{formatDuration(job.duration)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* CLAUDE.md */}
      <section className="pd-block">
        <div className="pd-block-head pd-block-head-row">
          CLAUDE.md
          {!editMode && (
            <button className="btn pd-edit-btn" onClick={handleEditStart}>
              Edit
            </button>
          )}
        </div>
        {claudeMd === null ? (
          <div className="empty-state">Loading…</div>
        ) : editMode ? (
          <div className="pd-editor">
            <textarea
              className="field-textarea pd-editor-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={16}
            />
            <div className="pd-editor-foot">
              <button className="btn" onClick={handleEditCancel}>Cancel</button>
              <button className="btn btn-primary" onClick={handleEditSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : claudeMd ? (
          <pre className="pd-claude-md">{claudeMd}</pre>
        ) : (
          <div className="empty-state">No CLAUDE.md found in this project.</div>
        )}
      </section>

      {/* Agents in project */}
      <section className="pd-block">
        <div className="pd-block-head">
          Agents in project <span className="section-count">{agents.length}</span>
        </div>
        {agents.length === 0 ? (
          <div className="empty-state">No active agents in this project.</div>
        ) : (
          <div className="pd-agents">
            {agents.map((a) => (
              <button key={a.pid} className="pd-agent" onClick={() => onOpenAgent(a)}>
                <span className="pd-agent-dot" style={{ background: stateColor(a.state) }} />
                <div className="pd-agent-body">
                  <div className="pd-agent-title">{sessionTitle(a)}</div>
                  <div className="pd-agent-sub">{stateLabel(a.state)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
        </>
      )}

      {activeTab === "runs" && <ProjectRunsTab projectPath={project.path} />}
    </div>
  );
}

// ----------------------------------------------------------------
// ProjectsPage
// ----------------------------------------------------------------

function toTildePath(p: string): string {
  const parts = p.split("/");
  if (parts.length >= 3 && parts[1] === "home") {
    const rel = parts.slice(3).join("/");
    return rel ? `~/${rel}` : "~";
  }
  return p;
}

export function ProjectsPage() {
  const { agents } = useAgentsStore();
  const agentList = useMemo(() => Object.values(agents), [agents]);
  const location = useLocation();
  const navigationProjectPath = (location.state as { projectPath?: string } | null)?.projectPath ?? null;
  const navigationHandled = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(navigationProjectPath);
  const [selectedSubPath, setSelectedSubPath] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("agent-applet-favorites");
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });

  const toggleFavorite = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      localStorage.setItem("agent-applet-favorites", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const [sidebarPipelines, setSidebarPipelines] = useState<Map<string, PipelineData | null>>(new Map());

  const [showRootsPanel, setShowRootsPanel] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [newRoot, setNewRoot] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  const toggleGroup = useCallback((parent: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }, []);

  const loadProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => {
        setProjects(data);
        setSelectedPath((prev) => {
          if (prev) return prev;
          return data.length > 0 ? data[0].path : null;
        });
        if (!navigationHandled.current && navigationProjectPath) {
          navigationHandled.current = true;
          const found = data.find((p) => p.path === navigationProjectPath);
          if (found) {
            const parent = found.path.split("/").slice(0, -1).join("/") || "/";
            setCollapsedGroups((prev) => {
              const next = new Set(prev);
              next.delete(parent);
              return next;
            });
          }
        }
      })
      .catch(() => {/* ignore */});
  }, [navigationProjectPath]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const loadConfig = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (projects.length === 0) return;

    const fetchAll = () => {
      Promise.allSettled(
        projects.map((p) =>
          fetch(`/api/projects/${encodePath(p.path)}/pipeline`)
            .then((r) => r.json() as Promise<PipelineData | null>)
            .then((data) => ({ path: p.path, data }))
            .catch(() => ({ path: p.path, data: null }))
        )
      ).then((results) => {
        setSidebarPipelines((prev) => {
          const next = new Map(prev);
          for (const r of results) {
            if (r.status === "fulfilled") next.set(r.value.path, r.value.data);
          }
          return next;
        });
      });
    };

    fetchAll();
    const timer = setInterval(fetchAll, 10000);
    return () => clearInterval(timer);
  }, [projects]);

  const handleRemoveRoot = useCallback(async (root: string) => {
    if (!config) return;
    const next: Config = { projectRoots: config.projectRoots.filter((r) => r !== root) };
    setSavingConfig(true);
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setConfig(next);
      loadProjects();
    } catch {/* ignore */} finally {
      setSavingConfig(false);
    }
  }, [config, loadProjects]);

  const handleAddRoot = useCallback(async () => {
    if (!config || !newRoot.trim()) return;
    const trimmed = newRoot.trim();
    if (config.projectRoots.includes(trimmed)) return;
    const next: Config = { projectRoots: [...config.projectRoots, trimmed] };
    setSavingConfig(true);
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setConfig(next);
      setNewRoot("");
      loadProjects();
    } catch {/* ignore */} finally {
      setSavingConfig(false);
    }
  }, [config, newRoot, loadProjects]);

  const selected = projects.find((p) => p.path === selectedPath) ?? null;
  const selectedSub = selected?.subProjects?.find((sp) => sp.path === selectedSubPath) ?? null;

  const groupedProjects = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const p of projects) {
      const parent = p.path.split("/").slice(0, -1).join("/") || "/";
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent)!.push(p);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [projects]);

  function projectCounts(projectPath: string) {
    const projectAgents = agentList.filter((a) => a.project_root === projectPath);
    return {
      needs: projectAgents.filter((a) => NEEDS_INPUT_STATES.has(a.state)).length,
      working: projectAgents.filter((a) => WORKING_STATES.has(a.state)).length,
    };
  }

  const selectedAgents = useMemo(
    () => selected ? agentList.filter((a) => a.project_root === selected.path) : [],
    [agentList, selected]
  );

  const favoriteProjects = useMemo(
    () => projects.filter((p) => favorites.has(p.path)),
    [projects, favorites]
  );

  const activeProjects = useMemo(
    () => projects.filter((p) =>
      agentList.some(
        (a) => a.project_root === p.path &&
          (WORKING_STATES.has(a.state) || NEEDS_INPUT_STATES.has(a.state))
      )
    ),
    [projects, agentList]
  );

  function renderProjectRow(p: Project) {
    const counts = projectCounts(p.path);
    return (
      <div key={p.path}>
        <button
          className={`pm-row ${p.path === selectedPath && !selectedSubPath ? "active" : ""}`}
          onClick={() => { setSelectedPath(p.path); setSelectedSubPath(null); }}
        >
          <span className="pm-mark" style={{ background: projectColor(p.path) }} />
          <span className="pm-name">{p.name}</span>
          <span className="pm-counts">
            {counts.needs > 0 && (
              <span className="pm-pip pm-pip-needs" title="Needs input">{counts.needs}</span>
            )}
            {counts.working > 0 && (
              <span className="pm-pip pm-pip-working" title="Working">{counts.working}</span>
            )}
            {p.hasBacklog && (
              <span className="pm-pip pm-pip-backlog" title="Backlog">BL</span>
            )}
            {(() => {
              const pip = sidebarPipelines.get(p.path);
              if (!pip) return null;
              return (
                <span
                  className="pm-pip pm-pip-pipeline"
                  style={{ background: pipelineColor(pip.status) }}
                  title={`Pipeline: ${pip.status}`}
                />
              );
            })()}
          </span>
        </button>
        {p.subProjects?.map((sp) => (
          <button
            key={sp.path}
            className={`pm-row pm-row-sub ${selectedSubPath === sp.path ? "active" : ""}`}
            onClick={() => { setSelectedPath(p.path); setSelectedSubPath(sp.path); }}
          >
            <span className="pm-sub-indent" />
            <span className="pm-name">{sp.name}</span>
            <span className="pm-pip pm-pip-backlog" title="Backlog">BL</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="projects-page">
      <aside className="projects-master">
        <div className="projects-master-head">
          Projects <span className="section-count">{projects.length}</span>
        </div>

        <div className="projects-master-list">
          {favoriteProjects.length > 0 && (
            <div className="pm-section">
              <div className="pm-section-head">Favorites</div>
              {favoriteProjects.map((p) => renderProjectRow(p))}
            </div>
          )}

          {activeProjects.length > 0 && (
            <div className="pm-section">
              <div className="pm-section-head">Active</div>
              {activeProjects.map((p) => renderProjectRow(p))}
            </div>
          )}

          <div className="pm-section">
            <div className="pm-section-head pm-section-head-row">
              All Projects
              <button
                className={`pm-settings-btn ${showRootsPanel ? "active" : ""}`}
                onClick={() => setShowRootsPanel((v) => !v)}
                aria-label="Project roots settings"
                title="Project roots"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>

            {showRootsPanel && config && (
              <div className="pm-roots-panel">
                <div className="pd-roots-list">
                  {config.projectRoots.map((root) => (
                    <div key={root} className="pd-root-row">
                      <code className="pd-root-path">{root}</code>
                      <button
                        className="pd-root-remove"
                        onClick={() => handleRemoveRoot(root)}
                        disabled={savingConfig}
                        aria-label={`Remove ${root}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {config.projectRoots.length === 0 && (
                    <div className="empty-state" style={{ padding: "4px 0" }}>No roots configured.</div>
                  )}
                </div>
                <div className="pd-roots-add">
                  <input
                    className="field-input pd-roots-input"
                    value={newRoot}
                    onChange={(e) => setNewRoot(e.target.value)}
                    placeholder="/home/user/code"
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddRoot(); }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddRoot}
                    disabled={savingConfig || !newRoot.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {groupedProjects.map(([parent, groupProjects]) => {
              const collapsed = collapsedGroups.has(parent);
              return (
                <div key={parent} className="pm-group">
                  {groupedProjects.length > 1 && (
                    <button
                      className="pm-group-head"
                      title={parent}
                      onClick={() => toggleGroup(parent)}
                    >
                      <span className={`pm-group-arrow ${collapsed ? "collapsed" : ""}`}>▾</span>
                      {toTildePath(parent)}
                    </button>
                  )}
                  {!collapsed && groupProjects.map((p) => renderProjectRow(p))}
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="pm-empty">No projects found.</div>
            )}
          </div>
        </div>
      </aside>

      <section className="projects-detail">
        {selectedSub ? (
          <SubProjectDetail
            key={selectedSub.path}
            subProject={selectedSub}
            rootProjectPath={selected!.path}
          />
        ) : selected ? (
          <ProjectDetail
            key={selected.path}
            project={selected}
            agents={selectedAgents}
            isFavorite={favorites.has(selected.path)}
            onToggleFavorite={() => toggleFavorite(selected.path)}
            onOpenAgent={(a) => setOpenAgent(a)}
          />
        ) : (
          <div className="pd-placeholder">Select a project to view details.</div>
        )}
      </section>

      {openAgent && (
        <AgentTerminalModal
          agent={openAgent}
          onClose={() => setOpenAgent(null)}
        />
      )}
    </div>
  );
}
