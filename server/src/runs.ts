import { getDb } from "./db";

export function handleSessionStart(payload: {
  pid: string;
  session_id?: string;
  schedule_id?: string | number;
  terminal_type?: string;
  project_root?: string;
}): void {
  const db = getDb();
  const pidNum = parseInt(payload.pid, 10);

  if (!payload.schedule_id) {
    // Manual session — check for duplicate first
    if (payload.session_id) {
      const existing = db
        .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
        .get(payload.session_id);
      if (existing) return; // idempotent — already created
    }

    // Check for PID reuse: close any open run on this PID with different session_id
    if (payload.session_id) {
      const oldRun = db
        .prepare(
          "SELECT id FROM runs WHERE pid = ? AND status = 'running' AND (session_id IS NULL OR session_id != ?)"
        )
        .get(pidNum, payload.session_id);
      if (oldRun) {
        db.prepare(
          "UPDATE runs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?"
        ).run((oldRun as { id: number }).id);
      }
    }

    // Create new manual run
    db.prepare(
      `INSERT INTO runs (pid, session_id, launch_type, terminal_type, started_at, status)
       VALUES (?, ?, 'manual', ?, datetime('now'), 'running')`
    ).run(pidNum, payload.session_id ?? null, payload.terminal_type ?? null);
  } else {
    // Scheduled session — update existing run's pid/session_id if missing
    db.prepare(
      `UPDATE runs SET
         pid = COALESCE(pid, ?),
         session_id = COALESCE(session_id, ?),
         terminal_type = COALESCE(terminal_type, ?)
       WHERE schedule_id = ? AND status = 'running' AND (pid IS NULL OR session_id IS NULL)`
    ).run(
      pidNum,
      payload.session_id ?? null,
      payload.terminal_type ?? null,
      Number(payload.schedule_id)
    );
  }
}

export function cleanupStaleRuns(): void {
  const db = getDb();
  const openRuns = db
    .prepare("SELECT id, pid FROM runs WHERE status = 'running' AND pid IS NOT NULL")
    .all() as { id: number; pid: number }[];

  for (const run of openRuns) {
    if (!isPidAlive(run.pid)) {
      db.prepare(
        "UPDATE runs SET status = 'failed', finished_at = datetime('now') WHERE id = ?"
      ).run(run.id);
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
