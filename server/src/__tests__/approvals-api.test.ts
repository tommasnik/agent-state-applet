import request from "supertest";
import express from "express";
import Database from "better-sqlite3";

// Mock ws broadcast so we can assert on emitted events without a real socket.
const mockBroadcast = jest.fn();
jest.mock("../ws", () => ({
  broadcast: (...args: unknown[]) => mockBroadcast(...args),
}));

import { initDb, setTestDb } from "../db";
import approvalsRouter from "../routes/approvals";

function setupApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/api", approvalsRouter);
  return app;
}

function setupDb(): Database.Database {
  const db = initDb(":memory:");
  setTestDb(db);
  return db;
}

function getColumnNames(db: Database.Database, table: string): string[] {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// AC #1 — approvals table exists and migration runs at startup
// ---------------------------------------------------------------------------
describe("AC#1 — approvals table migration", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
  });
  afterEach(() => db.close());

  it("creates the approvals table on init", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approvals'"
      )
      .get();
    expect(row).toBeTruthy();
  });

  it("has the expected columns", () => {
    const cols = getColumnNames(db, "approvals");
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "run_id",
        "session_id",
        "created_at",
        "status",
        "payload",
        "answer",
        "answered_at",
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// AC #2 — POST /api/approvals creates a pending item and returns id
// ---------------------------------------------------------------------------
describe("AC#2 — POST /api/approvals", () => {
  let db: Database.Database;
  let app: express.Application;
  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    mockBroadcast.mockClear();
  });
  afterEach(() => db.close());

  it("creates a pending item and returns its id", async () => {
    const payload = {
      action: "create_event",
      uncertainty: 0.7,
      sources: ["email-42"],
    };
    const res = await request(app)
      .post("/api/approvals")
      .send({ run_id: 5, session_id: "abc123", payload });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    expect(res.body.status).toBe("pending");
    expect(res.body.run_id).toBe(5);
    expect(res.body.session_id).toBe("abc123");
    expect(JSON.parse(res.body.payload)).toEqual(payload);

    const row = db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(res.body.id) as { status: string };
    expect(row.status).toBe("pending");
  });

  it("accepts a missing payload / run / session", async () => {
    const res = await request(app).post("/api/approvals").send({});
    expect(res.status).toBe(201);
    expect(res.body.run_id).toBeNull();
    expect(res.body.session_id).toBeNull();
    expect(res.body.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC #3 — GET returns pending, WebSocket pushes new
// ---------------------------------------------------------------------------
describe("AC#3 — GET /api/approvals + WebSocket push", () => {
  let db: Database.Database;
  let app: express.Application;
  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    mockBroadcast.mockClear();
  });
  afterEach(() => db.close());

  it("returns only pending items", async () => {
    await request(app).post("/api/approvals").send({ payload: { a: 1 } });
    const second = await request(app)
      .post("/api/approvals")
      .send({ payload: { b: 2 } });
    // dismiss the second one
    await request(app).post(`/api/approvals/${second.body.id}/dismiss`).send();

    const res = await request(app).get("/api/approvals");
    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0].status).toBe("pending");
  });

  it("pushes approval_pending over WebSocket on creation", async () => {
    const res = await request(app)
      .post("/api/approvals")
      .send({ payload: { x: 1 } });

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    const arg = mockBroadcast.mock.calls[0][0];
    expect(arg.event).toBe("approval_pending");
    expect(arg.approval.id).toBe(res.body.id);
    expect(arg.approval.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// AC #4 — answer stores answer and marks answered
// ---------------------------------------------------------------------------
describe("AC#4 — POST /api/approvals/:id/answer", () => {
  let db: Database.Database;
  let app: express.Application;
  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    mockBroadcast.mockClear();
  });
  afterEach(() => db.close());

  it("stores the answer and marks the item answered", async () => {
    const created = await request(app)
      .post("/api/approvals")
      .send({ payload: { x: 1 } });

    const res = await request(app)
      .post(`/api/approvals/${created.body.id}/answer`)
      .send({ answer: "yes, go ahead" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("answered");
    expect(res.body.answer).toBe("yes, go ahead");
    expect(res.body.answered_at).toBeTruthy();

    // no longer in pending list
    const list = await request(app).get("/api/approvals");
    expect(list.body.approvals).toHaveLength(0);
  });

  it("rejects an empty answer", async () => {
    const created = await request(app)
      .post("/api/approvals")
      .send({ payload: { x: 1 } });
    const res = await request(app)
      .post(`/api/approvals/${created.body.id}/answer`)
      .send({ answer: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app)
      .post("/api/approvals/9999/answer")
      .send({ answer: "hi" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// dismiss
// ---------------------------------------------------------------------------
describe("POST /api/approvals/:id/dismiss", () => {
  let db: Database.Database;
  let app: express.Application;
  beforeEach(() => {
    db = setupDb();
    app = setupApp();
    mockBroadcast.mockClear();
  });
  afterEach(() => db.close());

  it("marks the item dismissed and removes it from pending", async () => {
    const created = await request(app)
      .post("/api/approvals")
      .send({ payload: { x: 1 } });

    const res = await request(app)
      .post(`/api/approvals/${created.body.id}/dismiss`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("dismissed");

    const list = await request(app).get("/api/approvals");
    expect(list.body.approvals).toHaveLength(0);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).post("/api/approvals/9999/dismiss").send();
    expect(res.status).toBe(404);
  });
});
