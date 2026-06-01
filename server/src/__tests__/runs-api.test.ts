import request from "supertest";
import express from "express";
import Database from "better-sqlite3";
import { initDb, setTestDb } from "../db";
import runsRouter from "../routes/runs";

function setupApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api", runsRouter);
  return app;
}

function setupDb(): Database.Database {
  const db = initDb(":memory:");
  setTestDb(db);
  return db;
}

function insertSchedule(db: Database.Database, id = 1, name = "My Schedule"): void {
  db.prepare(
    "INSERT INTO agents (id, name, project_path, prompt, cron, type, enabled) VALUES (?, ?, '/tmp', 'do it', '* * * * *', 'interactive', 1)"
  ).run(id, name);
}

function insertRun(
  db: Database.Database,
  opts: {
    agent_id?: number | null;
    pid?: number | null;
    session_id?: string | null;
    project_root?: string | null;
    launch_type?: string | null;
    terminal_type?: string | null;
    started_at?: string;
    finished_at?: string | null;
    status?: string;
    ai_title?: string | null;
    tty?: string | null;
  } = {}
): number {
  const {
    agent_id = null,
    pid = null,
    session_id = null,
    project_root = null,
    launch_type = "manual",
    terminal_type = null,
    started_at = "2024-01-01 10:00:00",
    finished_at = null,
    status = "running",
    ai_title = null,
    tty = null,
  } = opts;

  const result = db.prepare(
    `INSERT INTO runs (agent_id, pid, session_id, project_root, launch_type, terminal_type,
       started_at, finished_at, status, ai_title, tty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(agent_id, pid, session_id, project_root, launch_type, terminal_type,
    started_at, finished_at, status, ai_title, tty);

  return result.lastInsertRowid as number;
}

// ---------------------------------------------------------------------------
// AC #1 — GET /api/runs with no filters returns all runs
// ---------------------------------------------------------------------------
describe("AC#1 — GET /api/runs returns all runs", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("returns all runs with total", async () => {
    insertRun(db, { session_id: "s1" });
    insertRun(db, { session_id: "s2" });
    insertRun(db, { session_id: "s3" });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(3);
    expect(res.body.total).toBe(3);
  });

  test("returns empty array when no runs", async () => {
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  test("response includes expected fields", async () => {
    insertRun(db, { session_id: "s1", launch_type: "manual", status: "running" });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    const run = res.body.runs[0];
    expect(run).toHaveProperty("id");
    expect(run).toHaveProperty("session_id", "s1");
    expect(run).toHaveProperty("launch_type", "manual");
    expect(run).toHaveProperty("status", "running");
    expect(run).toHaveProperty("duration_ms");
    expect(run).toHaveProperty("agent_name");
  });
});

// ---------------------------------------------------------------------------
// AC #2 & #7 — Filtering (individual params)
// ---------------------------------------------------------------------------
describe("AC#2 & #7 — individual filter params", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    insertSchedule(db, 1, "Weekly Report");
  });

  test("filter by project (prefix match)", async () => {
    insertRun(db, { project_root: "/home/tom/projects/alpha", session_id: "s1" });
    insertRun(db, { project_root: "/home/tom/projects/beta", session_id: "s2" });
    insertRun(db, { project_root: "/other/project", session_id: "s3" });

    const res = await request(app).get("/api/runs?project=/home/tom/projects");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.total).toBe(2);
    const sessionIds = res.body.runs.map((r: { session_id: string }) => r.session_id).sort();
    expect(sessionIds).toEqual(["s1", "s2"]);
  });

  test("filter by type=scheduled", async () => {
    insertRun(db, { launch_type: "scheduled", session_id: "s1" });
    insertRun(db, { launch_type: "manual", session_id: "s2" });
    insertRun(db, { launch_type: "manual_trigger", session_id: "s3" });

    const res = await request(app).get("/api/runs?type=scheduled");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s1");
    expect(res.body.total).toBe(1);
  });

  test("filter by type=manual", async () => {
    insertRun(db, { launch_type: "scheduled", session_id: "s1" });
    insertRun(db, { launch_type: "manual", session_id: "s2" });

    const res = await request(app).get("/api/runs?type=manual");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s2");
  });

  test("filter by status=running", async () => {
    insertRun(db, { status: "running", session_id: "s1" });
    insertRun(db, { status: "success", finished_at: "2024-01-01 11:00:00", session_id: "s2" });
    insertRun(db, { status: "failed", finished_at: "2024-01-01 11:00:00", session_id: "s3" });

    const res = await request(app).get("/api/runs?status=running");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s1");
    expect(res.body.total).toBe(1);
  });

  test("filter by status=success", async () => {
    insertRun(db, { status: "running", session_id: "s1" });
    insertRun(db, { status: "success", finished_at: "2024-01-01 11:00:00", session_id: "s2" });

    const res = await request(app).get("/api/runs?status=success");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s2");
  });

  test("filter by since", async () => {
    insertRun(db, { started_at: "2024-01-01 08:00:00", session_id: "s1" });
    insertRun(db, { started_at: "2024-01-01 12:00:00", session_id: "s2" });
    insertRun(db, { started_at: "2024-01-02 10:00:00", session_id: "s3" });

    const res = await request(app).get("/api/runs?since=2024-01-01 10:00:00");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    const sessionIds = res.body.runs.map((r: { session_id: string }) => r.session_id).sort();
    expect(sessionIds).toEqual(["s2", "s3"]);
    expect(res.body.total).toBe(2);
  });

  test("filter by until", async () => {
    insertRun(db, { started_at: "2024-01-01 08:00:00", session_id: "s1" });
    insertRun(db, { started_at: "2024-01-01 12:00:00", session_id: "s2" });
    insertRun(db, { started_at: "2024-01-02 10:00:00", session_id: "s3" });

    const res = await request(app).get("/api/runs?until=2024-01-01 12:00:00");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    const sessionIds = res.body.runs.map((r: { session_id: string }) => r.session_id).sort();
    expect(sessionIds).toEqual(["s1", "s2"]);
    expect(res.body.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC #3 & #9 — Pagination
// ---------------------------------------------------------------------------
describe("AC#3 & #9 — limit/offset pagination", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    // Insert 10 runs
    for (let i = 1; i <= 10; i++) {
      insertRun(db, { session_id: `s${i}`, started_at: `2024-01-${String(i).padStart(2, "0")} 10:00:00` });
    }
  });

  test("default limit=50 returns all 10 runs", async () => {
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(10);
    expect(res.body.total).toBe(10);
  });

  test("limit=3 returns 3 runs, total=10", async () => {
    const res = await request(app).get("/api/runs?limit=3");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(3);
    expect(res.body.total).toBe(10);
  });

  test("offset=5 skips first 5 runs", async () => {
    const res = await request(app).get("/api/runs?offset=5");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(5);
    expect(res.body.total).toBe(10);
  });

  test("limit=3&offset=3 returns second page", async () => {
    const page1 = await request(app).get("/api/runs?limit=3&offset=0");
    const page2 = await request(app).get("/api/runs?limit=3&offset=3");

    expect(page1.body.runs).toHaveLength(3);
    expect(page2.body.runs).toHaveLength(3);
    expect(page1.body.total).toBe(10);
    expect(page2.body.total).toBe(10);

    // Pages should be different
    const ids1 = page1.body.runs.map((r: { id: number }) => r.id);
    const ids2 = page2.body.runs.map((r: { id: number }) => r.id);
    expect(ids1).not.toEqual(ids2);
    // No overlap
    expect(ids1.filter((id: number) => ids2.includes(id))).toHaveLength(0);
  });

  test("limit is capped at 200", async () => {
    // Insert more runs to ensure cap is tested
    for (let i = 11; i <= 250; i++) {
      insertRun(db, { session_id: `s${i}` });
    }

    const res = await request(app).get("/api/runs?limit=500");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(200);
    expect(res.body.total).toBe(250);
  });

  test("offset beyond total returns empty runs but correct total", async () => {
    const res = await request(app).get("/api/runs?offset=100");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(0);
    expect(res.body.total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AC #4 — GET /api/runs/:id returns 404 for unknown id
// ---------------------------------------------------------------------------
describe("AC#4 — GET /api/runs/:id", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("returns 404 for unknown id", async () => {
    const res = await request(app).get("/api/runs/999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not found");
  });

  test("returns run for known id", async () => {
    const id = insertRun(db, { session_id: "s1", launch_type: "manual" });

    const res = await request(app).get(`/api/runs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.session_id).toBe("s1");
  });
});

