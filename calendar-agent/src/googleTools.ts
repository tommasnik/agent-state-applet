import { z } from "zod";
import { GoogleTokenManager } from "./googleAuth";

/**
 * In-process SDK MCP tools for Google Calendar + Gmail over the *raw* Google
 * REST APIs (calendar/v3, gmail/v1), NOT the official Google remote MCP servers.
 *
 * Why: the official remote MCP servers (calendarmcp / gmailmcp.googleapis.com)
 * are gated behind the Google Workspace Developer Preview Program, which
 * requires a Workspace account — a personal @gmail.com is ineligible. With a
 * personal account `initialize` succeeds but every real tool call returns "The
 * caller does not have permission". The raw REST APIs work fine with our OAuth
 * token (verified HTTP 200). So we expose our own custom tools that call the
 * REST APIs directly, taking the access token from {@link GoogleTokenManager}.
 *
 * The SDK (`@anthropic-ai/claude-agent-sdk`) is ESM-only and this package is
 * CommonJS, so the SDK is imported lazily via dynamic `import()` (mirrors
 * host.ts `loadSdkQuery()`).
 *
 * Handlers NEVER throw — an uncaught throw kills the whole query loop. Failures
 * are returned as `{ content: [...], isError: true }`.
 *
 * The token manager + fetch implementation are injectable so tests can run
 * without touching the network or real OAuth.
 */

/** Minimal structural type of the SDK `tool()` factory result. */
export interface SdkTool {
  name: string;
  [key: string]: unknown;
}

/** Minimal structural type of an SDK MCP server instance. */
export interface SdkMcpServer {
  name: string;
  [key: string]: unknown;
}

/** Subset of the SDK surface we use to build custom in-process tools. */
interface SdkCustomToolsApi {
  tool: (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
    extra?: { annotations?: Record<string, unknown> }
  ) => SdkTool;
  createSdkMcpServer: (opts: {
    name: string;
    version?: string;
    tools: SdkTool[];
  }) => SdkMcpServer;
}

/** The two in-process Google MCP servers the host wires into the SDK. */
export interface GoogleMcpServers {
  calendar: SdkMcpServer;
  gmail: SdkMcpServer;
}

/** Shape returned by every tool handler. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Injectable fetch (defaults to the Node 18+ global `fetch`). */
export type FetchImpl = typeof fetch;

export interface BuildGoogleToolsOptions {
  /** Token source; defaults to a fresh {@link GoogleTokenManager}. */
  tokenManager?: GoogleTokenManager;
  /** HTTP transport; defaults to global `fetch`. */
  fetchImpl?: FetchImpl;
  /**
   * ID of the dedicated AI calendar. HARD ENFORCEMENT (TASK-29): the write
   * tools (`create_event` / `update_event` / `delete_event`) accept writes
   * ONLY to this calendarId. Any other `calendarId` is refused with an error
   * result (no fetch is performed). When this is undefined, ALL writes are
   * refused — a safe default so the agent never writes blind. Read tools are
   * unaffected (the agent must read every calendar to detect conflicts).
   */
  aiCalendarId?: string;
}

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

/** Lazily import the ESM-only SDK custom-tools API from CommonJS. */
async function loadSdkCustomTools(): Promise<SdkCustomToolsApi> {
  const mod = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
    tool: SdkCustomToolsApi["tool"];
    createSdkMcpServer: SdkCustomToolsApi["createSdkMcpServer"];
  };
  return { tool: mod.tool, createSdkMcpServer: mod.createSdkMcpServer };
}

/** Build a text result from any JSON-serialisable value. */
function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Build an error result (never throws). */
function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Perform an authenticated Google REST request and return the parsed body, or
 * an error result on non-2xx / network failure / token failure. Fetches a fresh
 * access token PER CALL so the token manager's cache + auto-refresh keeps a
 * long-lived session valid (the token never expires mid-session).
 */
async function googleRequest(
  tokenManager: GoogleTokenManager,
  fetchImpl: FetchImpl,
  url: string,
  init: { method: string; body?: unknown } = { method: "GET" }
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  let token: string;
  try {
    token = await tokenManager.getAccessToken();
  } catch (err) {
    return { ok: false, error: `Failed to obtain Google access token: ${String(err)}` };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const reqInit: { method: string; headers: Record<string, string>; body?: string } = {
    method: init.method,
    headers,
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    reqInit.body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetchImpl(url, reqInit);
  } catch (err) {
    return { ok: false, error: `Google request failed: ${String(err)}` };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `Google API ${res.status} ${res.statusText}: ${detail || "(no body)"}`,
    };
  }

  // DELETE returns 204 No Content; tolerate an empty body.
  if (res.status === 204) {
    return { ok: true, data: { success: true } };
  }
  try {
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `Failed to parse Google response: ${String(err)}` };
  }
}

