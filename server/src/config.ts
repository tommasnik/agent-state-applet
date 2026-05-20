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
