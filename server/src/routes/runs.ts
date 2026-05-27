import { Router, Request, Response } from "express";
import { getDb } from "../db";

const router = Router();

interface RunRow {
  id: number;
  schedule_id: number | null;
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
  schedule_name: string | null;
}

const RUN_SELECT = `
  SELECT r.*,
    CASE WHEN r.finished_at IS NOT NULL
      THEN CAST((julianday(r.finished_at) - julianday(r.started_at)) * 86400000 AS INTEGER)
      ELSE NULL END AS duration_ms,
    s.name AS schedule_name
  FROM runs r
  LEFT JOIN schedules s ON r.schedule_id = s.id
`;

/** GET /api/runs — list runs with optional filtering and pagination */
router.get("/runs", (req: Request, res: Response) => {
  const db = getDb();
  const { project, type, status, since, until, limit: rawLimit, offset: rawOffset } = req.query;

  const limit = Math.min(parseInt(String(rawLimit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(rawOffset ?? "0"), 10) || 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (project) { conditions.push("r.project_root LIKE ?"); params.push(`${project}%`); }
  if (type)    { conditions.push("r.launch_type = ?");     params.push(type); }
  if (status)  { conditions.push("r.status = ?");          params.push(status); }
  if (since)   { conditions.push("r.started_at >= ?");     params.push(since); }
  if (until)   { conditions.push("r.started_at <= ?");     params.push(until); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countQuery = `SELECT COUNT(*) as count FROM runs r LEFT JOIN schedules s ON r.schedule_id = s.id ${where}`;
  const total = (db.prepare(countQuery).get(...params) as { count: number }).count;

  const dataQuery = `${RUN_SELECT} ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`;
  const runs = db.prepare(dataQuery).all(...params, limit, offset) as RunRow[];

  res.json({ runs, total });
});

/** GET /api/runs/:id — single run by ID */
router.get("/runs/:id", (req: Request, res: Response) => {
  const db = getDb();
  const run = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(req.params["id"]) as RunRow | undefined;

  if (!run) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(run);
});

export default router;
