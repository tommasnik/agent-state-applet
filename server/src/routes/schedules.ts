import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { scheduleAdd, scheduleRemove, scheduleUpdate } from "../scheduler";
import { runInteractive, runHeadless } from "../runner";

const router = Router();

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
}

/** GET /api/schedules — list all schedules with their latest run */
router.get("/schedules", (_req: Request, res: Response) => {
  const db = getDb();
  const schedules = db.prepare("SELECT * FROM schedules ORDER BY id").all() as ScheduleRow[];

  const lastRunStmt = db.prepare(
    "SELECT * FROM runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 1"
  );

  const result = schedules.map((s) => ({
    ...s,
    enabled: s.enabled === 1,
    last_run: (lastRunStmt.get(s.id) as RunRow | undefined) ?? null,
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
    const runId = runInteractive(schedule.id, schedule.project_path, schedule.prompt);
    res.json({ runId, type: "interactive" });
  } else {
    runHeadless(schedule.id, schedule.project_path, schedule.prompt);
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
    "SELECT * FROM runs WHERE schedule_id = ? ORDER BY id DESC"
  ).all(id) as RunRow[];

  res.json(runs);
});

export default router;
