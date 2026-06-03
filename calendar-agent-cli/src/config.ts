/**
 * Config loader for calendar-agent-cli.
 *
 * Reads the SHARED config at ~/.config/agent-manager/calendar-agent.json
 * (override via $CALENDAR_AGENT_CONFIG). This module is READ-ONLY: it never
 * writes the config file.
 *
 * This is an INDEPENDENT reimplementation, inspired by
 * calendar-agent/src/config.ts + whitelist.ts, but self-contained — the CLI
 * package shares no code with the reference SDK package. We only need the bits
 * the CLI cares about: `aiCalendarId` and the input `whitelist`.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * WhatsApp whitelist: groups are listed BY NAME. Only messages from a group
 * whose name matches one of these (case-insensitive, trimmed) are allowed.
 */
export interface WhatsAppWhitelist {
  /** Group names to allow, listed explicitly. */
  groups: string[];
}

/**
 * Gmail whitelist: a message passes if its sender substring-matches one of
 * `senders` OR it carries one of the `labels`.
 */
export interface GmailWhitelist {
  /** Allowed sender addresses / domains (substring match on From). */
  senders: string[];
  /** Allowed Gmail labels (exact, case-insensitive). */
  labels: string[];
}

export interface WhitelistConfig {
  whatsapp: WhatsAppWhitelist;
  gmail: GmailWhitelist;
}

export interface CalendarAgentCliConfig {
  /**
   * ID of the dedicated AI calendar (e.g. `…@group.calendar.google.com`).
   * The only calendar the agent is allowed to write to. Determined here,
   * never guessed by the model from a name.
   */
  aiCalendarId?: string;
  /**
   * Input whitelist: which WhatsApp groups / Gmail senders / labels the agent
   * is allowed to read.
   */
  whitelist: WhitelistConfig;
}

/** Empty whitelist — the safe default: nothing passes until configured. */
export const EMPTY_WHITELIST: WhitelistConfig = {
  whatsapp: { groups: [] },
  gmail: { senders: [], labels: [] },
};

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-manager");
const CONFIG_PATH = path.join(CONFIG_DIR, "calendar-agent.json");

const DEFAULT_CONFIG: CalendarAgentCliConfig = {
  aiCalendarId: undefined,
  whitelist: EMPTY_WHITELIST,
};

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * Parse an arbitrary object into a {@link WhitelistConfig}, dropping anything
 * malformed. Always returns a fully-formed config (missing parts -> empty).
 */
export function buildWhitelist(raw: unknown): WhitelistConfig {
  if (typeof raw !== "object" || raw === null) {
    return {
      whatsapp: { groups: [] },
      gmail: { senders: [], labels: [] },
    };
  }
  const o = raw as Record<string, unknown>;
  const wa = (o.whatsapp ?? {}) as Record<string, unknown>;
  const gm = (o.gmail ?? {}) as Record<string, unknown>;
  return {
    whatsapp: { groups: toStringArray(wa.groups) },
    gmail: {
      senders: toStringArray(gm.senders),
      labels: toStringArray(gm.labels),
    },
  };
}

/**
 * Resolve the config path. Resolution order:
 *   1. $CALENDAR_AGENT_CONFIG (path to a JSON file)
 *   2. ~/.config/agent-manager/calendar-agent.json
 */
export function configPath(): string {
  const explicit = process.env.CALENDAR_AGENT_CONFIG;
  return explicit && explicit.length > 0 ? explicit : CONFIG_PATH;
}

/**
 * Load the calendar-agent config (READ-ONLY). Falls back to a safe empty
 * default if the file is missing or malformed.
 */
export function loadConfig(): CalendarAgentCliConfig {
  const cfgPath = configPath();

  if (!fs.existsSync(cfgPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CalendarAgentCliConfig>;
    return {
      aiCalendarId:
        typeof parsed.aiCalendarId === "string"
          ? parsed.aiCalendarId
          : undefined,
      whitelist: buildWhitelist(parsed.whitelist),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
