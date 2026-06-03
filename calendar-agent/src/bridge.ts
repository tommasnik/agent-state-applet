/**
 * Streaming input bridge (TASK-32).
 *
 * This is the channel that turns a user's answer in the server's approval queue
 * into a *continuation prompt* fed back into the live Agent SDK session.
 *
 * Flow:
 *   1. The agent escalates → `registerApproval()` POSTs to the server's
 *      `/api/approvals` (TASK-31) and remembers the returned approval `id`.
 *   2. The session goes to `waiting_for_approval` and parks on the MessageQueue
 *      (it does NOT end — see messageQueue.ts).
 *   3. The user answers via `POST /api/approvals/:id/answer`; the server pushes
 *      an `approval_answer` WebSocket event correlated by `id`.
 *   4. This bridge (a WS client) receives that event, matches it to a pending
 *      approval `id`, and delivers the answer text back to the host's queue as
 *      a continuation prompt. The session resumes (`running`).
 *
 * Correlation is purely by approval `id`. The host registers an approval, keeps
 * the id, and the bridge routes the matching answer event to the registered
 * callback.
 *
 * Transport is injectable so tests never touch a real socket or HTTP server:
 *   - `wsFactory` builds the WS client (defaults to the `ws` package).
 *   - `httpPost` performs the approval registration POST (defaults to fetch).
 *
 * Edge cases (AC#4):
 *   - WS connection loss while waiting → logged; the bridge attempts a bounded
 *     number of reconnects, then surfaces a defined failure to pending waiters.
 *   - Answer timeout → each pending approval has a configurable timeout; on
 *     expiry the waiter is rejected with a TimeoutError and the loss is logged.
 *     (The host decides what to do with that — MVP logs and unblocks.)
 */

/** Minimal structural type of a WS client (matches the `ws` package). */
export interface BridgeSocket {
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  close(): void;
}

export type WsFactory = (url: string) => BridgeSocket;

/** Performs the approval-registration POST; returns the created approval id. */
export type HttpPostFn = (
  url: string,
  body: unknown
) => Promise<{ id: number }>;

/** Logger surface (defaults to console); injectable so tests can assert logs. */
export interface BridgeLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ApprovalRegistration {
  /** run_id this escalation belongs to (optional). */
  runId?: number | null;
  /** session_id this escalation belongs to (optional). */
  sessionId?: string | null;
  /** Proposed action + uncertainty + sources — any JSON-serializable value. */
  payload: unknown;
}

