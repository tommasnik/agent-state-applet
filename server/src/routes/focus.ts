import { Router, Request, Response } from "express";
import { execSync, spawnSync } from "child_process";
import * as http from "http";
import * as url from "url";
import type { AgentStore } from "../agents";
import { parseXid } from "../agents";
import type { WriteStateFn } from "../index";

export function createFocusRouter(store: AgentStore, writeState: WriteStateFn): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    const data = req.body as Record<string, unknown>;

    const pid = String(data["pid"] ?? "").trim();
    if (!pid || !/^\d+$/.test(pid)) {
      res.status(400).json({ error: "missing pid" });
      return;
    }

    const agent = store.get(pid);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    let windowId = agent.window_id ?? "";
    const projectRoot = agent.project_root ?? "";
    const env = { ...process.env, DISPLAY: process.env["DISPLAY"] ?? ":0" };

    // --- Window focus via wmctrl ---
    try {
      const out = execSync("wmctrl -l", { timeout: 2000, env });
      const windows: Array<{ xid: string; desktop: string; title: string }> = [];

      for (const line of out.toString().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          windows.push({
            xid: parts[0],
            desktop: parts[1],
            title: parts.slice(3).join(" "),
          });
        }
      }

      // Try to match by project_root path segments (innermost → outermost)
      if (projectRoot) {
        const segments = projectRoot
          .replace(/^\/+|\/+$/g, "")
          .split("/")
          .filter(Boolean);
        outer: for (let i = segments.length - 1; i >= 0; i--) {
          const seg = segments[i];
          for (const w of windows) {
            const t = w.title;
            if (
              t === seg ||
              t.startsWith(seg + " ") ||
              t.startsWith(seg + "–") ||
              t.startsWith(seg + "—")
            ) {
              windowId = w.xid;
              break outer;
            }
          }
        }
      }

      if (windowId) {
        // Switch to the window's desktop first
        const targetXid = parseXid(windowId);
        if (targetXid !== null) {
          for (const w of windows) {
            try {
              if (parseInt(w.xid, 16) === targetXid) {
                spawnSync("wmctrl", ["-s", w.desktop], { env, timeout: 2000 });
                break;
              }
            } catch {
              // skip
            }
          }
        }
        spawnSync("wmctrl", ["-i", "-a", windowId], { env, timeout: 2000 });
      }
    } catch {
      // wmctrl not available or failed
    }

    // Persist the resolved window_id
    if (windowId && windowId !== agent.window_id) {
      store.setWindowId(pid, windowId);
    }

    // Switch to the correct terminal tab
    const tabName = agent.tab_name ?? "";
    const terminalType = agent.terminal_type ?? "";

    if (tabName) {
      if (terminalType === "idea" || (terminalType === "" && projectRoot)) {
        // IDEA plugin: POST to localhost:63342
        const projectName = projectRoot.replace(/\/+$/, "").split("/").pop() ?? "";
        const aiTitle = agent.ai_title ?? "";
        const params: Record<string, string> = { tabName, project: projectName };
        if (aiTitle) params["newName"] = aiTitle;
        const qs = new url.URLSearchParams(params).toString();
        try {
          const ideaReq = http.request(
            `http://localhost:63342/api/terminalFocus?${qs}`,
            { timeout: 1000 }
          );
          ideaReq.on("error", () => {/* ignore */});
          ideaReq.end();
        } catch {
          // IDEA not running
        }
      }
      // Ghostty tab cycling is left as a future enhancement (requires pyatspi/Xlib)
    }

    // Reset done/waiting state to initialized after focus
    const currentAgent = store.get(pid);
    if (currentAgent && (currentAgent.state === "done" || currentAgent.state === "waiting_for_approval")) {
      store.setState(pid, "initialized");
      writeState();
    }

    res.json({ ok: true, window_id: windowId });
  });

  return router;
}
