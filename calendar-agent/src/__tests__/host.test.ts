import { CalendarAgentHost, SdkQueryFn, SdkMessage } from "../host";
import { QueueUserMessage } from "../messageQueue";

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
});

/** Let the host's background drain loop process queued messages. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}
