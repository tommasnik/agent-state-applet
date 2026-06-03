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
  /**
   * Marks this as an official Google remote MCP server (Calendar / Gmail). The
   * Agent SDK does NOT perform OAuth for remote MCP servers — it only forwards
   * a bearer token. So the config does NOT carry the `Authorization` header
   * itself; instead it declares `google: true` (+ the OAuth `scopes` it needs)
   * and the host injects `headers.Authorization = "Bearer <accessToken>"` at
   * startup via the Google token manager (see googleAuth.ts / host.ts).
   */
  google?: boolean;
  /** OAuth scopes this Google server needs (documentation / setup aid). */
  scopes?: string[];
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpServerConfig;

/** Official Google remote MCP endpoints (Developer Preview). */
export const GOOGLE_CALENDAR_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";
export const GOOGLE_GMAIL_MCP_URL = "https://gmailmcp.googleapis.com/mcp/v1";

/** True if an entry is an http MCP server flagged as Google (needs a bearer). */
export function isGoogleHttpServer(
  v: McpServerConfig
): v is McpHttpServerConfig {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as McpHttpServerConfig).type === "http" &&
    (v as McpHttpServerConfig).google === true
  );
}

export interface CalendarAgentConfig {
  /**
   * Map of MCP server name -> config. Passed straight into the SDK's
   * `options.mcpServers`. The concrete entries (whatsapp-mcp, Gmail MCP,
   * Google Calendar MCP) and their OAuth wiring are owned by TASK-29.
   */
  mcpServers: Record<string, McpServerConfig>;
  /** Model to drive the host with. */
  model?: string;
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
 * Return a shallow copy of the MCP server map with `Authorization: Bearer
 * <accessToken>` injected into every Google-flagged http server's headers. The
 * access token is dynamic (refreshed by the token manager) so it is supplied
 * at call time rather than stored in the config. Non-Google servers (e.g. the
 * local WhatsApp stdio server) are passed through untouched.
 *
 * The internal `google` / `scopes` marker fields are stripped from the result
 * so only SDK-recognised keys reach `options.mcpServers`.
 */
export function injectGoogleBearer(
  servers: Record<string, McpServerConfig>,
  accessToken: string
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (isGoogleHttpServer(server)) {
      const { google: _g, scopes: _s, ...rest } = server;
      out[name] = {
        ...rest,
        type: "http",
        headers: {
          ...(server.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
        },
      };
    } else {
      out[name] = server;
    }
  }
  return out;
}

/** Names of MCP servers flagged as Google remote (need a bearer token). */
export function googleServerNames(
  servers: Record<string, McpServerConfig>
): string[] {
  return Object.entries(servers)
    .filter(([, v]) => isGoogleHttpServer(v))
    .map(([name]) => name);
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
      whitelist: buildWhitelist(parsed.whitelist),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
