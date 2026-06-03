import {
  ApprovalBridge,
  ApprovalTimeoutError,
  BridgeConnectionLostError,
  BridgeSocket,
  BridgeLogger,
} from "../bridge";

/**
 * A fake WS socket that lets the test drive the server→client direction by
 * calling `emitMessage`, and simulate disconnects via `emitClose`.
 */
class FakeSocket implements BridgeSocket {
  handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  closed = false;

  on(event: string, cb: (arg?: unknown) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  close(): void {
    this.closed = true;
  }

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

function makeLogger(): BridgeLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info:${m}`),
    warn: (m) => lines.push(`warn:${m}`),
    error: (m) => lines.push(`error:${m}`),
  };
}

describe("ApprovalBridge", () => {
  it("registers an approval and resolves with the answer delivered over WS", async () => {
    const sockets: FakeSocket[] = [];
    const httpPost = jest.fn().mockResolvedValue({ id: 42 });
    const bridge = new ApprovalBridge({
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost,
    });
    bridge.connect();
    sockets[0].open();
    expect(bridge.isConnected()).toBe(true);

    const waiting = bridge.registerAndWait({ payload: { action: "create" } });
    // let the POST resolve and the pending entry register
    await Promise.resolve();
    await Promise.resolve();
    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/approvals"),
      expect.objectContaining({ payload: { action: "create" } })
    );
    expect(bridge.pendingCount).toBe(1);

    // Server pushes the answer correlated by id.
    sockets[0].emitMessage({
      event: "approval_answer",
      id: 42,
      answer: "yes, 14:00",
    });

    await expect(waiting).resolves.toBe("yes, 14:00");
    expect(bridge.pendingCount).toBe(0);
  });

  it("ignores answer events for approval ids it does not own", async () => {
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 1 }),
    });
    bridge.connect();
    sockets[0].open();
    const waiting = bridge.registerAndWait({ payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    // Answer for a different approval — must NOT resolve ours.
    sockets[0].emitMessage({ event: "approval_answer", id: 999, answer: "no" });
    expect(bridge.pendingCount).toBe(1);

    sockets[0].emitMessage({ event: "approval_answer", id: 1, answer: "ours" });
    await expect(waiting).resolves.toBe("ours");
  });

  it("AC#4: rejects with ApprovalTimeoutError after the configured timeout", async () => {
    jest.useFakeTimers();
    const log = makeLogger();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      answerTimeoutMs: 1000,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 7 }),
      logger: log,
    });
    bridge.connect();
    sockets[0].open();
    const waiting = bridge.registerAndWait({ payload: {} });
    // flush the await chain inside registerAndWait
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.pendingCount).toBe(1);

    jest.advanceTimersByTime(1000);
    await expect(waiting).rejects.toBeInstanceOf(ApprovalTimeoutError);
    expect(log.lines.some((l) => l.startsWith("warn:") && l.includes("timed out"))).toBe(
      true
    );
    expect(bridge.pendingCount).toBe(0);
    jest.useRealTimers();
  });

  it("AC#4: reconnects on WS loss and logs the loss", async () => {
    const log = makeLogger();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      maxReconnects: 2,
      reconnectDelayMs: 0,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 1 }),
      logger: log,
    });
    bridge.connect();
    sockets[0].open();

    // Simulate a disconnect; bridge should log + schedule a reconnect.
    sockets[0].emitClose();
    expect(bridge.isConnected()).toBe(false);
    // wait for the 0ms reconnect timer
    await new Promise((r) => setTimeout(r, 5));
    expect(sockets.length).toBe(2); // reconnected
    expect(log.lines.some((l) => l.includes("reconnect attempt 1"))).toBe(true);
  });

  it("AC#4: fails pending approvals after exhausting reconnects", async () => {
    const log = makeLogger();
    const sockets: FakeSocket[] = [];
    const bridge = new ApprovalBridge({
      maxReconnects: 0,
      reconnectDelayMs: 0,
      wsFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      httpPost: jest.fn().mockResolvedValue({ id: 5 }),
      logger: log,
    });
    bridge.connect();
    sockets[0].open();
    const waiting = bridge.registerAndWait({ payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    sockets[0].emitClose();
    await expect(waiting).rejects.toBeInstanceOf(BridgeConnectionLostError);
    expect(log.lines.some((l) => l.startsWith("error:") && l.includes("gave up"))).toBe(
      true
    );
  });
});