// ---------------------------------------------------------------------------
// AC #5 — duration_ms is null for running, positive integer for finished
// ---------------------------------------------------------------------------
describe("AC#5 — duration_ms computation", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("duration_ms is null for running run (no finished_at)", async () => {
    insertRun(db, { started_at: "2024-01-01 10:00:00", finished_at: null, status: "running" });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs[0].duration_ms).toBeNull();
  });

  test("duration_ms is positive integer for finished run", async () => {
    insertRun(db, {
      started_at: "2024-01-01 10:00:00",
      finished_at: "2024-01-01 10:00:30",
      status: "success",
    });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    const run = res.body.runs[0];
    expect(run.duration_ms).not.toBeNull();
    expect(run.duration_ms).toBeGreaterThan(0);
    expect(Number.isInteger(run.duration_ms)).toBe(true);
    // 30 seconds = 30000 ms (allow ±1 for SQLite floating point rounding)
    expect(run.duration_ms).toBeGreaterThanOrEqual(29999);
    expect(run.duration_ms).toBeLessThanOrEqual(30001);
  });

  test("duration_ms via GET /api/runs/:id", async () => {
    const id = insertRun(db, {
      started_at: "2024-01-01 10:00:00",
      finished_at: "2024-01-01 10:01:00",
      status: "success",
    });

    const res = await request(app).get(`/api/runs/${id}`);
    expect(res.status).toBe(200);
    // 60 seconds = 60000 ms (allow ±1 for SQLite floating point rounding)
    expect(res.body.duration_ms).toBeGreaterThanOrEqual(59999);
    expect(res.body.duration_ms).toBeLessThanOrEqual(60001);
  });
});

