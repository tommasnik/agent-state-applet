import * as fs from "fs";
import * as path from "path";
import type { AgentsDict } from "./agents";

export const STATE_FILE = "/tmp/claude-agents.json";
export const BACKUP_FILE = STATE_FILE + ".bak";

export interface ScheduledEntry {
  id: number;
  name: string;
  project_path: string;
  cron: string;
  type: "interactive" | "headless";
  enabled: boolean;
}

export interface StatePayload {
  agents: AgentsDict;
  reviews?: ReviewMeta[];
  scheduled?: ScheduledEntry[];
  updated_at: number;
}

export interface ReviewMeta {
  session_id: string;
  review_path: string;
  cwd: string;
  summary_line: string;
}

/** Write state atomically: write to .tmp then rename */
export function writeState(agents: AgentsDict, reviews: ReviewMeta[] = [], scheduled: ScheduledEntry[] = []): void {
  const tmp = STATE_FILE + ".tmp";
  const payload: StatePayload = {
    agents,
    reviews,
    scheduled,
    updated_at: Date.now() / 1000,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, STATE_FILE);
}

/** Load state from backup or state file (used on startup) */
export function loadState(): { agents: Record<string, unknown>; reviews: ReviewMeta[] } {
  for (const filePath of [BACKUP_FILE, STATE_FILE]) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as StatePayload;
      if (data.agents && Object.keys(data.agents).length > 0) {
        return {
          agents: data.agents as Record<string, unknown>,
          reviews: data.reviews ?? [],
        };
      }
    } catch {
      // try next file
    }
  }
  return { agents: {}, reviews: [] };
}

/** Copy state file to backup */
export function backupState(): void {
  try {
    fs.copyFileSync(STATE_FILE, BACKUP_FILE);
  } catch {
    // ignore if state file doesn't exist
  }
}

/** Encode project_root to match Claude's JSONL directory naming convention */
export function encodeProjectRoot(projectRoot: string): string {
  return projectRoot.replace(/\//g, "-");
}

/** Return the path to the JSONL file for a given agent */
export function jsonlPath(projectRoot: string, sessionId: string): string {
  const claudeProjectsDir = path.join(
    process.env["HOME"] ?? "/root",
    ".claude",
    "projects"
  );
  const encoded = encodeProjectRoot(projectRoot);
  return path.join(claudeProjectsDir, encoded, sessionId + ".jsonl");
}

/** Read ai-title from a JSONL file. Returns null if not found. */
export function readAiTitle(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as Record<string, unknown>;
        if (entry["type"] === "ai-title" && entry["aiTitle"]) {
          return String(entry["aiTitle"]);
        }
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // file not found or unreadable
  }
  return null;
}

/** Load pending reviews from ~/.claude/session-reviews/*.pending.json on startup */
export function loadPendingReviews(): ReviewMeta[] {
  const reviewsDir = path.join(
    process.env["HOME"] ?? "/root",
    ".claude",
    "session-reviews"
  );
  const reviews: ReviewMeta[] = [];
  try {
    const files = fs.readdirSync(reviewsDir);
    for (const file of files) {
      if (!file.endsWith(".pending.json")) continue;
      try {
        const raw = fs.readFileSync(path.join(reviewsDir, file), "utf-8");
        const meta = JSON.parse(raw) as ReviewMeta;
        if (meta.session_id) {
          reviews.push(meta);
        }
      } catch {
        // skip malformed file
      }
    }
  } catch {
    // directory doesn't exist
  }
  return reviews;
}
