import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface Run {
  id: number;
  agent_id: number | null;
  pid: number | null;
  session_id: string | null;
  project_root: string | null;
  launch_type: string | null;
  terminal_type: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string | null;
  ai_title: string | null;
  agent_name: string | null;
}

interface RunsResponse {
  runs: Run[];
  total: number;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function formatDuration(ms: number | null, startedAt: string): string {
  if (ms === null) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    return formatMs(elapsed);
  }
  return formatMs(ms);
}

function statusBadge(status: string | null): { label: string; color: string; bgColor: string } {
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

function typeLabel(run: Run): string {
  if (run.launch_type === "scheduled") return "scheduled";
  if (run.launch_type === "manual_trigger") return "manual/trigger";
  if (run.terminal_type) return `manual/${run.terminal_type}`;
  return run.launch_type ?? "unknown";
}

function projectName(projectRoot: string | null): string {
  if (!projectRoot) return "—";
  return projectRoot.split("/").filter(Boolean).pop() ?? projectRoot;
}

function formatStarted(startedAt: string): string {
  const d = new Date(startedAt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday)
    return `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString();
}

// ----------------------------------------------------------------
// RunsPage
// ----------------------------------------------------------------

export function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [projectFilter, setProjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(0);
  const limit = 20;

  // fetch on filter/page change
  useEffect(() => {
    const params = new URLSearchParams();
    if (projectFilter) params.set("project", projectFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    fetch(`/api/runs?${params}`)
      .then((r) => r.json())
      .then((data: RunsResponse) => {
        setRuns(data.runs);
        setTotal(data.total);
      })
      .catch(console.error);
  }, [projectFilter, typeFilter, statusFilter, since, until, page]);

  // live duration tick for running sessions
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const pageCount = Math.ceil(total / limit);

  return (
    <div className="page-content" style={{ padding: "16px 24px" }}>
      <div className="page-header">
        <h1>Run history</h1>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Filter by project..."
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setPage(0);
          }}
          data-testid="filter-project"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          data-testid="filter-type"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        >
          <option value="">All types</option>
          <option value="scheduled">Scheduled</option>
          <option value="manual">Manual</option>
          <option value="manual_trigger">Manual trigger</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          data-testid="filter-status"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          type="date"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
            setPage(0);
          }}
          data-testid="filter-since"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <input
          type="date"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setPage(0);
          }}
          data-testid="filter-until"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        />
      </div>

      {/* Table */}
      {runs.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          No runs match the current filters.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e1e4e8", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>PROJECT</th>
              <th style={{ padding: "6px 8px" }}>TYPE</th>
              <th style={{ padding: "6px 8px" }}>STARTED</th>
              <th style={{ padding: "6px 8px" }}>DURATION</th>
              <th style={{ padding: "6px 8px" }}>STATUS</th>
              <th style={{ padding: "6px 8px" }}>TITLE</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const badge = statusBadge(run.status);
              const durDisplay =
                run.status === "running"
                  ? formatDuration(null, run.started_at)
                  : run.duration_ms !== null
                  ? formatDuration(run.duration_ms, run.started_at)
                  : "—";
              // tick is used to force re-render for running durations
              void tick;
              return (
                <tr
                  key={run.id}
                  style={{ borderBottom: "1px solid #e1e4e8" }}
                >
                  <td style={{ padding: "6px 8px" }}>
                    <span
                      style={{ cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => {
                        setProjectFilter(projectName(run.project_root));
                        setPage(0);
                      }}
                      data-testid={`project-link-${run.id}`}
                    >
                      {projectName(run.project_root)}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {run.launch_type === "scheduled" && run.agent_id ? (
                      <Link
                        to="/agents"
                        data-testid={`agent-link-${run.id}`}
                      >
                        {typeLabel(run)}
                      </Link>
                    ) : (
                      typeLabel(run)
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{formatStarted(run.started_at)}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>
                    {durDisplay}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span
                      style={{
                        color: badge.color,
                        backgroundColor: badge.bgColor,
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      data-testid={`status-badge-${run.id}`}
                    >
                      {badge.label} {run.status}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: "#57606a",
                      fontStyle: "italic",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {run.ai_title ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <button
          className="btn"
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 0}
          data-testid="prev-page"
        >
          ← prev
        </button>
        <span data-testid="page-info">
          Page {page + 1} of {Math.max(1, pageCount)}
        </span>
        <button
          className="btn"
          onClick={() => setPage((p) => p + 1)}
          disabled={(page + 1) * limit >= total}
          data-testid="next-page"
        >
          next →
        </button>
      </div>
    </div>
  );
}
