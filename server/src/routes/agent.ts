import { Router, Request, Response } from "express";
import type { AgentStore } from "../agents";
import type { WriteStateFn } from "../index";

export function createAgentRouter(store: AgentStore, writeState: WriteStateFn): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    const data = req.body as Record<string, unknown>;

    const pid = String(data["pid"] ?? "").trim();
    if (!pid || !/^\d+$/.test(pid)) {
      res.status(400).json({ error: "missing pid" });
      return;
    }

    const changed = store.upsert(data);
    if (changed !== false) {
      writeState();
    }

    res.json({ ok: true });
  });

  return router;
}
