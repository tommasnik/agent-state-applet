import { Router, Request, Response } from "express";
import { getDb } from "../db";
import { scheduleAdd, scheduleRemove, scheduleUpdate } from "../scheduler";
import { runInteractive, runHeadless, runCalendarAgent } from "../runner";
import type { WriteStateFn } from "../index";

/**
 * Agents CRUD + run endpoints. Takes `writeState` so create/update/delete can
 * refresh /tmp/claude-agents.json — this is what makes the applet's shortcut
 * buttons appear/update live (it watches that file). Defaults to a no-op so the
 * router still works in tests that don't care about the state file.
 */
export function createAgentsRouter(writeState: WriteStateFn = () => {}): Router {
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

function computeNextRun(cronExpr: string | null): string | null {
  if (!cronExpr || !cronExpr.trim()) return null;
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

interface AgentRow {
  id: number;
  name: string;
  project_path: string;
  prompt: string | null;
  cron: string | null;
  type: "interactive" | "headless" | "calendar_agent";
  enabled: number;
  shortcut_icon: string | null;
  created_at: string;
}

interface RunRow {
  id: number;
  agent_id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  output: string | null;
  ai_title: string | null;
  pid: number | null;
  launch_type: string | null;
}

/** Normalize an optional string field: trim, treat empty as null. */
function optStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** GET /api/agents — list all agents with their latest run */
router.get("/agents", (_req: Request, res: Response) => {
  const db = getDb();
  const agents = db.prepare("SELECT * FROM agents ORDER BY id").all() as AgentRow[];

  const lastRunStmt = db.prepare(
    "SELECT * FROM runs WHERE agent_id = ? ORDER BY id DESC LIMIT 1"
  );

  const isRunningStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE agent_id = ? AND status = 'running'"
  );

  const result = agents.map((a) => ({
    ...a,
    enabled: a.enabled === 1,
    last_run: (lastRunStmt.get(a.id) as RunRow | undefined) ?? null,
    next_run_at: computeNextRun(a.cron),
    is_running: ((isRunningStmt.get(a.id) as { cnt: number }).cnt) > 0,
  }));

  res.json(result);
});

/** POST /api/agents — create a new agent */
router.post("/agents", (req: Request, res: Response) => {
  const { name, project_path, type, enabled = true } = req.body as {
    name: string;
    project_path: string;
    type: "interactive" | "headless" | "calendar_agent";
    enabled?: boolean;
  };
  const prompt = optStr((req.body as { prompt?: unknown }).prompt);
  const cron = optStr((req.body as { cron?: unknown }).cron);
  const shortcut_icon = optStr((req.body as { shortcut_icon?: unknown }).shortcut_icon);

  if (!name || !project_path || !type) {
    res.status(400).json({ error: "Missing required fields: name, project_path, type" });
    return;
  }
  if (type !== "interactive" && type !== "headless" && type !== "calendar_agent") {
    res.status(400).json({ error: "type must be 'interactive', 'headless' or 'calendar_agent'" });
    return;
  }
  // Headless agents must have a prompt — there is nothing to "just open".
  if (type === "headless" && !prompt) {
    res.status(400).json({ error: "headless agents require a prompt" });
    return;
  }

  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO agents (name, project_path, prompt, cron, type, enabled, shortcut_icon) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(name, project_path, prompt, cron, type, enabled ? 1 : 0, shortcut_icon);
  const id = result.lastInsertRowid as number;

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
  scheduleAdd({ ...agent, enabled: agent.enabled });
  writeState();
  res.status(201).json({ ...agent, enabled: agent.enabled === 1 });
});

/** PUT /api/agents/:id — update an agent */
router.put("/agents/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = req.body as Partial<{
    name: string;
    project_path: string;
    prompt: string | null;
    cron: string | null;
    type: "interactive" | "headless" | "calendar_agent";
    enabled: boolean;
    shortcut_icon: string | null;
  }>;

  const updated = {
    name: body.name ?? existing.name,
    project_path: body.project_path ?? existing.project_path,
    prompt: body.prompt !== undefined ? optStr(body.prompt) : existing.prompt,
    cron: body.cron !== undefined ? optStr(body.cron) : existing.cron,
    type: body.type ?? existing.type,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    shortcut_icon: body.shortcut_icon !== undefined ? optStr(body.shortcut_icon) : existing.shortcut_icon,
  };

  if (updated.type === "headless" && !updated.prompt) {
    res.status(400).json({ error: "headless agents require a prompt" });
    return;
  }

  db.prepare(
    "UPDATE agents SET name = ?, project_path = ?, prompt = ?, cron = ?, type = ?, enabled = ?, shortcut_icon = ? WHERE id = ?"
  ).run(
    updated.name,
    updated.project_path,
    updated.prompt,
    updated.cron,
    updated.type,
    updated.enabled,
    updated.shortcut_icon,
    id
  );

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
  scheduleUpdate({ ...agent, enabled: agent.enabled });
  writeState();
  res.json({ ...agent, enabled: agent.enabled === 1 });
});

/** DELETE /api/agents/:id — delete an agent */
router.delete("/agents/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  scheduleRemove(id);
  db.prepare("DELETE FROM runs WHERE agent_id = ?").run(id);
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  writeState();
  res.status(204).send();
});

/** POST /api/agents/:id/run — run immediately */
router.post("/agents/:id/run", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const prompt = agent.prompt ?? "";
  if (agent.type === "calendar_agent") {
    const runId = runCalendarAgent(agent.id, agent.project_path, 'manual_trigger');
    res.json({ runId, type: "calendar_agent", message: "Long-lived calendar-agent started" });
  } else if (agent.type === "interactive") {
    const runId = runInteractive(agent.id, agent.project_path, prompt, 'manual_trigger');
    res.json({ runId, type: "interactive" });
  } else {
    runHeadless(agent.id, agent.project_path, prompt, 'manual_trigger');
    res.json({ type: "headless", message: "Run started, output streamed via WebSocket" });
  }
});

/** GET /api/agents/:id/runs — run history for an agent */
router.get("/agents/:id/runs", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(id) as { id: number } | undefined;
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const runs = db.prepare(
    `SELECT *,
      CASE WHEN finished_at IS NOT NULL
        THEN CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER)
        ELSE NULL END AS duration_ms
     FROM runs WHERE agent_id = ? ORDER BY id DESC LIMIT 10`
  ).all(id) as (RunRow & { duration_ms: number | null })[];

  res.json(runs);
});

  return router;
}

export default createAgentsRouter;
