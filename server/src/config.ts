import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-manager");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export interface Config {
  projectRoots: string[];
}

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

const DEFAULT_CONFIG: Config = {
  projectRoots: [
    expandTilde("~/work/code"),
    expandTilde("~/code"),
  ],
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      projectRoots: Array.isArray(parsed.projectRoots)
        ? parsed.projectRoots.map(expandTilde)
        : DEFAULT_CONFIG.projectRoots,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Resolve the calendar-agent entrypoint (`calendar-agent/dist/index.js`).
 *
 * Resolution order:
 *   1. $CALENDAR_AGENT_ENTRYPOINT (explicit path to the built index.js)
 *   2. <repo root>/calendar-agent/dist/index.js, where the repo root is
 *      derived relative to this file (server/src or server/dist → repo root).
 *
 * The path is intentionally NOT hardcoded to a user's absolute home dir; it is
 * derived from the running server's own location so it follows the checkout.
 */
export function calendarAgentEntrypoint(): string {
  const explicit = process.env.CALENDAR_AGENT_ENTRYPOINT;
  if (explicit && explicit.length > 0) {
    return expandTilde(explicit);
  }
  // __dirname is .../server/dist (built) or .../server/src (ts-node).
  // Repo root is two levels up from either.
  const repoRoot = path.resolve(__dirname, "..", "..");
  return path.join(repoRoot, "calendar-agent", "dist", "index.js");
}
