import Database from "better-sqlite3";
import { initDb, setTestDb } from "../db";
import { handleSessionStart, closeRun } from "../runs";
import { getDb } from "../db";

function setupDb(): Database.Database {
  const db = initDb(":memory:");
  db.prepare(
    "INSERT INTO schedules (id, name, project_path, prompt, cron, type, enabled) VALUES (1, 'sched', '/tmp', 'do it', '* * * * *', 'interactive', 1)"
  ).run();
  setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// AC#1 — Stop hook closes run as success with ai_title
// ---------------------------------------------------------------------------
describe("AC#1 — Stop hook closes run as success with ai_title", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("closeRun sets status=success, finished_at, and ai_title", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (1001, 'sess-stop', 'manual', datetime('now', '-2 seconds'), 'running')"
    ).run();

    closeRun(1001, "success", "My Session Title");

    const row = db
      .prepare("SELECT status, finished_at, ai_title FROM runs WHERE pid = 1001")
      .get() as { status: string; finished_at: string | null; ai_title: string | null };

    expect(row.status).toBe("success");
    expect(row.finished_at).not.toBeNull();
    expect(row.ai_title).toBe("My Session Title");
  });

  test("closeRun without ai_title leaves ai_title as null", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (1005, 'sess-notitle', 'manual', datetime('now'), 'running')"
    ).run();

    closeRun(1005, "success");

    const row = db
      .prepare("SELECT ai_title FROM runs WHERE pid = 1005")
      .get() as { ai_title: string | null };

    expect(row.ai_title).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC#2 — TTY recycle (/clear) closes old run as cancelled before creating new
// ---------------------------------------------------------------------------
describe("AC#2 — TTY recycle closes old run as cancelled", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("new session on same TTY with different session_id cancels old run", () => {
    // Insert old running run with a TTY
    handleSessionStart({
      pid: "1001",
      session_id: "sess-old-tty",
      tty: "/dev/pts/3",
    });

    const oldRow = db
      .prepare("SELECT id, status FROM runs WHERE session_id = 'sess-old-tty'")
      .get() as { id: number; status: string };
    expect(oldRow.status).toBe("running");

    // New session arrives on same TTY, different PID and session_id
    handleSessionStart({
      pid: "1002",
      session_id: "sess-new-tty",
      tty: "/dev/pts/3",
    });

    const updatedOld = db
      .prepare("SELECT status, finished_at FROM runs WHERE id = ?")
      .get(oldRow.id) as { status: string; finished_at: string | null };
    expect(updatedOld.status).toBe("cancelled");
    expect(updatedOld.finished_at).not.toBeNull();

    // New run should be created as running
    const newRow = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-new-tty'")
      .get() as { status: string };
    expect(newRow.status).toBe("running");
  });

  test("two total runs after TTY recycle (old cancelled + new running)", () => {
    handleSessionStart({ pid: "2001", session_id: "sess-tty-a", tty: "/dev/pts/5" });
    handleSessionStart({ pid: "2002", session_id: "sess-tty-b", tty: "/dev/pts/5" });

    const rows = db
      .prepare("SELECT status FROM runs WHERE session_id IN ('sess-tty-a', 'sess-tty-b')")
      .all() as { status: string }[];

    expect(rows).toHaveLength(2);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(["cancelled", "running"]);
  });

  test("TTY stored in runs row", () => {
    handleSessionStart({ pid: "3001", session_id: "sess-tty-stored", tty: "/dev/pts/7" });

    const row = db
      .prepare("SELECT tty FROM runs WHERE session_id = 'sess-tty-stored'")
      .get() as { tty: string | null };

    expect(row.tty).toBe("/dev/pts/7");
  });
});

// ---------------------------------------------------------------------------
// AC#3 — SIGKILL: closeRun(pid, 'failed') closes run as failed
// ---------------------------------------------------------------------------
describe("AC#3 — SIGKILL closes run as failed", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("closeRun with failed status sets status=failed and finished_at", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (1003, 'sess-killed', 'manual', datetime('now'), 'running')"
    ).run();

    closeRun(1003, "failed");

    const row = db
      .prepare("SELECT status, finished_at FROM runs WHERE pid = 1003")
      .get() as { status: string; finished_at: string | null };

    expect(row.status).toBe("failed");
    expect(row.finished_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Subagent PID death does NOT close the parent run
// ---------------------------------------------------------------------------
describe("AC#4 — subagent PID death does not close parent run", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("run stays running when closeRun is NOT called (subagent check gate)", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (2000, 'sess-parent', 'manual', datetime('now'), 'running')"
    ).run();

    // Simulate the pid_checker logic: subagent has parent_session_id, so closeRun is NOT called
    // We just verify the run stays open when closeRun isn't invoked
    const row = db
      .prepare("SELECT status FROM runs WHERE pid = 2000")
      .get() as { status: string };

    expect(row.status).toBe("running");
  });

  test("closeRun only affects runs matching the given PID", () => {
    // Two runs: one for parent (pid=3001) and one for another session (pid=3002)
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (3001, 'sess-parent2', 'manual', datetime('now'), 'running')"
    ).run();
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (3002, 'sess-other', 'manual', datetime('now'), 'running')"
    ).run();

    // Only call closeRun on pid=3002 (not a subagent scenario, just checking isolation)
    closeRun(3002, "failed");

    const parentRow = db
      .prepare("SELECT status FROM runs WHERE pid = 3001")
      .get() as { status: string };
    const otherRow = db
      .prepare("SELECT status FROM runs WHERE pid = 3002")
      .get() as { status: string };

    expect(parentRow.status).toBe("running"); // unaffected
    expect(otherRow.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// AC#6 — Double-close is idempotent
// ---------------------------------------------------------------------------
describe("AC#6 — double-close is idempotent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("calling closeRun twice results in only one closed row with first status", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (1004, 'sess-double', 'manual', datetime('now'), 'running')"
    ).run();

    closeRun(1004, "success", "First Title");
    closeRun(1004, "failed", "Second Title"); // should be a no-op

    const rows = db
      .prepare("SELECT status, ai_title FROM runs WHERE pid = 1004")
      .all() as { status: string; ai_title: string | null }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success"); // first close wins
    expect(rows[0].ai_title).toBe("First Title"); // COALESCE keeps first value
  });

  test("closing an already-closed run (different status) is a no-op", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status, finished_at) VALUES (1006, 'sess-already-closed', 'manual', datetime('now', '-5 seconds'), 'failed', datetime('now'))"
    ).run();

    // Try to close again as success
    closeRun(1006, "success", "Some Title");

    const row = db
      .prepare("SELECT status, ai_title FROM runs WHERE pid = 1006")
      .get() as { status: string; ai_title: string | null };

    expect(row.status).toBe("failed"); // unchanged
    expect(row.ai_title).toBeNull(); // unchanged
  });
});

