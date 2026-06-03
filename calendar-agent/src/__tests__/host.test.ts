import { CalendarAgentHost, SdkQueryFn, SdkMessage } from "../host";
import { QueueUserMessage } from "../messageQueue";
import { GoogleTokenManager } from "../googleAuth";
import {
  GOOGLE_CALENDAR_MCP_URL,
  GOOGLE_GMAIL_MCP_URL,
  McpServerConfig,
} from "../config";

const STUB_PROMPT = "stub system prompt";

/**
 * A fake SDK `query()` that records the options it was called with and then
 * faithfully drains the provided prompt async-iterable — exactly like the real
 * SDK, the returned stream only ends when the input iterator ends (queue
 * closed). This lets us assert that the session stays alive across pushes.
 */
function makeFakeQuery(): {
  query: SdkQueryFn;
  lastOptions: () => Record<string, unknown> | undefined;
  receivedContents: string[];
} {
  let captured: Record<string, unknown> | undefined;
  const receivedContents: string[] = [];

  const query: SdkQueryFn = ({ prompt, options }) => {
    captured = options as Record<string, unknown>;
    async function* gen(): AsyncGenerator<SdkMessage> {
      for await (const m of prompt as AsyncIterable<QueueUserMessage>) {
        receivedContents.push(m.message.content);
        // Emit a synthetic assistant result for each input.
        yield { type: "assistant", message: { content: "ok" } };
        yield { type: "result", subtype: "success" };
      }
    }
    return gen();
  };

  return { query, lastOptions: () => captured, receivedContents };
}

describe("CalendarAgentHost", () => {
  it("imports", () => {
    expect(typeof CalendarAgentHost).toBe("function");
  });

  it("AC#1: passes the configured MCP servers + prompt into the SDK on start", async () => {
    const fake = makeFakeQuery();
    const host = new CalendarAgentHost({
      config: {
        mcpServers: {
          whatsapp: { command: "whatsapp-mcp" },
          gmail: { type: "http", url: "http://localhost:5002" },
        },
        model: "claude-test",
      },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
    });

    expect(host.configuredMcpServers().sort()).toEqual(["gmail", "whatsapp"]);

    await host.start();

    const opts = fake.lastOptions()!;
    expect(Object.keys(opts.mcpServers as object).sort()).toEqual([
      "gmail",
      "whatsapp",
    ]);
    expect(opts.systemPrompt).toBe(STUB_PROMPT);
    expect(opts.model).toBe("claude-test");

    await host.stop();
  });

  it("AC#2: session stays alive after a reasoning pass instead of ending", async () => {
    const fake = makeFakeQuery();
    const host = new CalendarAgentHost({
      config: { mcpServers: {} },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
    });

    await host.start();
    expect(host.isSessionAlive()).toBe(true);
    expect(host.getStatus()).toBe("running");

    // First pass.
    host.submit("review whitelist item A");
    await flush();
    expect(fake.receivedContents).toContain("review whitelist item A");

    // The session must NOT have ended after handling the first message.
    expect(host.isSessionAlive()).toBe(true);

    // Simulate an escalation: host waits for approval, session still alive.
    host.markWaitingForApproval();
    expect(host.getStatus()).toBe("waiting_for_approval");
    expect(host.isSessionAlive()).toBe(true);

    // Later input (e.g. the approval) is accepted by the still-open session.
    host.submit("approved");
    await flush();
    expect(fake.receivedContents).toContain("approved");
    expect(host.isSessionAlive()).toBe(true);

    // Only an explicit stop ends it.
    await host.stop();
    expect(host.getStatus()).toBe("stopped");
    expect(host.isSessionAlive()).toBe(false);
  });

  it("injects the Google bearer header + wildcard allowedTools before query()", async () => {
    const fake = makeFakeQuery();
    const tokenMgr = new GoogleTokenManager({
      credentials: { client_id: "c", client_secret: "s", refresh_token: "r" },
      fetchToken: async () => ({ access_token: "ACCESS-XYZ", expires_in: 3600 }),
    });
    const host = new CalendarAgentHost({
      config: {
        mcpServers: {
          calendar: {
            type: "http",
            url: GOOGLE_CALENDAR_MCP_URL,
            google: true,
            scopes: ["https://www.googleapis.com/auth/calendar.events"],
          },
          gmail: {
            type: "http",
            url: GOOGLE_GMAIL_MCP_URL,
            google: true,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          },
          whatsapp: { command: "/home/tom/.local/bin/uv", args: ["run"] },
        },
      },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      googleTokenManager: tokenMgr,
    });

    await host.start();

    const opts = fake.lastOptions()!;
    const servers = opts.mcpServers as Record<string, McpServerConfig>;
    const cal = servers.calendar as unknown as Record<string, unknown>;
    const gmail = servers.gmail as unknown as Record<string, unknown>;
    expect((cal.headers as Record<string, string>).Authorization).toBe(
      "Bearer ACCESS-XYZ"
    );
    expect((gmail.headers as Record<string, string>).Authorization).toBe(
      "Bearer ACCESS-XYZ"
    );
    // marker fields stripped before reaching the SDK
    expect(cal.google).toBeUndefined();
    expect(cal.scopes).toBeUndefined();
    // whatsapp stdio entry untouched (no Authorization)
    expect(servers.whatsapp).toMatchObject({
      command: "/home/tom/.local/bin/uv",
    });

    const allowed = opts.allowedTools as string[];
    expect(allowed.sort()).toEqual([
      "mcp__calendar__*",
      "mcp__gmail__*",
      "mcp__whatsapp__*",
    ]);

    await host.stop();
  });

  it("does not fetch a Google token when no Google server is configured", async () => {
    const fake = makeFakeQuery();
    let fetched = false;
    const tokenMgr = new GoogleTokenManager({
      credentials: { client_id: "c", client_secret: "s", refresh_token: "r" },
      fetchToken: async () => {
        fetched = true;
        return { access_token: "x", expires_in: 3600 };
      },
    });
    const host = new CalendarAgentHost({
      config: { mcpServers: { whatsapp: { command: "uv" } } },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      googleTokenManager: tokenMgr,
    });
    await host.start();
    expect(fetched).toBe(false);
    expect((fake.lastOptions()!.allowedTools as string[])).toEqual([
      "mcp__whatsapp__*",
    ]);
    await host.stop();
  });

  it("AC#3: filterInputs gates inputs through the configured whitelist", () => {
    const host = new CalendarAgentHost({
      config: {
        mcpServers: {},
        whitelist: {
          whatsapp: { groups: ["Family"] },
          gmail: { senders: ["@daktela.com"], labels: [] },
        },
      },
      queryFn: makeFakeQuery().query,
      systemPrompt: STUB_PROMPT,
    });

    const kept = host.filterInputs([
      { source: "whatsapp", group: "Family", text: "keep" },
      { source: "whatsapp", group: "Random", text: "drop" },
      { source: "gmail", from: "x@daktela.com", subject: "keep" },
      { source: "gmail", from: "spam@evil.com", subject: "drop" },
    ]);

    expect(kept).toHaveLength(2);
    expect(host.whitelist().whatsapp.groups).toEqual(["Family"]);
  });

  it("defaults to a deny-all whitelist when config omits one", () => {
    const host = new CalendarAgentHost({
      config: { mcpServers: {} },
      queryFn: makeFakeQuery().query,
      systemPrompt: STUB_PROMPT,
    });
    expect(
      host.filterInputs([{ source: "whatsapp", group: "Family", text: "x" }])
    ).toEqual([]);
  });
});

/** Let the host's background drain loop process queued messages. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}
