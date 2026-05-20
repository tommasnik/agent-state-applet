import { Router, Request, Response } from "express";
import { loadConfig } from "../config";
import { scanProjects } from "../scanner";

const router = Router();

router.get("/projects", (_req: Request, res: Response) => {
  const config = loadConfig();
  const projects = scanProjects(config.projectRoots);
  res.json(projects);
});

export default router;
