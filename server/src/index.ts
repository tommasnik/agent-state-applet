import * as http from "http";
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
  ScheduledEntry,
  ShortcutEntry,
} from "./stateFile";
import { createWsServer, broadcastState } from "./ws";
import { initDb, getDb } from "./db";
import { schedulerInit } from "./scheduler";
import { cleanupStaleRuns, closeRun } from "./runs";
import { buildApp } from "./app";

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
  const scheduled = getDb()
    .prepare(`
      SELECT a.id, a.name, a.project_path, a.cron, a.type, a.enabled
      FROM agents a
      WHERE a.enabled = 1
        AND EXISTS (
          SELECT 1 FROM runs r
          WHERE r.agent_id = a.id
            AND r.status = 'running'
        )
    `)
    .all() as ScheduledEntry[];
  // Agents with a shortcut icon — rendered as one-click launch buttons in the applet.
  const shortcuts = getDb()
    .prepare(`
      SELECT id, name, shortcut_icon
      FROM agents
      WHERE shortcut_icon IS NOT NULL AND TRIM(shortcut_icon) <> ''
      ORDER BY id
    `)
    .all() as ShortcutEntry[];
  writeStateFile(agents, reviews, scheduled, shortcuts);
}

// --- Express app ---
const app = buildApp(store, writeState, pendingReviews);

// Notify WebSocket clients on any state change
const httpServer = http.createServer(app);
const wss = createWsServer(httpServer, () => ({
  agents: store.snapshot(),
  reviews: Array.from(pendingReviews.values()),
  updated_at: Date.now() / 1000,
}));

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
        const agent = store.get(pid);
        // Only close run for root agents — subagents have parent_session_id set
        if (!agent?.parent_session_id) {
          closeRun(parseInt(pid, 10), "failed", agent?.ai_title || undefined);
        }
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
cleanupStaleRuns();
schedulerInit();
restoreState();
// Publish the initial state file unconditionally so the applet sees configured
// shortcut buttons even when no agents are running yet.
writeState();
startPidChecker();
startAiTitlePoller();

httpServer.listen(PORT, HOST, () => {
  console.log(`Claude State Server on ${HOST}:${PORT}`);
});
