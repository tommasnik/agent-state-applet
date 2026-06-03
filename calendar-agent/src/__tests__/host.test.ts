import { CalendarAgentHost, SdkQueryFn, SdkMessage } from "../host";
import { QueueUserMessage } from "../messageQueue";
import { GoogleMcpServers } from "../googleTools";

const STUB_PROMPT = "stub system prompt";

/** Stub in-process Google MCP servers (avoids loading the ESM SDK in tests). */
const STUB_GOOGLE: GoogleMcpServers = {
  calendar: { name: "calendar" },
  gmail: { name: "gmail" },
};

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

  it("AC#1: merges native Google servers with the configured stdio server + prompt", async () => {
    const fake = makeFakeQuery();
    const host = new CalendarAgentHost({
      config: {
        mcpServers: {
          whatsapp: { command: "whatsapp-mcp" },
        },
        model: "claude-test",
      },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      googleMcpServers: STUB_GOOGLE,
    });

    expect(host.configuredMcpServers().sort()).toEqual([
      "calendar",
      "gmail",
      "whatsapp",
    ]);

    await host.start();

    const opts = fake.lastOptions()!;
    expect(Object.keys(opts.mcpServers as object).sort()).toEqual([
      "calendar",
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
      disableGoogle: true,
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

  it("wires the in-process Google servers + wildcard allowedTools (calendar/gmail/whatsapp)", async () => {
    const fake = makeFakeQuery();
    const host = new CalendarAgentHost({
      config: {
        mcpServers: {
          whatsapp: { command: "/home/tom/.local/bin/uv", args: ["run"] },
        },
      },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      googleMcpServers: STUB_GOOGLE,
    });

    await host.start();

    const opts = fake.lastOptions()!;
    const servers = opts.mcpServers as Record<string, unknown>;
    // Native Google servers are the in-process SDK servers, not http configs.
    expect(servers.calendar).toBe(STUB_GOOGLE.calendar);
    expect(servers.gmail).toBe(STUB_GOOGLE.gmail);
    // whatsapp stdio entry passed through untouched.
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

  it("disableGoogle wires only the configured stdio servers", async () => {
    const fake = makeFakeQuery();
    const host = new CalendarAgentHost({
      config: { mcpServers: { whatsapp: { command: "uv" } } },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      disableGoogle: true,
    });
    await host.start();
    const opts = fake.lastOptions()!;
    expect(Object.keys(opts.mcpServers as object)).toEqual(["whatsapp"]);
    expect(opts.allowedTools as string[]).toEqual(["mcp__whatsapp__*"]);
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
      disableGoogle: true,
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
      disableGoogle: true,
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
