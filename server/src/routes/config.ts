import { Router, Request, Response } from "express";
import { loadConfig, saveConfig, Config } from "../config";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json(config);
});

router.put("/config", (req: Request, res: Response) => {
  const body = req.body as Partial<Config>;

  if (!Array.isArray(body.projectRoots)) {
    res.status(400).json({ error: "projectRoots must be an array" });
    return;
  }

  const config: Config = { projectRoots: body.projectRoots };
  saveConfig(config);
  res.json(config);
});

export default router;
