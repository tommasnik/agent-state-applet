import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

interface BacklogFile {
  name: string;
  content: string;
}

interface ParsedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  fileName: string;
  content: string;
}

function encodePath(p: string): string {
  return btoa(p).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!content.startsWith("---")) return result;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return result;
  const block = content.slice(3, end);
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

export function parseBacklogFiles(files: BacklogFile[]): ParsedTask[] {
  return files
    .map((f) => {
      const fm = parseFrontmatter(f.content);
      const status = (fm.status ?? "").toLowerCase();
      const priority = fm.priority ?? "";
      const idMatch = f.name.match(/TASK-\d+/i);
      const id = idMatch ? idMatch[0].toUpperCase() : f.name.replace(/\.md$/, "");
      const title = fm.title ?? f.name.replace(/\.md$/, "").replace(/^task-\d+\s*-?\s*/i, "");
      return { id, title, status, priority, fileName: f.name, content: f.content };
    })
    .filter((t) => !t.status.includes("done") && !t.status.includes("archive"));
}

// ----------------------------------------------------------------
// TaskDetailModal
// ----------------------------------------------------------------

interface TaskDetailModalProps {
  task: ParsedTask;
  actionRootPath: string;
  projectName: string;
  onClose: () => void;
}

function TaskDetailModal({ task, actionRootPath, projectName, onClose }: TaskDetailModalProps) {
  const [running, setRunning] = useState(false);
  const encodedRoot = encodePath(actionRootPath);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
    [onClose]
  );

  const handleImplement = useCallback(async () => {
    setRunning(true);
    try {
      await fetch(`/api/projects/${encodedRoot}/implement/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subProject: projectName }),
      });
      onClose();
    } catch {/* ignore */} finally {
      setRunning(false);
    }
  }, [task.id, encodedRoot, projectName, onClose]);

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <span className="task-modal-id">{task.id}</span>
            {" · "}
            {task.title}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body modal-body-md">
          <ReactMarkdown>{task.content}</ReactMarkdown>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Zrušit</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={handleImplement} disabled={running}>
            {running ? "Spouštím…" : "Spustit implementaci →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// BacklogSection
// ----------------------------------------------------------------

export interface BacklogSectionProps {
  backlogPath: string;
  actionRootPath: string;
  projectName: string;
}

export function BacklogSection({ backlogPath, actionRootPath, projectName }: BacklogSectionProps) {
  const encodedBacklog = encodePath(backlogPath);
  const encodedRoot = encodePath(actionRootPath);
  const [tasks, setTasks] = useState<ParsedTask[] | null>(null);
  const [selectedTask, setSelectedTask] = useState<ParsedTask | null>(null);

  useEffect(() => {
    setTasks(null);
    fetch(`/api/projects/${encodedBacklog}/backlog`)
      .then((r) => r.json())
      .then((data: { files: BacklogFile[] }) => setTasks(parseBacklogFiles(data.files)))
      .catch(() => setTasks([]));
  }, [encodedBacklog]);

  const handleImplementAll = useCallback(() => {
    fetch(`/api/projects/${encodedRoot}/implement-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subProject: projectName }),
    }).catch(() => {/* ignore */});
  }, [encodedRoot, projectName]);

  const handleImplementNext = useCallback(() => {
    fetch(`/api/projects/${encodedRoot}/implement-next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subProject: projectName }),
    }).catch(() => {/* ignore */});
  }, [encodedRoot, projectName]);

  return (
    <>
      <section className="pd-block">
        <div className="pd-block-head pd-block-head-row">
          <span>
            Backlog
            {tasks !== null && <span className="section-count">{tasks.length}</span>}
          </span>
          <div className="sp-actions">
            <button className="btn" onClick={handleImplementNext} title="Implementuj první To Do task">
              Next task
            </button>
            <button className="btn btn-primary" onClick={handleImplementAll} title="Implementuj všechny tasky">
              Implementuj vše
            </button>
          </div>
        </div>

        {tasks === null ? (
          <div className="empty-state">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">No open tasks found.</div>
        ) : (
          <div className="sp-task-table">
            <div className="sp-task-header">
              <span className="sp-task-col sp-task-col-id">ID</span>
              <span className="sp-task-col sp-task-col-title">Title</span>
              <span className="sp-task-col sp-task-col-prio">Priority</span>
              <span className="sp-task-col sp-task-col-status">Status</span>
              <span className="sp-task-col sp-task-col-action" />
            </div>
            {tasks.map((t) => (
              <div
                key={t.fileName}
                className="sp-task-row"
                onClick={() => setSelectedTask(t)}
              >
                <span className="sp-task-col sp-task-col-id">{t.id}</span>
                <span className="sp-task-col sp-task-col-title">{t.title}</span>
                <span className="sp-task-col sp-task-col-prio">{t.priority || "—"}</span>
                <span className="sp-task-col sp-task-col-status">{t.status || "—"}</span>
                <span className="sp-task-col sp-task-col-action">
                  <button
                    className="btn btn-xs"
                    onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }}
                  >
                    Run
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          actionRootPath={actionRootPath}
          projectName={projectName}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </>
  );
}
