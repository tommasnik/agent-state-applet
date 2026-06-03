import { buildGoogleMcpServers, ToolResult } from "../googleTools";
import { GoogleTokenManager } from "../googleAuth";

/**
 * Captured tool definition so a test can invoke a handler directly and assert
 * the HTTP request it makes.
 */
interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  annotations?: Record<string, unknown>;
}

const captured: { calendar: CapturedTool[]; gmail: CapturedTool[] } = {
  calendar: [],
  gmail: [],
};
let currentServerName = "";

// Mock the ESM-only SDK so buildGoogleMcpServers' dynamic import resolves to a
// stub that records tool definitions instead of touching the real SDK.
jest.mock(
  "@anthropic-ai/claude-agent-sdk",
  () => ({
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<ToolResult>,
      extra?: { annotations?: Record<string, unknown> }
    ) => {
      return {
        name,
        description,
        schema,
        handler,
        annotations: extra?.annotations,
      } as CapturedTool;
    },
    createSdkMcpServer: (opts: { name: string; tools: CapturedTool[] }) => {
      if (opts.name === "calendar") captured.calendar = opts.tools;
      if (opts.name === "gmail") captured.gmail = opts.tools;
      currentServerName = opts.name;
      void currentServerName;
      return { name: opts.name, tools: opts.tools };
    },
  }),
  { virtual: true }
);

/** A token manager that never hits the network. */
function stubTokenManager(token = "TEST-TOKEN"): GoogleTokenManager {
  return new GoogleTokenManager({
    credentials: { client_id: "c", client_secret: "s", refresh_token: "r" },
    fetchToken: async () => ({ access_token: token, expires_in: 3600 }),
  });
}

