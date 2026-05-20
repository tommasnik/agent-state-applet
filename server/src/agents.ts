import { execSync } from "child_process";
import * as fs from "fs";

export interface Agent {
  pid: number;
  cwd: string;
  state: string;
  timestamp: number;
  hook_event: string;
  tool_name: string;
  session_id: string;
  subagent_count: number;
  started_at: number;
  window_id: string;
  tab_name: string;
  terminal_type: string;
  tty: string;
  project_root: string;
  ai_title: string;
  ghostty_tab_index?: number | null;
}

export type AgentsDict = Record<string, Agent>;

export type ChangeListener = (agents: AgentsDict) => void;

export class AgentStore {
  private agents: AgentsDict = {};
  private listeners: ChangeListener[] = [];

  /** Subscribe to any change in the agents dict */
  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const l of this.listeners) {
      try {
        l(snapshot);
      } catch {
        // ignore listener errors
      }
    }
  }

  /** Return a deep copy of current agents */
  snapshot(): AgentsDict {
    const copy: AgentsDict = {};
    for (const [pid, agent] of Object.entries(this.agents)) {
      copy[pid] = { ...agent };
    }
    return copy;
  }

  /** Update or insert an agent from hook payload. Returns true if state changed. */
  upsert(data: Record<string, unknown>): boolean {
    const pid = String(data["pid"] ?? "").trim();
    if (!pid || !/^\d+$/.test(pid)) return false;

    const state = String(data["state"] ?? "idle");
    const hookEvent = String(data["hook_event"] ?? "");
    const tty = String(data["tty"] ?? "");
    const now = Date.now() / 1000;

    if (state === "session_end") {
      if (pid in this.agents) {
        delete this.agents[pid];
        this.notify();
        return true;
      }
      return false;
    }

    // TTY collision: new session on same PTY → remove lingering done agents
    if (tty && hookEvent === "SessionStart") {
      for (const oldPid of Object.keys(this.agents)) {
        if (
          oldPid !== pid &&
          this.agents[oldPid].tty === tty &&
          this.agents[oldPid].state === "done"
        ) {
          delete this.agents[oldPid];
        }
      }
    }

    const existing = this.agents[pid] ?? {};

    // Notification fires after Stop — don't overwrite done state.
    if (state === "waiting_for_approval" && existing.state === "done") {
      return false;
    }

    // window_id: only overwrite with a non-empty value so that a /clear (SessionStart
    // on same PID) never erases a working window_id when get_window_id_for_pid
    // transiently returns "".
    const incomingWindowId = String(data["window_id"] ?? "");
    const windowId = incomingWindowId || existing.window_id || "";

    this.agents[pid] = {
      pid: parseInt(pid, 10),
      cwd: String(data["cwd"] ?? existing.cwd ?? ""),
      state,
      timestamp: now,
      hook_event: hookEvent,
      tool_name: String(data["tool_name"] ?? ""),
      session_id: String(data["session_id"] ?? existing.session_id ?? ""),
      subagent_count: Number(data["subagent_count"] ?? existing.subagent_count ?? 0),
      started_at: existing.started_at ?? now,
      window_id: windowId,
      tab_name: String(data["tab_name"] ?? "") || existing.tab_name || "",
      terminal_type: String(data["terminal_type"] ?? "") || existing.terminal_type || "",
      tty: String(data["tty"] ?? existing.tty ?? ""),
      project_root: String(data["project_root"] ?? existing.project_root ?? ""),
      // ai_title is set by the poller, never overwritten from hook
      ai_title: existing.ai_title ?? "",
    };

    this.notify();
    return true;
  }

  /** Set window_id for a PID (used after focus resolution) */
  setWindowId(pid: string, windowId: string): void {
    if (pid in this.agents && this.agents[pid].window_id !== windowId) {
      this.agents[pid].window_id = windowId;
      this.notify();
    }
  }

  /** Set state for a PID (used after focus to reset done/waiting) */
  setState(pid: string, state: string): void {
    if (pid in this.agents && this.agents[pid].state !== state) {
      this.agents[pid].state = state;
      this.agents[pid].timestamp = Date.now() / 1000;
      this.notify();
    }
  }

  /** Set ai_title for a PID. Returns true if changed. */
  setAiTitle(pid: string, title: string): boolean {
    if (pid in this.agents && !this.agents[pid].ai_title) {
      this.agents[pid].ai_title = title;
      this.notify();
      return true;
    }
    return false;
  }

  /** Set ghostty_tab_index for a PID. Returns true if changed. */
  setGhosttyTabIndex(pid: string, idx: number | null | undefined): boolean {
    if (pid in this.agents && this.agents[pid].ghostty_tab_index !== idx) {
      this.agents[pid].ghostty_tab_index = idx;
      this.notify();
      return true;
    }
    return false;
  }

  /** Get a single agent by PID */
  get(pid: string): Agent | undefined {
    return this.agents[pid] ? { ...this.agents[pid] } : undefined;
  }

  /** Check if a PID exists */
  has(pid: string): boolean {
    return pid in this.agents;
  }

  /** Remove a PID. Returns true if it existed. */
  remove(pid: string): boolean {
    if (pid in this.agents) {
      delete this.agents[pid];
      this.notify();
      return true;
    }
    return false;
  }

  /** Load agents from a plain dict (used for state restore) */
  loadFrom(agentsDict: Record<string, unknown>): void {
    for (const [pid, raw] of Object.entries(agentsDict)) {
      if (raw && typeof raw === "object") {
        this.agents[pid] = raw as Agent;
      }
    }
  }

  /** All PIDs */
  pids(): string[] {
    return Object.keys(this.agents);
  }
}

/** Check if a process is alive by checking /proc/{pid} */
export function pidAlive(pid: string | number): boolean {
  try {
    fs.accessSync(`/proc/${pid}`);
    return true;
  } catch {
    try {
      process.kill(parseInt(String(pid), 10), 0);
      return true;
    } catch {
      return false;
    }
  }
}

/** Get all open X11 window IDs via wmctrl. Returns null on error. */
export function getOpenXids(): Set<number> | null {
  try {
    const env = { ...process.env, DISPLAY: process.env["DISPLAY"] ?? ":0" };
    const out = execSync("wmctrl -l", { timeout: 3000, env });
    const xids = new Set<number>();
    for (const line of out.toString().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0]) {
        const xid = parseXid(parts[0]);
        if (xid !== null) xids.add(xid);
      }
    }
    return xids;
  } catch {
    return null;
  }
}

export function parseXid(s: string | undefined | null): number | null {
  if (!s) return null;
  try {
    return s.startsWith("0x") ? parseInt(s, 16) : parseInt(s, 10);
  } catch {
    return null;
  }
}