export interface BridgeOptions {
  /** Base URL of the server, e.g. http://127.0.0.1:7855. */
  serverUrl?: string;
  /** WebSocket URL of the server, e.g. ws://127.0.0.1:7855/ws. */
  wsUrl?: string;
  /** Per-approval answer timeout in ms (AC#4). Default 5 min. */
  answerTimeoutMs?: number;
  /** Max reconnect attempts on WS loss (AC#4). Default 5. */
  maxReconnects?: number;
  /** Delay between reconnect attempts in ms. Default 1000. */
  reconnectDelayMs?: number;
  wsFactory?: WsFactory;
  httpPost?: HttpPostFn;
  logger?: BridgeLogger;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:7855";
const DEFAULT_WS_URL = "ws://127.0.0.1:7855/ws";
const DEFAULT_ANSWER_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RECONNECTS = 5;
const DEFAULT_RECONNECT_DELAY_MS = 1000;

/** Raised when an approval is not answered within `answerTimeoutMs`. */
export class ApprovalTimeoutError extends Error {
  constructor(public readonly approvalId: number) {
    super(`Approval ${approvalId} timed out waiting for an answer`);
    this.name = "ApprovalTimeoutError";
  }
}

/** Raised when the WS connection is lost and cannot be recovered. */
export class BridgeConnectionLostError extends Error {
  constructor(public readonly approvalId: number) {
    super(
      `Connection to server lost; approval ${approvalId} answer cannot be delivered`
    );
    this.name = "BridgeConnectionLostError";
  }
}

interface Pending {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultWsFactory(url: string): BridgeSocket {
  // Lazy require so the rest of the package stays usable (and testable) without
  // the `ws` native dependency being touched.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WebSocket = require("ws") as new (url: string) => BridgeSocket;
  return new WebSocket(url);
}

const defaultHttpPost: HttpPostFn = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status}`);
  }
  return (await res.json()) as { id: number };
};

const defaultLogger: BridgeLogger = {
  info: (m) => console.log(`[calendar-agent:bridge] ${m}`),
  warn: (m) => console.warn(`[calendar-agent:bridge] ${m}`),
  error: (m) => console.error(`[calendar-agent:bridge] ${m}`),
};

export class ApprovalBridge {
  private readonly serverUrl: string;
  private readonly wsUrl: string;
  private readonly answerTimeoutMs: number;
  private readonly maxReconnects: number;
  private readonly reconnectDelayMs: number;
  private readonly wsFactory: WsFactory;
  private readonly httpPost: HttpPostFn;
  private readonly log: BridgeLogger;

  private socket: BridgeSocket | null = null;
  private connected = false;
  private reconnects = 0;
  private closed = false;
  private readonly pending = new Map<number, Pending>();

  constructor(opts: BridgeOptions = {}) {
    this.serverUrl = opts.serverUrl ?? DEFAULT_SERVER_URL;
    this.wsUrl = opts.wsUrl ?? DEFAULT_WS_URL;
    this.answerTimeoutMs = opts.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;
    this.maxReconnects = opts.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.wsFactory = opts.wsFactory ?? defaultWsFactory;
    this.httpPost = opts.httpPost ?? defaultHttpPost;
    this.log = opts.logger ?? defaultLogger;
  }

  /** Whether the WS connection is currently open. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Number of approvals currently awaiting an answer. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Connect (or reconnect) the WS client to the server. */
  connect(): void {
    if (this.closed) throw new Error("Bridge is closed");
    const sock = this.wsFactory(this.wsUrl);
    this.socket = sock;

    sock.on("open", () => {
      this.connected = true;
      this.reconnects = 0;
      this.log.info(`connected to ${this.wsUrl}`);
    });

    sock.on("message", (data: unknown) => {
      this.handleMessage(data);
    });

    sock.on("error", (err: unknown) => {
      this.log.warn(`websocket error: ${String(err)}`);
    });

    sock.on("close", () => {
      this.connected = false;
      this.socket = null;
      if (this.closed) return;
      this.handleDisconnect();
    });
  }

  private handleDisconnect(): void {
    // AC#4: connection loss while waiting. Log it; attempt bounded reconnects.
    if (this.reconnects >= this.maxReconnects) {
      this.log.error(
        `websocket closed; gave up after ${this.reconnects} reconnect attempts; ` +
          `${this.pending.size} pending approval(s) cannot be delivered`
      );
      this.failAllPending(
        (id) => new BridgeConnectionLostError(id)
      );
      return;
    }
    this.reconnects += 1;
    this.log.warn(
      `websocket closed; reconnect attempt ${this.reconnects}/${this.maxReconnects} ` +
        `in ${this.reconnectDelayMs}ms (${this.pending.size} pending)`
    );
    setTimeout(() => {
      if (!this.closed) this.connect();
    }, this.reconnectDelayMs);
  }

  private failAllPending(makeErr: (id: number) => Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(makeErr(id));
    }
    this.pending.clear();
  }

  /** Parse and route an incoming WS frame to the matching pending approval. */
  private handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf-8")
            : String(data);
      parsed = JSON.parse(text);
    } catch {
      return; // not JSON we care about
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const evt = parsed as {
      event?: string;
      id?: number;
      answer?: string;
    };
    if (evt.event !== "approval_answer") return;
    if (typeof evt.id !== "number" || typeof evt.answer !== "string") return;

    const p = this.pending.get(evt.id);
    if (!p) return; // not one of our approvals — filtered out
    clearTimeout(p.timer);
    this.pending.delete(evt.id);
    this.log.info(`received answer for approval ${evt.id}`);
    p.resolve(evt.answer);
  }

  /**
   * Register an escalation as an approval and wait for the user's answer.
   * Resolves with the answer text (delivered over WS), rejects on timeout
   * (ApprovalTimeoutError) or unrecoverable connection loss
   * (BridgeConnectionLostError). Correlation is by the returned approval id.
   */
  async registerAndWait(reg: ApprovalRegistration): Promise<string> {
    const { id } = await this.httpPost(`${this.serverUrl}/api/approvals`, {
      run_id: reg.runId ?? null,
      session_id: reg.sessionId ?? null,
      payload: reg.payload,
    });
    this.log.info(`registered approval ${id}; waiting for answer`);
    return this.waitForAnswer(id);
  }

  /** Wait for an answer to an already-registered approval id. */
  waitForAnswer(id: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.log.warn(
          `approval ${id} timed out after ${this.answerTimeoutMs}ms with no answer`
        );
        reject(new ApprovalTimeoutError(id));
      }, this.answerTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Close the bridge: stop reconnecting and reject any pending waiters. */
  close(): void {
    this.closed = true;
    this.connected = false;
    this.failAllPending((id) => new BridgeConnectionLostError(id));
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