/** Build a fetch stub recording calls and returning a canned response. */
function makeFetch(opts: {
  status?: number;
  body?: unknown;
  bodyText?: string;
}): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const status = opts.status ?? 200;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "ERR",
      json: async () =>
        opts.body !== undefined ? opts.body : JSON.parse(opts.bodyText ?? "{}"),
      text: async () =>
        opts.bodyText ?? (opts.body !== undefined ? JSON.stringify(opts.body) : ""),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function tool(group: "calendar" | "gmail", name: string): CapturedTool {
  const t = captured[group].find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${group}/${name}`);
  return t;
}

beforeEach(() => {
  captured.calendar = [];
  captured.gmail = [];
});

describe("googleTools / in-process Google MCP servers", () => {
  it("builds calendar + gmail servers with the expected tools", async () => {
    const { fetchImpl } = makeFetch({ body: {} });
    const servers = await buildGoogleMcpServers({
      tokenManager: stubTokenManager(),
      fetchImpl,
    });
    expect((servers.calendar as { name: string }).name).toBe("calendar");
    expect((servers.gmail as { name: string }).name).toBe("gmail");

    expect(captured.calendar.map((t) => t.name).sort()).toEqual([
      "create_event",
      "delete_event",
      "get_event",
      "list_calendars",
      "list_events",
      "update_event",
    ]);
    expect(captured.gmail.map((t) => t.name).sort()).toEqual([
      "get_message",
      "list_labels",
      "list_messages",
    ]);
  });

  it("marks read tools readOnlyHint and write tools NOT read-only", async () => {
    const { fetchImpl } = makeFetch({ body: {} });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });

    for (const name of ["list_calendars", "list_events", "get_event"]) {
      expect(tool("calendar", name).annotations?.readOnlyHint).toBe(true);
    }
    for (const name of ["create_event", "update_event", "delete_event"]) {
      expect(tool("calendar", name).annotations?.readOnlyHint).toBeUndefined();
    }
    for (const name of ["list_messages", "get_message", "list_labels"]) {
      expect(tool("gmail", name).annotations?.readOnlyHint).toBe(true);
    }
  });

  it("list_calendars: GETs calendarList with the bearer token", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { items: [{ id: "primary" }] } });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager("TOK"), fetchImpl });

    const res = await tool("calendar", "list_calendars").handler({});
    expect(res.isError).toBeUndefined();
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    );
    expect((calls[0].init as { method: string }).method).toBe("GET");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization
    ).toBe("Bearer TOK");
    expect(JSON.parse(res.content[0].text)).toEqual({ items: [{ id: "primary" }] });
  });

  it("list_events: builds the query string + encodes calendarId", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { items: [] } });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });

    await tool("calendar", "list_events").handler({
      calendarId: "ai cal@group.calendar.google.com",
      timeMin: "2026-06-01T00:00:00Z",
      timeMax: "2026-06-30T00:00:00Z",
    });
    const url = calls[0].url;
    expect(url).toContain(
      "/calendars/ai%20cal%40group.calendar.google.com/events?"
    );
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(url).toContain("timeMin=2026-06-01T00%3A00%3A00Z");
    expect(url).toContain("timeMax=2026-06-30T00%3A00%3A00Z");
  });

  it("create_event: POSTs the JSON body to the right calendar", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
    await buildGoogleMcpServers({
      tokenManager: stubTokenManager(),
      fetchImpl,
      aiCalendarId: "aiCalId",
    });

    const res = await tool("calendar", "create_event").handler({
      calendarId: "aiCalId",
      summary: "Meeting",
      description: "desc",
      start: { dateTime: "2026-06-03T10:00:00+02:00" },
      end: { dateTime: "2026-06-03T11:00:00+02:00" },
    });
    expect(res.isError).toBeUndefined();
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/aiCalId/events"
    );
    const init = calls[0].init as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      summary: "Meeting",
      description: "desc",
      start: { dateTime: "2026-06-03T10:00:00+02:00" },
      end: { dateTime: "2026-06-03T11:00:00+02:00" },
    });
  });

  it("update_event: PATCHes only the provided fields", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
    await buildGoogleMcpServers({
      tokenManager: stubTokenManager(),
      fetchImpl,
      aiCalendarId: "aiCalId",
    });

    await tool("calendar", "update_event").handler({
      calendarId: "aiCalId",
      eventId: "evt1",
      summary: "New title",
    });
    const init = calls[0].init as { method: string; body: string };
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/aiCalId/events/evt1"
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ summary: "New title" });
  });

  it("delete_event: DELETEs and tolerates a 204 empty body", async () => {
    const { fetchImpl, calls } = makeFetch({ status: 204 });
    await buildGoogleMcpServers({
      tokenManager: stubTokenManager(),
      fetchImpl,
      aiCalendarId: "aiCalId",
    });

    const res = await tool("calendar", "delete_event").handler({
      calendarId: "aiCalId",
      eventId: "evt1",
    });
    expect(res.isError).toBeUndefined();
    expect((calls[0].init as { method: string }).method).toBe("DELETE");
    expect(JSON.parse(res.content[0].text)).toEqual({ success: true });
  });

  it("gmail list_messages: GETs with the q query", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { messages: [] } });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });

    await tool("gmail", "list_messages").handler({
      q: 'label:"Škola Slunovrat" newer_than:14d',
    });
    expect(calls[0].url).toContain(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q="
    );
    const parsed = new URL(calls[0].url);
    expect(parsed.searchParams.get("q")).toBe(
      'label:"Škola Slunovrat" newer_than:14d'
    );
  });

  it("gmail get_message: requests full format", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { id: "m1" } });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });
    await tool("gmail", "get_message").handler({ id: "m1" });
    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=full"
    );
  });

  it("returns isError (does NOT throw) on a non-2xx response", async () => {
    const { fetchImpl } = makeFetch({
      status: 403,
      bodyText: "The caller does not have permission",
    });
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });

    const res = await tool("calendar", "list_calendars").handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("403");
    expect(res.content[0].text).toContain("does not have permission");
  });

  it("returns isError (does NOT throw) when fetch itself rejects", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await buildGoogleMcpServers({ tokenManager: stubTokenManager(), fetchImpl });

    const res = await tool("gmail", "list_labels").handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("network down");
  });

  it("returns isError when the token cannot be obtained", async () => {
    const failingMgr = new GoogleTokenManager({
      credentials: { client_id: "c", client_secret: "s", refresh_token: "r" },
      fetchToken: async () => {
        throw new Error("token endpoint 400");
      },
    });
    const { fetchImpl } = makeFetch({ body: {} });
    await buildGoogleMcpServers({ tokenManager: failingMgr, fetchImpl });

    const res = await tool("calendar", "list_calendars").handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("token");
  });
});

describe("googleTools / AI calendar hard enforcement (TASK-29)", () => {
  const AI_CAL = "ai@group.calendar.google.com";
  const writeArgs = {
    create_event: {
      summary: "X",
      start: { dateTime: "2026-06-03T10:00:00+02:00" },
      end: { dateTime: "2026-06-03T11:00:00+02:00" },
    },
    update_event: { eventId: "evt1", summary: "X" },
    delete_event: { eventId: "evt1" },
  } as const;

  for (const name of ["create_event", "update_event", "delete_event"] as const) {
    it(`${name}: writes when calendarId === aiCalendarId`, async () => {
      const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
      await buildGoogleMcpServers({
        tokenManager: stubTokenManager(),
        fetchImpl,
        aiCalendarId: AI_CAL,
      });
      const res = await tool("calendar", name).handler({
        calendarId: AI_CAL,
        ...writeArgs[name],
      });
      expect(res.isError).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(encodeURIComponent(AI_CAL));
    });

    it(`${name}: defaults to aiCalendarId when calendarId is omitted`, async () => {
      const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
      await buildGoogleMcpServers({
        tokenManager: stubTokenManager(),
        fetchImpl,
        aiCalendarId: AI_CAL,
      });
      const res = await tool("calendar", name).handler({ ...writeArgs[name] });
      expect(res.isError).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(encodeURIComponent(AI_CAL));
    });

    it(`${name}: REFUSES a foreign calendarId without any fetch`, async () => {
      const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
      await buildGoogleMcpServers({
        tokenManager: stubTokenManager(),
        fetchImpl,
        aiCalendarId: AI_CAL,
      });
      const res = await tool("calendar", name).handler({
        calendarId: "personal@example.com",
        ...writeArgs[name],
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Refused");
      expect(res.content[0].text).toContain(AI_CAL);
      expect(res.content[0].text).toContain("personal@example.com");
      expect(calls).toHaveLength(0);
    });

    it(`${name}: REFUSES all writes when aiCalendarId is unset (no fetch)`, async () => {
      const { fetchImpl, calls } = makeFetch({ body: { id: "evt1" } });
      await buildGoogleMcpServers({
        tokenManager: stubTokenManager(),
        fetchImpl,
        // aiCalendarId intentionally omitted
      });
      const res = await tool("calendar", name).handler({
        calendarId: AI_CAL,
        ...writeArgs[name],
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("no AI calendar configured");
      expect(calls).toHaveLength(0);
    });
  }

  it("read tools are NOT restricted by aiCalendarId", async () => {
    const { fetchImpl, calls } = makeFetch({ body: { items: [] } });
    await buildGoogleMcpServers({
      tokenManager: stubTokenManager(),
      fetchImpl,
      aiCalendarId: AI_CAL,
    });
    // list_events on a DIFFERENT calendar still fetches (conflict detection).
    const res = await tool("calendar", "list_events").handler({
      calendarId: "someone-else@example.com",
    });
    expect(res.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(encodeURIComponent("someone-else@example.com"));
  });
});
