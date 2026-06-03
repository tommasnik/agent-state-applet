import { CalendarAgentHost, SdkQueryFn, SdkMessage } from "../host";
import { QueueUserMessage } from "../messageQueue";
import { ApprovalBridge, BridgeSocket } from "../bridge";

const STUB_PROMPT = "stub system prompt";

/**
 * Fake SDK query mirroring the real streaming contract: the returned stream
 * only ends when the prompt iterator ends (queue closed). For each input it
 * records the content. When it sees a continuation prompt that looks like an
 * approval answer, it emits a synthetic tool-use message for the calendar
 * write tool — this is how we exercise AC#3 (the session proceeds toward a
 * calendar write) without touching real Google Calendar / OAuth.
 */
function makeFakeQuery(calendarWriteTool = "mcp__google-calendar__create_event") {
  const receivedContents: string[] = [];
  const toolCalls: string[] = [];

  const query: SdkQueryFn = ({ prompt }) => {
    async function* gen(): AsyncGenerator<SdkMessage> {
      for await (const m of prompt as AsyncIterable<QueueUserMessage>) {
        const content = m.message.content;
        receivedContents.push(content);
        // Any input after an escalation answer triggers the calendar write.
        if (content.includes("ANSWER:")) {
          const tn = calendarWriteTool;
          toolCalls.push(tn);
          yield {
            type: "assistant",
            message: { content: [{ type: "tool_use", name: tn }] },
          };
        }
        yield { type: "result", subtype: "success" };
      }
    }
    return gen();
  };

  return { query, receivedContents, toolCalls };
}

/** A fake socket the test drives directly (server→client answers). */
class FakeSocket implements BridgeSocket {
  handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  on(event: string, cb: (arg?: unknown) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  close(): void {}
  open(): void {
    (this.handlers["open"] ?? []).forEach((h) => h());
  }
  emitMessage(obj: unknown): void {
    const data = JSON.stringify(obj);
    (this.handlers["message"] ?? []).forEach((h) => h(data));
  }
  emitClose(): void {
    (this.handlers["close"] ?? []).forEach((h) => h());
  }
}

/** A host that records SDK tool-use messages so the test can assert on them. */
class RecordingHost extends CalendarAgentHost {
  readonly seenTools: string[] = [];
  protected onMessage(msg: SdkMessage): void {
    if (msg.type === "assistant") {
      const message = msg.message as { content?: unknown } | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const part of content as Array<{ type?: string; name?: string }>) {
          if (part.type === "tool_use" && part.name) {
            this.seenTools.push(part.name);
          }
        }
      }
    }
  }
}

function flush(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("streaming input bridge ↔ host (TASK-32)", () => {
  it("AC#1: session blocks on input after escalation instead of ending", async () => {
    const fake = makeFakeQuery();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 100 }),
    });
    bridge.connect();
    sockets[0].open();

    const host = new RecordingHost({
      config: { mcpServers: {} },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      bridge,
      disableGoogle: true,
    });
    await host.start();

    // Kick off escalation; do NOT answer yet.
    const escalation = host.escalate({ payload: { action: "create_event" } });
    await flush();

    // Session must be parked in waiting_for_approval and still alive.
    expect(host.getStatus()).toBe("waiting_for_approval");
    expect(host.isSessionAlive()).toBe(true);
    expect(bridge.pendingCount).toBe(1);

    // Deliver the answer so the dangling promise resolves and we can clean up.
    sockets[0].emitMessage({ event: "approval_answer", id: 100, answer: "ANSWER: yes" });
    await escalation;
    await host.stop();
  });

  it("AC#2 + AC#3: answer is delivered to the live session, which continues and writes the event", async () => {
    const fake = makeFakeQuery();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 200 }),
    });
    bridge.connect();
    sockets[0].open();

    const host = new RecordingHost({
      config: { mcpServers: {} },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      bridge,
      disableGoogle: true,
    });
    await host.start();

    const escalation = host.escalate({ payload: { action: "create_event" } });
    await flush();
    expect(host.getStatus()).toBe("waiting_for_approval");

    // Server pushes the user's answer (correlated by approval id 200).
    sockets[0].emitMessage({
      event: "approval_answer",
      id: 200,
      answer: "ANSWER: create it at 14:00",
    });

    const delivered = await escalation;
    expect(delivered).toBe("ANSWER: create it at 14:00");

    // AC#2: the answer reached the live session's input stream.
    await flush();
    expect(fake.receivedContents).toContain("ANSWER: create it at 14:00");
    // AC#2: session resumed.
    expect(host.getStatus()).toBe("running");
    expect(host.isSessionAlive()).toBe(true);

    // AC#3 (mechanics): after the answer the session proceeds to a calendar
    // write tool call. Real Google Calendar write needs live OAuth (TASK-29).
    expect(fake.toolCalls).toContain("mcp__google-calendar__create_event");
    expect(host.seenTools).toContain("mcp__google-calendar__create_event");

    await host.stop();
  });

  it("AC#4: on answer timeout the host logs the loss and unblocks (session stays alive)", async () => {
    jest.useFakeTimers();
    const fake = makeFakeQuery();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      answerTimeoutMs: 500,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 300 }),
    });
    bridge.connect();
    sockets[0].open();

    const host = new RecordingHost({
      config: { mcpServers: {} },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      bridge,
      disableGoogle: true,
    });
    await host.start();

    const escalation = host.escalate({ payload: {} });
    // flush microtasks so registerAndWait sets up the pending entry
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(500);

    await expect(escalation).rejects.toMatchObject({ name: "ApprovalTimeoutError" });
    // Session is not killed by a timeout — it returns to running and stays alive.
    expect(host.getStatus()).toBe("running");
    expect(host.isSessionAlive()).toBe(true);

    jest.useRealTimers();
    await host.stop();
  });

  it("AC#4: on connection loss the escalation fails with a defined error", async () => {
    const fake = makeFakeQuery();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      maxReconnects: 0,
      reconnectDelayMs: 0,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 400 }),
    });
    bridge.connect();
    sockets[0].open();

    const host = new RecordingHost({
      config: { mcpServers: {} },
      queryFn: fake.query,
      systemPrompt: STUB_PROMPT,
      bridge,
      disableGoogle: true,
    });
    await host.start();

    const escalation = host.escalate({ payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    sockets[0].emitClose();

    await expect(escalation).rejects.toMatchObject({
      name: "BridgeConnectionLostError",
    });
    expect(host.getStatus()).toBe("running");
    expect(host.isSessionAlive()).toBe(true);

    await host.stop();
  });
});
