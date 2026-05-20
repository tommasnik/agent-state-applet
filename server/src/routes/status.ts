import { Router, Request, Response } from "express";
import type { AgentStore } from "../agents";

export function createStatusRouter(store: AgentStore): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({
      agents: store.snapshot(),
      updated_at: Date.now() / 1000,
    });
  });

  return router;
}
