import express from "express";
import * as path from "path";
import * as fs from "fs";

import type { AgentStore } from "./agents";
import { createAgentRouter } from "./routes/agent";
import { createFocusRouter } from "./routes/focus";
import { createStatusRouter } from "./routes/status";
import { createReviewsRouter } from "./routes/reviews";
import configRouter from "./routes/config";
import projectsRouter from "./routes/projects";
import pipelineRouter from "./routes/pipeline";
import schedulesRouter from "./routes/schedules";
import promptsRouter from "./routes/prompts";
import runsRouter from "./routes/runs";
import type { ReviewMeta } from "./stateFile";
import type { WriteStateFn } from "./index";
import { type SystemCalls, defaultSystemCalls } from "./system-calls";

export function buildApp(
  store: AgentStore,
  writeState: WriteStateFn,
  pendingReviews: Map<string, ReviewMeta>,
  sys: SystemCalls = defaultSystemCalls
): express.Application {
  const app = express();
  app.use(express.json());

  // Serve React UI from ../ui/dist/ if it exists
  const uiDistPath = path.resolve(__dirname, "../../ui/dist");
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));
    app.get("/", (_req, res) => {
      res.sendFile(path.join(uiDistPath, "index.html"));
    });
    app.get("/assets/*", (_req, res, next) => next());
  }

  app.use("/agent", createAgentRouter(store, writeState));
  app.use("/focus", createFocusRouter(store, writeState, sys));
  app.use("/api/focus", createFocusRouter(store, writeState, sys));
  app.use("/status", createStatusRouter(store));
  app.use("/reviews", createReviewsRouter(pendingReviews, writeState));
  app.use("/api", configRouter);
  app.use("/api", projectsRouter);
  app.use("/api", pipelineRouter);
  app.use("/api", schedulesRouter);
  app.use("/api", promptsRouter);
  app.use("/api", runsRouter);

  return app;
}