const READ_ONLY = { annotations: { readOnlyHint: true } };

/**
 * Build the two in-process SDK MCP servers (`calendar` + `gmail`) over the raw
 * Google REST APIs. Both share one {@link GoogleTokenManager}. Returns objects
 * suitable for the SDK's `options.mcpServers` map (tool names become
 * `mcp__calendar__*` / `mcp__gmail__*`).
 */
export async function buildGoogleMcpServers(
  opts: BuildGoogleToolsOptions = {}
): Promise<GoogleMcpServers> {
  const { tool, createSdkMcpServer } = await loadSdkCustomTools();
  const tokenManager = opts.tokenManager ?? new GoogleTokenManager();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const aiCalendarId = opts.aiCalendarId;

  const req = (url: string, init?: { method: string; body?: unknown }) =>
    googleRequest(tokenManager, fetchImpl, url, init);

  /**
   * HARD ENFORCEMENT of the dedicated AI calendar (TASK-29). Resolve the
   * calendarId a write tool may use:
   *   - no AI calendar configured  → refuse ALL writes (safe default);
   *   - incoming calendarId omitted → default to the AI calendar;
   *   - incoming calendarId differs → refuse (writing elsewhere is impossible).
   * Returns either the allowed calendarId or an error result to return as-is.
   */
  function enforceAiCalendar(
    raw: unknown
  ): { ok: true; calendarId: string } | { ok: false; error: ToolResult } {
    if (!aiCalendarId) {
      return {
        ok: false,
        error: fail(
          "Refused: no AI calendar configured (aiCalendarId is unset); refusing to write."
        ),
      };
    }
    const incoming =
      typeof raw === "string" && raw.length > 0 ? raw : undefined;
    if (incoming !== undefined && incoming !== aiCalendarId) {
      return {
        ok: false,
        error: fail(
          `Refused: writes are only allowed to the dedicated AI calendar (${aiCalendarId}). Got calendarId=${incoming}.`
        ),
      };
    }
    return { ok: true, calendarId: aiCalendarId };
  }

  // ---- Calendar tools ----------------------------------------------------

  const listCalendars = tool(
    "list_calendars",
    "List all calendars the user can access (id, summary, primary). Use this to find the dedicated 'AI' calendar id before writing events.",
    {},
    async () => {
      const r = await req(`${CALENDAR_BASE}/users/me/calendarList`);
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const listEvents = tool(
    "list_events",
    "List events on a calendar within an optional time window (RFC3339).",
    {
      calendarId: z
        .string()
        .default("primary")
        .describe("Calendar id (default 'primary')"),
      timeMin: z
        .string()
        .optional()
        .describe("Lower bound (RFC3339), inclusive"),
      timeMax: z
        .string()
        .optional()
        .describe("Upper bound (RFC3339), exclusive"),
    },
    async (args) => {
      const calendarId = encodeURIComponent(String(args.calendarId ?? "primary"));
      const params = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (typeof args.timeMin === "string") params.set("timeMin", args.timeMin);
      if (typeof args.timeMax === "string") params.set("timeMax", args.timeMax);
      const r = await req(
        `${CALENDAR_BASE}/calendars/${calendarId}/events?${params.toString()}`
      );
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const getEvent = tool(
    "get_event",
    "Get a single calendar event by id.",
    {
      calendarId: z.string().default("primary").describe("Calendar id"),
      eventId: z.string().describe("Event id"),
    },
    async (args) => {
      const calendarId = encodeURIComponent(String(args.calendarId ?? "primary"));
      const eventId = encodeURIComponent(String(args.eventId));
      const r = await req(
        `${CALENDAR_BASE}/calendars/${calendarId}/events/${eventId}`
      );
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const createEvent = tool(
    "create_event",
    "Create a new event on the dedicated AI calendar. Writes to any other calendar are refused by the tool — use exactly the configured AI calendar id (or omit calendarId to default to it).",
    {
      calendarId: z
        .string()
        .optional()
        .describe(
          "Target calendar id; MUST be the configured AI calendar id. May be omitted (defaults to the AI calendar). Any other id is refused."
        ),
      summary: z.string().describe("Event title"),
      description: z.string().optional().describe("Event description"),
      start: z
        .record(z.string(), z.string())
        .describe("Start, e.g. { dateTime: '2026-06-03T10:00:00+02:00' } or { date: '2026-06-03' }"),
      end: z
        .record(z.string(), z.string())
        .describe("End, same shape as start"),
    },
    async (args) => {
      const enforced = enforceAiCalendar(args.calendarId);
      if (!enforced.ok) return enforced.error;
      const calendarId = encodeURIComponent(enforced.calendarId);
      const body: Record<string, unknown> = {
        summary: args.summary,
        start: args.start,
        end: args.end,
      };
      if (typeof args.description === "string") body.description = args.description;
      const r = await req(`${CALENDAR_BASE}/calendars/${calendarId}/events`, {
        method: "POST",
        body,
      });
      return r.ok ? ok(r.data) : fail(r.error);
    }
  );

  const updateEvent = tool(
    "update_event",
    "Partially update an existing event (PATCH) on the dedicated AI calendar. eventId REQUIRED. Writes to any other calendar are refused — use the configured AI calendar id (or omit calendarId to default to it).",
    {
      calendarId: z
        .string()
        .optional()
        .describe(
          "Target calendar id; MUST be the configured AI calendar id. May be omitted (defaults to the AI calendar). Any other id is refused."
        ),
      eventId: z.string().describe("Event id to update (required)"),
      summary: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      start: z.record(z.string(), z.string()).optional().describe("New start"),
      end: z.record(z.string(), z.string()).optional().describe("New end"),
    },
    async (args) => {
      const enforced = enforceAiCalendar(args.calendarId);
      if (!enforced.ok) return enforced.error;
      const calendarId = encodeURIComponent(enforced.calendarId);
      const eventId = encodeURIComponent(String(args.eventId));
      const body: Record<string, unknown> = {};
      if (typeof args.summary === "string") body.summary = args.summary;
      if (typeof args.description === "string") body.description = args.description;
      if (args.start !== undefined) body.start = args.start;
      if (args.end !== undefined) body.end = args.end;
      const r = await req(
        `${CALENDAR_BASE}/calendars/${calendarId}/events/${eventId}`,
        { method: "PATCH", body }
      );
      return r.ok ? ok(r.data) : fail(r.error);
    }
  );

  const deleteEvent = tool(
    "delete_event",
    "Delete an event on the dedicated AI calendar. eventId REQUIRED. Deletes on any other calendar are refused — use the configured AI calendar id (or omit calendarId to default to it).",
    {
      calendarId: z
        .string()
        .optional()
        .describe(
          "Target calendar id; MUST be the configured AI calendar id. May be omitted (defaults to the AI calendar). Any other id is refused."
        ),
      eventId: z.string().describe("Event id to delete (required)"),
    },
    async (args) => {
      const enforced = enforceAiCalendar(args.calendarId);
      if (!enforced.ok) return enforced.error;
      const calendarId = encodeURIComponent(enforced.calendarId);
      const eventId = encodeURIComponent(String(args.eventId));
      const r = await req(
        `${CALENDAR_BASE}/calendars/${calendarId}/events/${eventId}`,
        { method: "DELETE" }
      );
      return r.ok ? ok(r.data) : fail(r.error);
    }
  );

  const calendar = createSdkMcpServer({
    name: "calendar",
    version: "1.0.0",
    tools: [listCalendars, listEvents, getEvent, createEvent, updateEvent, deleteEvent],
  });

  // ---- Gmail tools (read-only) -------------------------------------------

  const listMessages = tool(
    "list_messages",
    "List Gmail message ids matching a query (Gmail search syntax, e.g. label:\"Foo\" newer_than:14d).",
    {
      q: z.string().optional().describe("Gmail search query"),
    },
    async (args) => {
      const params = new URLSearchParams();
      if (typeof args.q === "string") params.set("q", args.q);
      const qs = params.toString();
      const r = await req(
        `${GMAIL_BASE}/users/me/messages${qs ? `?${qs}` : ""}`
      );
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const getMessage = tool(
    "get_message",
    "Get a single Gmail message by id (full format: headers + body).",
    {
      id: z.string().describe("Gmail message id"),
    },
    async (args) => {
      const id = encodeURIComponent(String(args.id));
      const r = await req(
        `${GMAIL_BASE}/users/me/messages/${id}?format=full`
      );
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const listLabels = tool(
    "list_labels",
    "List all Gmail labels (id + name).",
    {},
    async () => {
      const r = await req(`${GMAIL_BASE}/users/me/labels`);
      return r.ok ? ok(r.data) : fail(r.error);
    },
    READ_ONLY
  );

  const gmail = createSdkMcpServer({
    name: "gmail",
    version: "1.0.0",
    tools: [listMessages, getMessage, listLabels],
  });

  return { calendar, gmail };
}
