import { useState, useEffect, useCallback } from "react";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface RunRow {
  id: number;
  schedule_id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  output: string | null;
}

interface Schedule {
  id: number;
  name: string;
  project_path: string;
  prompt: string;
  cron: string;
  type: "interactive" | "headless";
  enabled: boolean;
  created_at: string;
  last_run: RunRow | null;
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

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultTime(): string {
  return "02:30";
}

// ----------------------------------------------------------------
// RunDetailModal
// ----------------------------------------------------------------

interface RunDetailModalProps {
  schedule: Schedule;
  run: RunRow;
  onClose: () => void;
  onRerun: () => void;
}

function RunDetailModal({ schedule, run, onClose, onRerun }: RunDetailModalProps) {
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
          <div className="modal-title">{schedule.name}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-meta">
            <span className="modal-meta-k">Project</span>
            <span className="modal-meta-v" style={{ color: projectColor(schedule.project_path) }}>
              {projectBasename(schedule.project_path)}
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
            <pre className="run-io-box">{schedule.prompt}</pre>
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
// SchedulerModal
// ----------------------------------------------------------------

interface SchedulerModalProps {
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}

function SchedulerModal({ projects, onClose, onCreated }: SchedulerModalProps) {
  const [projectPath, setProjectPath] = useState(projects[0]?.path ?? "");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [whenDate, setWhenDate] = useState(defaultDate);
  const [whenTime, setWhenTime] = useState(defaultTime);
  const [recurrence, setRecurrence] = useState("once");
  const [type, setType] = useState<"interactive" | "headless">("headless");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = prompt.trim().length > 0 && !submitting;

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
      const cron = buildCron(whenDate, whenTime, recurrence);
      const payload = {
        name: title.trim() || "Untitled",
        project_path: projectPath,
        prompt: prompt.trim(),
        cron,
        type,
        enabled: 1,
      };
      const resp = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `HTTP ${resp.status}`);
        return;
      }
      onCreated();
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
          <div className="modal-title">Schedule a new agent</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Project</label>
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
            </div>

            <div className="field-row">
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
              <div className="field">
                <label className="field-label">Type</label>
                <select
                  className="field-select"
                  value={type}
                  onChange={(e) => setType(e.target.value as "interactive" | "headless")}
                >
                  <option value="headless">Headless</option>
                  <option value="interactive">Interactive (Ghostty)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// ScheduleCard
// ----------------------------------------------------------------

interface ScheduleCardProps {
  schedule: Schedule;
  isOpen: boolean;
  onToggle: () => void;
  onOpenRun: (run: RunRow) => void;
  onToggleEnabled: (enabled: boolean) => void;
}

function ScheduleCard({ schedule, isOpen, onToggle, onOpenRun, onToggleEnabled }: ScheduleCardProps) {
  const color = projectColor(schedule.project_path);
  const basename = projectBasename(schedule.project_path);
  const lastRun = schedule.last_run;
  const lastRunMeta = lastRun ? runStatusMeta(lastRun.status) : null;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen || runsLoaded) return;
    fetch(`/api/schedules/${schedule.id}/runs`)
      .then((r) => r.json())
      .then((data: RunRow[]) => {
        setRuns(data);
        setRunsLoaded(true);
      })
      .catch(() => setRunsLoaded(true));
  }, [isOpen, runsLoaded, schedule.id]);

  function handleEnabledChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    onToggleEnabled(e.target.checked);
  }

  function handleEnabledClick(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <section className={`schedule-card ${isOpen ? "open" : ""}`}>
      <header className="schedule-header" onClick={onToggle}>
        <div className="schedule-bar" style={{ background: color }} />
        <div className="schedule-meta">
          <div className="schedule-title-row">
            <span className="schedule-name">{schedule.name}</span>
            <span className="schedule-badge">{schedule.type}</span>
            <label className="schedule-toggle" onClick={handleEnabledClick}>
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={handleEnabledChange}
              />
              <span className="schedule-toggle-label">
                {schedule.enabled ? "enabled" : "disabled"}
              </span>
            </label>
          </div>
          <div className="schedule-sub">
            <span style={{ color }}>{basename}</span>
            <span className="schedule-sep">·</span>
            <span className="schedule-cron">{schedule.cron}</span>
          </div>
        </div>
        <div className="schedule-last-run">
          {lastRunMeta ? (
            <>
              <span className="run-status-dot" style={{ background: lastRunMeta.color }} />
              <span style={{ color: lastRunMeta.color, fontSize: 12 }}>{lastRunMeta.label}</span>
            </>
          ) : (
            <span className="schedule-no-runs">No runs yet</span>
          )}
        </div>
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
            <pre className="run-io-box">{schedule.prompt}</pre>
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
              <div className="run-table">
                <div className="run-table-header">
                  <span className="rt-col-when">When</span>
                  <span className="rt-col-status">Status</span>
                  <span className="rt-col-dur">Duration</span>
                  <span className="rt-col-out">Output</span>
                </div>
                {runs.map((run) => {
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
                      <span className="rt-col-dur mono">{fmtDuration(run.started_at, run.finished_at)}</span>
                      <span className="rt-col-out">{truncate(firstLine(run.output), 64)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------
// SchedulesPage
// ----------------------------------------------------------------

export function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openRun, setOpenRun] = useState<{ schedule: Schedule; run: RunRow } | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);

  const loadSchedules = useCallback(() => {
    fetch("/api/schedules")
      .then((r) => r.json())
      .then((data: Schedule[]) => setSchedules(data))
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    loadSchedules();
    const t = setInterval(loadSchedules, 30_000);
    return () => clearInterval(t);
  }, [loadSchedules]);

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

  async function handleToggleEnabled(schedule: Schedule, enabled: boolean) {
    try {
      await fetch(`/api/schedules/${schedule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: schedule.name,
          project_path: schedule.project_path,
          prompt: schedule.prompt,
          cron: schedule.cron,
          type: schedule.type,
          enabled,
        }),
      });
      loadSchedules();
    } catch {/* ignore */}
  }

  async function handleRerun(scheduleId: number) {
    try {
      await fetch(`/api/schedules/${scheduleId}/run`, { method: "POST" });
      setOpenRun(null);
      loadSchedules();
    } catch {/* ignore */}
  }

  return (
    <div className="schedules-page">
      <div className="page-header">
        <h1>Scheduled agents</h1>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowScheduler(true)}>
          + New schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <p className="empty-state">No scheduled agents yet.</p>
      ) : (
        <div className="sv-list">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              isOpen={expanded.has(s.id)}
              onToggle={() => toggleExpand(s.id)}
              onOpenRun={(run) => setOpenRun({ schedule: s, run })}
              onToggleEnabled={(enabled) => handleToggleEnabled(s, enabled)}
            />
          ))}
        </div>
      )}

      {openRun && (
        <RunDetailModal
          schedule={openRun.schedule}
          run={openRun.run}
          onClose={() => setOpenRun(null)}
          onRerun={() => handleRerun(openRun.schedule.id)}
        />
      )}

      {showScheduler && (
        <SchedulerModal
          projects={projects}
          onClose={() => setShowScheduler(false)}
          onCreated={() => {
            setShowScheduler(false);
            loadSchedules();
          }}
        />
      )}
    </div>
  );
}
