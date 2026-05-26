import { useState, useEffect, useCallback, useMemo } from "react";
import { useAgentsStore, stateColor, stateLabel } from "../store/agents";
import type { Agent } from "../store/agents";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface Project {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasMcpJson: boolean;
  hasSkills: boolean;
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
  provider: "gitlab";
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
// AgentTerminalModal (inline, matches AgentsPage version)
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
  onOpenAgent: (agent: Agent) => void;
}

function ProjectDetail({ project, agents, onOpenAgent }: ProjectDetailProps) {
  const encoded = encodePath(project.path);
  const color = projectColor(project.path);

  // CLAUDE.md state
  const [claudeMd, setClaudeMd] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);

  // Pipeline state
  const [pipeline, setPipeline] = useState<PipelineData | null | undefined>(undefined);

  // Load CLAUDE.md
  useEffect(() => {
    setClaudeMd(null);
    setEditMode(false);
    fetch(`/api/projects/${encoded}/claude-md`)
      .then((r) => r.json())
      .then((data: { content: string }) => setClaudeMd(data.content))
      .catch(() => setClaudeMd(""));
  }, [encoded]);

  // Load skills
  useEffect(() => {
    setSkills([]);
    if (!project.hasSkills) return;
    fetch(`/api/projects/${encoded}/skills`)
      .then((r) => r.json())
      .then((data: Skill[]) => setSkills(data))
      .catch(() => setSkills([]));
  }, [encoded, project.hasSkills]);

  // Load pipeline with adaptive polling
  useEffect(() => {
    setPipeline(undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchPipeline = () => {
      fetch(`/api/projects/${encoded}/pipeline`)
        .then((r) => r.json())
        .then((data: PipelineData | null) => {
          setPipeline(data);
          // Poll faster for active pipelines
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

  const handleEditCancel = useCallback(() => {
    setEditMode(false);
  }, []);

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
      {/* Header */}
      <header className="pd-head">
        <div className="pd-mark" style={{ background: color }} />
        <div className="pd-meta">
          <h2 className="pd-name">{project.name}</h2>
          <div className="pd-path"><code>{project.path}</code></div>
          <div className="pd-flags">
            {project.hasClaudeMd && <span className="pd-flag">CLAUDE.md</span>}
            {project.hasMcpJson && <span className="pd-flag">MCP</span>}
            {project.hasSkills && <span className="pd-flag">Skills</span>}
          </div>
        </div>
      </header>

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
                <span
                  className="pd-agent-dot"
                  style={{ background: stateColor(a.state) }}
                />
                <div className="pd-agent-body">
                  <div className="pd-agent-title">{sessionTitle(a)}</div>
                  <div className="pd-agent-sub">{stateLabel(a.state)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

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

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Sidebar pipeline badges: Map of projectPath → PipelineData | null
  const [sidebarPipelines, setSidebarPipelines] = useState<Map<string, PipelineData | null>>(new Map());

  // Config / project roots
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
        if (data.length > 0 && !selectedPath) {
          setSelectedPath(data[0].path);
        }
      })
      .catch(() => {/* ignore */});
  }, [selectedPath]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const loadConfig = useCallback(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Sidebar pipeline badges — fetch all projects every 10s
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
            if (r.status === "fulfilled") {
              next.set(r.value.path, r.value.data);
            }
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

  // Group projects by parent directory
  const groupedProjects = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const p of projects) {
      const parent = p.path.split("/").slice(0, -1).join("/") || "/";
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent)!.push(p);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [projects]);

  // Per-project agent counts
  function projectCounts(projectPath: string) {
    const projectAgents = agentList.filter((a) => a.project_root === projectPath);
    return {
      needs: projectAgents.filter((a) => NEEDS_INPUT_STATES.has(a.state)).length,
      working: projectAgents.filter((a) => WORKING_STATES.has(a.state)).length,
    };
  }

  // Agents for selected project
  const selectedAgents = useMemo(
    () => selected ? agentList.filter((a) => a.project_root === selected.path) : [],
    [agentList, selected]
  );

  return (
    <div className="projects-page">
      {/* Left panel */}
      <aside className="projects-master">
        <div className="projects-master-head">
          Projects <span className="section-count">{projects.length}</span>
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
            <div className="pm-roots-panel-title">Project roots</div>
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

        <div className="projects-master-list">
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
                {!collapsed && groupProjects.map((p) => {
                  const counts = projectCounts(p.path);
                  return (
                    <button
                      key={p.path}
                      className={`pm-row ${p.path === selectedPath ? "active" : ""}`}
                      onClick={() => setSelectedPath(p.path)}
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
                  );
                })}
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="pm-empty">No projects found.</div>
          )}
        </div>
      </aside>

      {/* Right panel */}
      <section className="projects-detail">
        {selected ? (
          <ProjectDetail
            key={selected.path}
            project={selected}
            agents={selectedAgents}
            onOpenAgent={(a) => setOpenAgent(a)}
          />
        ) : (
          <div className="pd-placeholder">Select a project to view details.</div>
        )}
      </section>

      {/* Agent modal */}
      {openAgent && (
        <AgentTerminalModal
          agent={openAgent}
          onClose={() => setOpenAgent(null)}
        />
      )}
    </div>
  );
}
