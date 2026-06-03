import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { broadcast } from "../ws";

const router = Router();

export interface ApprovalRow {
  id: number;
  run_id: number | null;
  session_id: string | null;
  created_at: string;
  status: "pending" | "answered" | "dismissed";
  payload: string | null;
  answer: string | null;
  answered_at: string | null;
}

/**
 * POST /api/approvals — Calendar agent registers an uncertain item.
 * Body: { run_id?, session_id?, payload } — payload is the proposed action +
 * uncertainty + sources (any JSON-serializable value, stored as JSON text).
 * Returns the created row (incl. id). Pushes `approval_pending` over WebSocket.
 */
router.post("/approvals", (req: Request, res: Response) => {
  const db = getDb();
  const body = (req.body ?? {}) as {
    run_id?: number | null;
    session_id?: string | null;
    payload?: unknown;
  };

  const runId = typeof body.run_id === "number" ? body.run_id : null;
  const sessionId = typeof body.session_id === "string" ? body.session_id : null;
  const payloadText =
    body.payload === undefined ? null : JSON.stringify(body.payload);

  const result = db
    .prepare(
      `INSERT INTO approvals (run_id, session_id, status, payload)
       VALUES (?, ?, 'pending', ?)`
    )
    .run(runId, sessionId, payloadText);

  const id = result.lastInsertRowid as number;
  const row = db
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(id) as ApprovalRow;

  broadcast({ event: "approval_pending", approval: row });

  res.status(201).json(row);
});

/**
 * GET /api/approvals — list approvals.
 *
 * `?status=pending|answered|dismissed|all` selects which rows to return.
 * Backward compatible: with no `status` (or an unknown value) it returns only
 * pending items, exactly as before — the UI relies on this default. The
 * `answered` / `all` filters back the one-shot Calendar Agent escalation model
 * (a fresh run reads answered items via `cal-agent approvals answered`).
 */
router.get("/approvals", (req: Request, res: Response) => {
  const db = getDb();
  const statusRaw = req.query["status"];
  const status = typeof statusRaw === "string" ? statusRaw : "pending";

  let rows: ApprovalRow[];
  if (status === "all") {
    rows = db
      .prepare("SELECT * FROM approvals ORDER BY id ASC")
      .all() as ApprovalRow[];
  } else if (
    status === "answered" ||
    status === "dismissed" ||
    status === "pending"
  ) {
    rows = db
      .prepare("SELECT * FROM approvals WHERE status = ? ORDER BY id ASC")
      .all(status) as ApprovalRow[];
  } else {
    // Unknown value → preserve the historical default (pending only).
    rows = db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id ASC")
      .all() as ApprovalRow[];
  }

  res.json({ approvals: rows });
});

/**
 * POST /api/approvals/:id/answer — user's text answer.
 * Stores the answer, marks the item answered, AND pushes an `approval_answer`
 * event over WebSocket so the live Calendar Agent SDK session that registered
 * this approval can pick the answer up and continue (TASK-32 streaming input
 * bridge). The event is correlated via `id` (and the original run/session ids);
 * the agent host filters incoming events down to the approval ids it owns.
 */
router.post("/approvals/:id/answer", (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params["id"];
  const answer = (req.body ?? {}).answer;

  if (typeof answer !== "string" || answer.length === 0) {
    res.status(400).json({ error: "answer (non-empty string) is required" });
    return;
  }

  const existing = db
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(id) as ApprovalRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }

  db.prepare(
    `UPDATE approvals
       SET answer = ?, status = 'answered', answered_at = datetime('now')
     WHERE id = ?`
  ).run(answer, id);

  const row = db
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(id) as ApprovalRow;

  // Deliver the answer to the waiting live SDK session (TASK-32). The agent
  // host is connected as a WS client and matches on `id`.
  broadcast({
    event: "approval_answer",
    id: row.id,
    run_id: row.run_id,
    session_id: row.session_id,
    answer: row.answer,
  });

  res.json(row);
});

/** POST /api/approvals/:id/dismiss — discard a pending item. */
router.post("/approvals/:id/dismiss", (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params["id"];

  const existing = db
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(id) as ApprovalRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }

  db.prepare(
    `UPDATE approvals
       SET status = 'dismissed', answered_at = datetime('now')
     WHERE id = ?`
  ).run(id);

  const row = db
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(id) as ApprovalRow;
  res.json(row);
});

export default router;
