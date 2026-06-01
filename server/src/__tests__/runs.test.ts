import Database from "better-sqlite3";
import { initDb, setTestDb } from "../db";
import { handleSessionStart, cleanupStaleRuns } from "../runs";

function setupDb(): Database.Database {
  const db = initDb(":memory:");
  // Insert a schedule for FK tests
  db.prepare(
    "INSERT INTO agents (id, name, project_path, prompt, cron, type, enabled) VALUES (1, 'sched', '/tmp', 'do it', '* * * * *', 'interactive', 1)"
  ).run();
  setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// AC #1 — SessionStart without agent_id creates manual run
// ---------------------------------------------------------------------------
describe("AC#1 — manual SessionStart creates runs record", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("creates a run with launch_type=manual and status=running", () => {
    handleSessionStart({ pid: "12345", session_id: "sess-001" });

    const row = db
      .prepare("SELECT * FROM runs WHERE session_id = 'sess-001'")
      .get() as Record<string, unknown>;

    expect(row).toBeDefined();
    expect(row["launch_type"]).toBe("manual");
    expect(row["status"]).toBe("running");
    expect(row["pid"]).toBe(12345);
    expect(row["session_id"]).toBe("sess-001");
    expect(row["agent_id"]).toBeNull();
  });

  test("stores terminal_type when provided", () => {
    handleSessionStart({ pid: "12345", session_id: "sess-002", terminal_type: "idea" });

    const row = db
      .prepare("SELECT terminal_type FROM runs WHERE session_id = 'sess-002'")
      .get() as { terminal_type: string };

    expect(row.terminal_type).toBe("idea");
  });

  test("creates run even without session_id", () => {
    handleSessionStart({ pid: "77777" });

    const row = db
      .prepare("SELECT * FROM runs WHERE pid = 77777")
      .get() as Record<string, unknown>;

    expect(row).toBeDefined();
    expect(row["launch_type"]).toBe("manual");
    expect(row["status"]).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// AC #2 — SessionStart with agent_id updates existing run (no duplicate)
// ---------------------------------------------------------------------------
describe("AC#2 — scheduled SessionStart updates existing run", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("updates existing run's pid and session_id without creating duplicate", () => {
    // Pre-create a run as the scheduler would (no pid/session_id yet)
    const { lastInsertRowid: runId } = db
      .prepare(
        "INSERT INTO runs (agent_id, started_at, status) VALUES (1, datetime('now'), 'running')"
      )
      .run();

    handleSessionStart({ pid: "55555", session_id: "sess-sched-1", agent_id: 1 });

    const rows = db.prepare("SELECT * FROM runs WHERE agent_id = 1").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row["id"]).toBe(runId);
    expect(row["pid"]).toBe(55555);
    expect(row["session_id"]).toBe("sess-sched-1");
    expect(row["status"]).toBe("running");
  });

  test("does not overwrite already-set pid or session_id (COALESCE)", () => {
    db.prepare(
      "INSERT INTO runs (agent_id, pid, session_id, started_at, status) VALUES (1, 44444, 'sess-existing', datetime('now'), 'running')"
    ).run();

    // Send again with different values — should be ignored (COALESCE)
    handleSessionStart({ pid: "99999", session_id: "sess-new", agent_id: 1 });

    const row = db
      .prepare("SELECT pid, session_id FROM runs WHERE agent_id = 1")
      .get() as { pid: number; session_id: string };

    // pid and session_id both already set — COALESCE keeps original values
    expect(row.pid).toBe(44444);
    expect(row.session_id).toBe("sess-existing");
  });
});

// ---------------------------------------------------------------------------
// AC #3 — Duplicate SessionStart (same session_id) is idempotent
// ---------------------------------------------------------------------------
describe("AC#3 — duplicate SessionStart is idempotent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("calling handleSessionStart twice with same session_id creates only one run", () => {
    handleSessionStart({ pid: "11111", session_id: "sess-dup" });
    handleSessionStart({ pid: "11111", session_id: "sess-dup" });

    const rows = db
      .prepare("SELECT * FROM runs WHERE session_id = 'sess-dup'")
      .all();

    expect(rows).toHaveLength(1);
  });

  test("idempotent even with different pid on second call", () => {
    handleSessionStart({ pid: "11111", session_id: "sess-dup2" });
    handleSessionStart({ pid: "22222", session_id: "sess-dup2" });

    const rows = db
      .prepare("SELECT * FROM runs WHERE session_id = 'sess-dup2'")
      .all();

    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC #4 — PID reuse: new session on PID of open run closes old as cancelled
// ---------------------------------------------------------------------------
describe("AC#4 — PID reuse closes old run as cancelled", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("new session on same PID with different session_id cancels old run", () => {
    handleSessionStart({ pid: "33333", session_id: "sess-old" });

    const oldRow = db
      .prepare("SELECT id, status FROM runs WHERE session_id = 'sess-old'")
      .get() as { id: number; status: string };
    expect(oldRow.status).toBe("running");

    // New session reuses same PID
    handleSessionStart({ pid: "33333", session_id: "sess-new" });

    const updatedOld = db
      .prepare("SELECT status, finished_at FROM runs WHERE id = ?")
      .get(oldRow.id) as { status: string; finished_at: string | null };
    expect(updatedOld.status).toBe("cancelled");
    expect(updatedOld.finished_at).not.toBeNull();

    // New run should be created
    const newRow = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-new'")
      .get() as { status: string };
    expect(newRow.status).toBe("running");
  });

  test("total run count is 2 after PID reuse (old cancelled + new running)", () => {
    handleSessionStart({ pid: "44444", session_id: "sess-a" });
    handleSessionStart({ pid: "44444", session_id: "sess-b" });

    const rows = db.prepare("SELECT status FROM runs WHERE pid = 44444").all() as { status: string }[];
    expect(rows).toHaveLength(2);

    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(["cancelled", "running"]);
  });
});

// ---------------------------------------------------------------------------
// AC #5 — Server restart: dead PIDs from open runs marked as failed
// ---------------------------------------------------------------------------
describe("AC#5 — cleanupStaleRuns marks dead PIDs as failed", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("dead PID run is marked as failed", () => {
    // Insert a run with a PID that will be "dead"
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (98765, 'sess-dead', 'manual', datetime('now'), 'running')"
    ).run();

    // Mock process.kill to throw for PID 98765 (simulating dead process)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(process, "kill").mockImplementation((pid: any) => {
      if (pid === 98765) throw new Error("ESRCH");
      return true;
    });

    cleanupStaleRuns();

    const row = db
      .prepare("SELECT status, finished_at FROM runs WHERE session_id = 'sess-dead'")
      .get() as { status: string; finished_at: string | null };

    expect(row.status).toBe("failed");
    expect(row.finished_at).not.toBeNull();
  });

  test("alive PID run remains running", () => {
    db.prepare(
      "INSERT INTO runs (pid, session_id, launch_type, started_at, status) VALUES (12121, 'sess-alive', 'manual', datetime('now'), 'running')"
    ).run();

    // Mock process.kill to succeed for PID 12121 (alive)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(process, "kill").mockImplementation((() => true) as any);

    cleanupStaleRuns();

    const row = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-alive'")
      .get() as { status: string };

    expect(row.status).toBe("running");
  });

  test("runs without pid are not touched", () => {
    db.prepare(
      "INSERT INTO runs (session_id, launch_type, started_at, status) VALUES ('sess-nopid', 'manual', datetime('now'), 'running')"
    ).run();

    // Even if kill would throw, runs without pid should not be touched
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(process, "kill").mockImplementation((() => { throw new Error("ESRCH"); }) as any);

    cleanupStaleRuns();

    const row = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-nopid'")
      .get() as { status: string };

    expect(row.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// AC #7 — Concurrent sessions on different PIDs — no cross-contamination
// ---------------------------------------------------------------------------
describe("AC#7 — concurrent sessions on different PIDs do not interfere", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  test("two concurrent sessions on different PIDs are independent", () => {
    handleSessionStart({ pid: "10001", session_id: "sess-concurrent-a", terminal_type: "ghostty" });
    handleSessionStart({ pid: "10002", session_id: "sess-concurrent-b", terminal_type: "idea" });

    const rowA = db
      .prepare("SELECT * FROM runs WHERE session_id = 'sess-concurrent-a'")
      .get() as Record<string, unknown>;
    const rowB = db
      .prepare("SELECT * FROM runs WHERE session_id = 'sess-concurrent-b'")
      .get() as Record<string, unknown>;

    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();

    // No cross-contamination
    expect(rowA["pid"]).toBe(10001);
    expect(rowB["pid"]).toBe(10002);
    expect(rowA["terminal_type"]).toBe("ghostty");
    expect(rowB["terminal_type"]).toBe("idea");
    expect(rowA["status"]).toBe("running");
    expect(rowB["status"]).toBe("running");
  });

  test("cancelling one session does not affect the other", () => {
    handleSessionStart({ pid: "20001", session_id: "sess-x", terminal_type: "ghostty" });
    handleSessionStart({ pid: "20002", session_id: "sess-y", terminal_type: "idea" });

    // PID reuse on 20001 — sess-x should be cancelled
    handleSessionStart({ pid: "20001", session_id: "sess-z" });

    const rowX = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-x'")
      .get() as { status: string };
    const rowY = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-y'")
      .get() as { status: string };
    const rowZ = db
      .prepare("SELECT status FROM runs WHERE session_id = 'sess-z'")
      .get() as { status: string };

    expect(rowX.status).toBe("cancelled");
    expect(rowY.status).toBe("running"); // unaffected
    expect(rowZ.status).toBe("running");
  });
});
