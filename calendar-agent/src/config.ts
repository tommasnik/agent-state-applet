import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WhitelistConfig, buildWhitelist, EMPTY_WHITELIST } from "./whitelist";

export type { WhitelistConfig } from "./whitelist";
export {
  buildWhitelist,
  filterInputs,
  isAllowed,
  EMPTY_WHITELIST,
} from "./whitelist";

/**
 * MCP server configuration shapes accepted by the Claude Agent SDK.
 * Mirrors the SDK's McpServerConfig union (stdio / sse / http).
 * We intentionally re-declare a minimal version here so this module does not
 * have to statically import the ESM-only SDK (the SDK is imported lazily in
 * host.ts). The objects produced here are structurally compatible with the
 * SDK's `Options.mcpServers` values.
 */
export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpServerConfig;

export interface CalendarAgentConfig {
  /**
   * Map of MCP server name -> config from the config JSON. Today this only
   * carries the WhatsApp stdio server. Calendar + Gmail are NOT here — the host
   * builds them as in-process SDK MCP tools over the raw Google REST APIs (see
   * googleTools.ts), because the official Google remote MCP servers are gated
   * behind the Workspace Developer Preview and reject personal @gmail accounts.
   */
  mcpServers: Record<string, McpServerConfig>;
  /** Model to drive the host with. */
  model?: string;
  /**
   * ID of the dedicated AI calendar (e.g.
   * `…@group.calendar.google.com`). This is the ONLY calendar the agent is
   * allowed to write to. The write tools (`create_event` / `update_event` /
   * `delete_event`) HARD-ENFORCE this: a write to any other calendarId is
   * refused, and when this is unset writes are refused entirely (safe default).
   * Determined deterministically here — never guessed by the model from a name.
   */
  aiCalendarId?: string;
  /**
   * Input whitelist (TASK-29 AC#3): which WhatsApp groups / Gmail senders /
   * labels the agent is allowed to read. Inputs are filtered against this
   * BEFORE the agent reasons over them (see whitelist.ts / filterInputs).
   */
  whitelist: WhitelistConfig;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-manager");
const CONFIG_PATH = path.join(CONFIG_DIR, "calendar-agent.json");

/**
 * Default config ships with NO MCP servers wired up — TASK-29 fills these in.
 * The mechanism is fully configurable: drop a JSON file at CONFIG_PATH (or
 * point CALENDAR_AGENT_CONFIG at one) with an `mcpServers` map.
 */
const DEFAULT_CONFIG: CalendarAgentConfig = {
  mcpServers: {},
  model: undefined,
  aiCalendarId: undefined,
  whitelist: EMPTY_WHITELIST,
};

function isValidMcpServer(v: unknown): v is McpServerConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "sse" || o.type === "http") {
    return typeof o.url === "string";
  }
  // stdio (default when type omitted)
  return typeof o.command === "string";
}

/**
 * Build the MCP server map from an arbitrary parsed object, dropping any
 * entries that don't match a known MCP server shape.
 */
export function buildMcpServers(
  raw: unknown
): Record<string, McpServerConfig> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidMcpServer(value)) {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Load the calendar-agent config. Resolution order:
 *   1. $CALENDAR_AGENT_CONFIG (path to a JSON file)
 *   2. ~/.config/agent-manager/calendar-agent.json
 *   3. built-in default (empty MCP server map)
 */
export function loadConfig(): CalendarAgentConfig {
  const explicit = process.env.CALENDAR_AGENT_CONFIG;
  const configPath = explicit && explicit.length > 0 ? explicit : CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CalendarAgentConfig>;
    return {
      mcpServers: buildMcpServers(parsed.mcpServers),
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      aiCalendarId:
        typeof parsed.aiCalendarId === "string" ? parsed.aiCalendarId : undefined,
      whitelist: buildWhitelist(parsed.whitelist),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
