import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { scheduleAdd, scheduleRemove, scheduleUpdate } from "../scheduler";
import { runInteractive, runHeadless } from "../runner";

const router = Router();

function matchField(value: number, expr: string): boolean {
  if (expr === "*") return true;
  if (expr.includes(",")) return expr.split(",").some((e) => matchField(value, e.trim()));
  if (expr.includes("-")) {
    const [lo, hi] = expr.split("-").map(Number);
    return value >= lo && value <= hi;
  }
  if (expr.includes("/")) {
    const [base, step] = expr.split("/");
    const stepNum = parseInt(step, 10);
    const start = base === "*" ? 0 : parseInt(base, 10);
    return value >= start && (value - start) % stepNum === 0;
  }
  return parseInt(expr, 10) === value;
}

function computeNextRun(cronExpr: string): string | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < 10080; i++) {
    if (
      matchField(candidate.getMinutes(), minExpr) &&
      matchField(candidate.getHours(), hourExpr) &&
      matchField(candidate.getDate(), domExpr) &&
      matchField(candidate.getMonth() + 1, monthExpr) &&
      matchField(candidate.getDay(), dowExpr)
    ) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

interface ScheduleRow {
  id: number;
  name: string;
  project_path: string;
  prompt: string;
  cron: string;
  type: "interactive" | "headless";
  enabled: number;
  created_at: string;
}

interface RunRow {
  id: number;
  schedule_id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  output: string | null;
  ai_title: string | null;
  pid: number | null;
  launch_type: string | null;
}

/** GET /api/schedules — list all schedules with their latest run */
router.get("/schedules", (_req: Request, res: Response) => {
  const db = getDb();
  const schedules = db.prepare("SELECT * FROM schedules ORDER BY id").all() as ScheduleRow[];

  const lastRunStmt = db.prepare(
    "SELECT * FROM runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 1"
  );

  const isRunningStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE schedule_id = ? AND status = 'running'"
  );

  const result = schedules.map((s) => ({
    ...s,
    enabled: s.enabled === 1,
    last_run: (lastRunStmt.get(s.id) as RunRow | undefined) ?? null,
    next_run_at: computeNextRun(s.cron),
    is_running: ((isRunningStmt.get(s.id) as { cnt: number }).cnt) > 0,
  }));

  res.json(result);
});

/** POST /api/schedules — create a new schedule */
router.post("/schedules", (req: Request, res: Response) => {
  const { name, project_path, prompt, cron, type, enabled = true } = req.body as {
    name: string;
    project_path: string;
    prompt: string;
    cron: string;
    type: "interactive" | "headless";
    enabled?: boolean;
  };

  if (!name || !project_path || !prompt || !cron || !type) {
    res.status(400).json({ error: "Missing required fields: name, project_path, prompt, cron, type" });
    return;
  }
  if (type !== "interactive" && type !== "headless") {
    res.status(400).json({ error: "type must be 'interactive' or 'headless'" });
    return;
  }

  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO schedules (name, project_path, prompt, cron, type, enabled) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(name, project_path, prompt, cron, type, enabled ? 1 : 0);
  const id = result.lastInsertRowid as number;

  const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow;
  scheduleAdd({ ...schedule, enabled: schedule.enabled });
  res.status(201).json({ ...schedule, enabled: schedule.enabled === 1 });
});

/** PUT /api/schedules/:id — update a schedule */
router.put("/schedules/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const existing = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const { name, project_path, prompt, cron, type, enabled } = req.body as Partial<{
    name: string;
    project_path: string;
    prompt: string;
    cron: string;
    type: "interactive" | "headless";
    enabled: boolean;
  }>;

  const updated = {
    name: name ?? existing.name,
    project_path: project_path ?? existing.project_path,
    prompt: prompt ?? existing.prompt,
    cron: cron ?? existing.cron,
    type: type ?? existing.type,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
  };

  db.prepare(
    "UPDATE schedules SET name = ?, project_path = ?, prompt = ?, cron = ?, type = ?, enabled = ? WHERE id = ?"
  ).run(updated.name, updated.project_path, updated.prompt, updated.cron, updated.type, updated.enabled, id);

  const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow;
  scheduleUpdate({ ...schedule, enabled: schedule.enabled });
  res.json({ ...schedule, enabled: schedule.enabled === 1 });
});

/** DELETE /api/schedules/:id — delete a schedule */
router.delete("/schedules/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const existing = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  scheduleRemove(id);
  db.prepare("DELETE FROM runs WHERE schedule_id = ?").run(id);
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  res.status(204).send();
});

/** POST /api/schedules/:id/run — run immediately */
router.post("/schedules/:id/run", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  if (schedule.type === "interactive") {
    const runId = runInteractive(schedule.id, schedule.project_path, schedule.prompt, 'manual_trigger');
    res.json({ runId, type: "interactive" });
  } else {
    runHeadless(schedule.id, schedule.project_path, schedule.prompt, 'manual_trigger');
    res.json({ type: "headless", message: "Run started, output streamed via WebSocket" });
  }
});

/** GET /api/schedules/:id/runs — run history for a schedule */
router.get("/schedules/:id/runs", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const schedule = db.prepare("SELECT id FROM schedules WHERE id = ?").get(id) as { id: number } | undefined;
  if (!schedule) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }

  const runs = db.prepare(
    `SELECT *,
      CASE WHEN finished_at IS NOT NULL
        THEN CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER)
        ELSE NULL END AS duration_ms
     FROM runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 10`
  ).all(id) as (RunRow & { duration_ms: number | null })[];

  res.json(runs);
});

export default router;
