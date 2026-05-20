import express from "express";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";

import { AgentStore, pidAlive, getOpenXids, parseXid } from "./agents";
import {
  writeState as writeStateFile,
  loadState,
  backupState,
  loadPendingReviews,
  jsonlPath,
  readAiTitle,
  STATE_FILE,
  ReviewMeta,
} from "./stateFile";
import { createWsServer, broadcastState } from "./ws";
import { createAgentRouter } from "./routes/agent";
import { createFocusRouter } from "./routes/focus";
import { createStatusRouter } from "./routes/status";
import { createReviewsRouter } from "./routes/reviews";
import configRouter from "./routes/config";
import projectsRouter from "./routes/projects";
import schedulesRouter from "./routes/schedules";
import promptsRouter from "./routes/prompts";
import { initDb } from "./db";
import { schedulerInit } from "./scheduler";

const HOST = "127.0.0.1";
const PORT = 7855;
const PID_CHECK_INTERVAL_MS = 5000;
const AI_TITLE_POLL_INTERVAL_MS = 3000;

// Export type used by route handlers
export type WriteStateFn = () => void;

// --- State ---
const store = new AgentStore();
const pendingReviews = new Map<string, ReviewMeta>();

function writeState(): void {
  const agents = store.snapshot();
  const reviews = Array.from(pendingReviews.values());
  writeStateFile(agents, reviews);
}

// --- Express app ---
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

// Routes
app.use("/agent", createAgentRouter(store, writeState));
app.use("/focus", createFocusRouter(store, writeState));
app.use("/status", createStatusRouter(store));
app.use("/reviews", createReviewsRouter(pendingReviews, writeState));
app.use("/api", configRouter);
app.use("/api", projectsRouter);
app.use("/api", schedulesRouter);
app.use("/api", promptsRouter);

// Notify WebSocket clients on any state change
const httpServer = http.createServer(app);
const wss = createWsServer(httpServer);

store.onChange((agents) => {
  const reviews = Array.from(pendingReviews.values());
  broadcastState(wss, agents, reviews);
  writeState();
});

// --- PID liveness checker (every 5s) ---
function startPidChecker(): void {
  setInterval(() => {
    const openXids = getOpenXids();
    let changed = false;

    for (const pid of store.pids()) {
      if (!pidAlive(pid)) {
        store.remove(pid);
        changed = true;
        continue;
      }
      // If the agent's IDE window no longer exists, remove the agent
      if (openXids !== null) {
        const agent = store.get(pid);
        if (agent) {
          const wid = parseXid(agent.window_id);
          if (wid && !openXids.has(wid)) {
            store.remove(pid);
            changed = true;
          }
        }
      }
    }

    if (changed) {
      writeState();
    }
  }, PID_CHECK_INTERVAL_MS);
}

// --- AI title poller (every 3s) ---
function startAiTitlePoller(): void {
  setInterval(() => {
    for (const pid of store.pids()) {
      const agent = store.get(pid);
      if (!agent || agent.ai_title) continue;

      const { session_id, project_root } = agent;
      if (!session_id || !project_root) continue;

      const filePath = jsonlPath(project_root, session_id);
      const title = readAiTitle(filePath);
      if (title) {
        store.setAiTitle(pid, title);
        // writeState() is triggered via onChange listener
      }
    }
  }, AI_TITLE_POLL_INTERVAL_MS);
}

// --- Restore state on startup ---
function restoreState(): void {
  const { agents, reviews } = loadState();

  if (Object.keys(agents).length > 0) {
    store.loadFrom(agents);
    writeState();
  }

  // Load pending reviews
  const loadedReviews = loadPendingReviews();
  for (const r of loadedReviews) {
    pendingReviews.set(r.session_id, r);
  }
  // Also restore from saved state file reviews
  for (const r of reviews) {
    if (!pendingReviews.has(r.session_id)) {
      pendingReviews.set(r.session_id, r);
    }
  }
}

// --- Graceful shutdown ---
function shutdown(): void {
  backupState();
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Start ---
initDb();
schedulerInit();
restoreState();
startPidChecker();
startAiTitlePoller();

httpServer.listen(PORT, HOST, () => {
  console.log(`Claude State Server on ${HOST}:${PORT}`);
});