// ---------------------------------------------------------------------------
// AC #6 — agent_name is joined correctly
// ---------------------------------------------------------------------------
describe("AC#6 — agent_name join", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("agent_name is null when no agent_id", async () => {
    insertRun(db, { agent_id: null, session_id: "s1" });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs[0].agent_name).toBeNull();
  });

  test("agent_name is joined from agents table", async () => {
    insertSchedule(db, 1, "Daily Sync");
    insertRun(db, { agent_id: 1, session_id: "s1" });

    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs[0].agent_name).toBe("Daily Sync");
  });

  test("agent_name via GET /api/runs/:id", async () => {
    insertSchedule(db, 2, "Weekly Report");
    const id = insertRun(db, { agent_id: 2, session_id: "s2" });

    const res = await request(app).get(`/api/runs/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.agent_name).toBe("Weekly Report");
  });
});

// ---------------------------------------------------------------------------
// AC #8 — Combined filters
// ---------------------------------------------------------------------------
describe("AC#8 — combined filters", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("project + status filter returns only matching runs", async () => {
    insertRun(db, { project_root: "/home/tom/alpha", status: "running", session_id: "s1" });
    insertRun(db, { project_root: "/home/tom/alpha", status: "success", finished_at: "2024-01-01 11:00:00", session_id: "s2" });
    insertRun(db, { project_root: "/home/tom/beta", status: "running", session_id: "s3" });

    const res = await request(app).get("/api/runs?project=/home/tom/alpha&status=running");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s1");
    expect(res.body.total).toBe(1);
  });

  test("type + since + until filter", async () => {
    insertRun(db, { launch_type: "manual", started_at: "2024-01-01 08:00:00", session_id: "s1" });
    insertRun(db, { launch_type: "manual", started_at: "2024-01-01 12:00:00", session_id: "s2" });
    insertRun(db, { launch_type: "manual", started_at: "2024-01-02 10:00:00", session_id: "s3" });
    insertRun(db, { launch_type: "scheduled", started_at: "2024-01-01 12:00:00", session_id: "s4" });

    const res = await request(app).get(
      "/api/runs?type=manual&since=2024-01-01 10:00:00&until=2024-01-01 23:59:59"
    );
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].session_id).toBe("s2");
    expect(res.body.total).toBe(1);
  });

  test("combined filters with pagination", async () => {
    for (let i = 1; i <= 5; i++) {
      insertRun(db, { project_root: "/home/tom/proj", status: "success", finished_at: "2024-01-01 11:00:00", session_id: `s${i}` });
    }
    insertRun(db, { project_root: "/other", status: "success", finished_at: "2024-01-01 11:00:00", session_id: "other" });

    const res = await request(app).get("/api/runs?project=/home/tom/proj&status=success&limit=2&offset=0");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.total).toBe(5); // total is count without pagination
  });
});

// ---------------------------------------------------------------------------
// AC #10 — Empty result returns {runs: [], total: 0}
// ---------------------------------------------------------------------------
describe("AC#10 — empty result", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = setupDb();
    app = setupApp();
  });

  test("no runs at all returns {runs: [], total: 0}", async () => {
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], total: 0 });
  });

  test("filter with no matches returns {runs: [], total: 0}", async () => {
    insertRun(db, { status: "running", session_id: "s1" });

    const res = await request(app).get("/api/runs?status=success");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], total: 0 });
  });

  test("project filter with no matches returns {runs: [], total: 0}", async () => {
    insertRun(db, { project_root: "/home/tom/alpha", session_id: "s1" });

    const res = await request(app).get("/api/runs?project=/nonexistent");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], total: 0 });
  });
});
