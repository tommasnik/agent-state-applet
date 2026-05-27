import { Router, Request, Response } from "express";
import type { AgentStore } from "../agents";
import type { WriteStateFn } from "../index";
import { handleSessionStart, closeRun } from "../runs";

export function createAgentRouter(store: AgentStore, writeState: WriteStateFn): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    const data = req.body as Record<string, unknown>;

    const pid = String(data["pid"] ?? "").trim();
    if (!pid || !/^\d+$/.test(pid)) {
      res.status(400).json({ error: "missing pid" });
      return;
    }

    const hookEvent = String(data["hook_event"] ?? "");
    if (hookEvent === "SessionStart") {
      handleSessionStart({
        pid: pid,
        session_id: data["session_id"] as string | undefined,
        schedule_id: data["schedule_id"] as string | number | undefined,
        terminal_type: data["terminal_type"] as string | undefined,
        project_root: data["project_root"] as string | undefined,
        tty: data["tty"] as string | undefined,
      });
    }

    if (hookEvent === "Stop") {
      const agent = store.get(pid);
      closeRun(parseInt(pid, 10), "success", agent?.ai_title || undefined);
    }

    const changed = store.upsert(data);
    if (changed !== false) {
      writeState();
    }

    res.json({ ok: true });
  });

  return router;
}