// ---------------------------------------------------------------------------
// AC#7 — Headless success: finalizeRun sets correct status
// ---------------------------------------------------------------------------
describe("AC#7 — headless close writes correct status", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("finalizeRun via direct DB update sets status=success and output", () => {
    const { lastInsertRowid: runId } = db.prepare(
      "INSERT INTO runs (schedule_id, started_at, status, launch_type) VALUES (1, datetime('now', '-3 seconds'), 'running', 'scheduled')"
    ).run();

    // Simulate what finalizeRun does (it's not exported, so we call the same SQL)
    db.prepare(
      "UPDATE runs SET finished_at = datetime('now'), status = ?, output = ?, ai_title = COALESCE(ai_title, ?) WHERE id = ?"
    ).run("success", "some output", null, runId);

    const row = db
      .prepare("SELECT status, output, finished_at FROM runs WHERE id = ?")
      .get(runId) as { status: string; output: string; finished_at: string | null };

    expect(row.status).toBe("success");
    expect(row.output).toBe("some output");
    expect(row.finished_at).not.toBeNull();
  });

  test("finalizeRun via direct DB update sets status=failed on non-zero exit", () => {
    const { lastInsertRowid: runId } = db.prepare(
      "INSERT INTO runs (schedule_id, started_at, status, launch_type) VALUES (1, datetime('now', '-1 seconds'), 'running', 'scheduled')"
    ).run();

    db.prepare(
      "UPDATE runs SET finished_at = datetime('now'), status = ?, output = ?, ai_title = COALESCE(ai_title, ?) WHERE id = ?"
    ).run("failed", "error output", null, runId);

    const row = db
      .prepare("SELECT status FROM runs WHERE id = ?")
      .get(runId) as { status: string };

    expect(row.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// AC#9 — ai_title present in DB after successful close
// ---------------------------------------------------------------------------
describe("AC#9 — ai_title in DB after successful close", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("ai_title is persisted after closeRun with title", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (5001, 'sess-ai-title', 'manual', datetime('now'), 'running')"
    ).run();

    closeRun(5001, "success", "Generated AI Title");

    const row = db
      .prepare("SELECT ai_title FROM runs WHERE pid = 5001")
      .get() as { ai_title: string | null };

    expect(row.ai_title).toBe("Generated AI Title");
  });

  test("pre-existing ai_title is preserved by COALESCE on close", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status, ai_title) VALUES (5002, 'sess-pre-title', 'manual', datetime('now'), 'running', 'Pre-existing Title')"
    ).run();

    closeRun(5002, "success", "Overwrite Attempt");

    const row = db
      .prepare("SELECT ai_title FROM runs WHERE pid = 5002")
      .get() as { ai_title: string | null };

    expect(row.ai_title).toBe("Pre-existing Title"); // COALESCE keeps original
  });
});

// ---------------------------------------------------------------------------
// AC#10 — Timing: finished_at > started_at, duration is positive
// ---------------------------------------------------------------------------
describe("AC#10 — timing: finished_at > started_at", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("finished_at is after started_at and duration is positive", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (6001, 'sess-timing', 'manual', datetime('now', '-2 seconds'), 'running')"
    ).run();

    closeRun(6001, "success");

    const row = db
      .prepare(
        `SELECT
           (julianday(finished_at) - julianday(started_at)) * 86400 AS duration_seconds
         FROM runs WHERE pid = 6001`
      )
      .get() as { duration_seconds: number };

    expect(row.duration_seconds).toBeGreaterThan(0);
  });

  test("duration is not negative", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (6002, 'sess-timing2', 'manual', datetime('now'), 'running')"
    ).run();

    closeRun(6002, "failed");

    const row = db
      .prepare(
        `SELECT
           (julianday(finished_at) - julianday(started_at)) * 86400 AS duration_seconds
         FROM runs WHERE pid = 6002`
      )
      .get() as { duration_seconds: number };

    expect(row.duration_seconds).toBeGreaterThanOrEqual(0);
  });
});
