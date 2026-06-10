import { Router, Request, Response } from "express";
import { spawnSync } from "child_process";
import * as url from "url";
import type { AgentStore } from "../agents";
import { parseXid } from "../agents";
import type { WriteStateFn } from "../index";
import { type SystemCalls, defaultSystemCalls, resolveXEnv } from "../system-calls";

type WmWindow = { xid: string; desktop: string; title: string };

/**
 * Pick the best window XID for a given agent.
 * Prefers the stored `existingWindowId` if it still exists in the window list.
 * Falls back to title-based matching only when the stored id is gone/empty.
 */
export function resolveWindowId(
  existingWindowId: string,
  projectRoot: string,
  windows: WmWindow[]
): string {
  // Validate stored window_id against live window list
  if (existingWindowId) {
    const target = parseXid(existingWindowId);
    if (target !== null) {
      for (const w of windows) {
        if (parseXid(w.xid) === target) return existingWindowId;
      }
    }
  }

  // Fallback: match by project_root path segments (innermost → outermost)
  if (projectRoot) {
    const segments = projectRoot
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      for (const w of windows) {
        const t = w.title;
        if (
          t === seg ||
          t.startsWith(seg + " ") ||
          t.startsWith(seg + "–") ||
          t.startsWith(seg + "—")
        ) {
          return w.xid;
        }
      }
    }
  }

  return "";
}

export function createFocusRouter(store: AgentStore, writeState: WriteStateFn, sys: SystemCalls = defaultSystemCalls): Router {
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
    const env = resolveXEnv();

    // --- Window focus via wmctrl ---
    try {
      const out = sys.wmctrlList();
      const wmWindows: WmWindow[] = [];

      for (const line of out.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          wmWindows.push({
            xid: parts[0],
            desktop: parts[1],
            title: parts.slice(3).join(" "),
          });
        }
      }

      windowId = resolveWindowId(windowId, projectRoot, wmWindows);

      if (windowId) {
        // Switch to the window's desktop first
        const targetXid = parseXid(windowId);
        if (targetXid !== null) {
          for (const w of wmWindows) {
            try {
              if (parseInt(w.xid, 16) === targetXid) {
                sys.wmctrlSwitchDesktop(w.desktop);
                break;
              }
            } catch {
              // skip
            }
          }
        }
        sys.wmctrlFocus(windowId);
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
        sys.httpGet(`http://localhost:63342/api/terminalFocus?${qs}`);
      }
      // Ghostty tab cycling is left as a future enhancement (requires pyatspi/Xlib)
    }

    // Emit D-Bus signal so the applet flashes the window immediately
    if (windowId) {
      spawnSync("dbus-send", [
        "--session",
        "--type=signal",
        "/org/claude/State",
        "org.claude.State.FlashWindow",
        `string:${windowId}`,
      ], { env, timeout: 1000 });
    }

    // Reset done/waiting state to initialized after focus
    const currentAgent = store.get(pid);
    if (currentAgent && (currentAgent.state === "done" || currentAgent.state === "waiting_for_approval")) {
      store.setState(pid, "initialized");
    }

    res.json({ ok: true, window_id: windowId });
  });

  return router;
}
