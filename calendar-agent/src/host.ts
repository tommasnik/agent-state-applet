import { CalendarAgentConfig, McpServerConfig } from "./config";
import { loadSystemPrompt } from "./prompt";
import { MessageQueue, QueueUserMessage } from "./messageQueue";

/**
 * Minimal structural type of the SDK's `query()` function. We do not import the
 * SDK statically (it is ESM-only); the real function is loaded lazily in
 * `loadSdkQuery()` and can be injected in tests.
 */
export type SdkQueryFn = (args: {
  prompt: AsyncIterable<QueueUserMessage>;
  options?: {
    systemPrompt?: string;
    model?: string;
    mcpServers?: Record<string, McpServerConfig>;
    [key: string]: unknown;
  };
}) => AsyncIterable<SdkMessage>;

/** Subset of SDK message shapes we care about while draining the stream. */
export interface SdkMessage {
  type: string;
  [key: string]: unknown;
}

export type HostStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "stopped";

export interface CalendarAgentHostOptions {
  config: CalendarAgentConfig;
  /** Override the SDK query fn (used by tests to avoid real API calls). */
  queryFn?: SdkQueryFn;
  /** Override the system prompt (defaults to loading prompt.md). */
  systemPrompt?: string;
}

/**
 * Lazily import the ESM-only Agent SDK from a CommonJS module. Using dynamic
 * import keeps the rest of the package as plain CommonJS (project convention)
 * while still being able to load the ESM SDK.
 */
async function loadSdkQuery(): Promise<SdkQueryFn> {
  const mod = (await import("@anthropic-ai/claude-agent-sdk")) as {
    query: SdkQueryFn;
  };
  return mod.query;
}

/**
 * Long-lived Calendar Agent host.
 *
 * Holds a single Agent SDK session open via a {@link MessageQueue} async
 * iterator. The session does NOT end after one reasoning pass — it stays alive
 * to wait for user approvals (escalation flow). The host exposes its status so
 * callers/tests can verify the session remains alive while waiting.
 */
export class CalendarAgentHost {
  private readonly config: CalendarAgentConfig;
  private readonly systemPrompt: string;
  private readonly queryFn?: SdkQueryFn;

  private readonly queue = new MessageQueue<QueueUserMessage>();
  private status: HostStatus = "idle";
  private runLoop: Promise<void> | null = null;

  constructor(opts: CalendarAgentHostOptions) {
    this.config = opts.config;
    this.queryFn = opts.queryFn;
    this.systemPrompt = opts.systemPrompt ?? loadSystemPrompt();
  }

  getStatus(): HostStatus {
    return this.status;
  }

  /** Whether the underlying SDK session is still alive (not stopped). */
  isSessionAlive(): boolean {
    return this.status !== "idle" && this.status !== "stopped";
  }

  /** Names of MCP servers that were configured for this host. */
  configuredMcpServers(): string[] {
    return Object.keys(this.config.mcpServers);
  }

  /**
   * Enqueue an input message for the live session (e.g. a whitelist item to
   * review, or — once TASK-31/32 land — an approval decision from the user).
   */
  submit(content: string): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    });
  }

  /**
   * Mark that the host is now waiting for a user approval. The session stays
   * alive (queue parked) until {@link submit} feeds the decision back in.
   */
  markWaitingForApproval(): void {
    this.status = "waiting_for_approval";
  }

  /**
   * Start the host: connect MCP servers and open the long-lived SDK session.
   * Resolves once the session loop has been launched (it keeps running in the
   * background until {@link stop} is called).
   */
  async start(): Promise<void> {
    if (this.status !== "idle") {
      throw new Error(`Cannot start host in status "${this.status}"`);
    }
    this.status = "starting";

    const query = this.queryFn ?? (await loadSdkQuery());

    // Seed the loop skeleton: one run = walk whitelist inputs -> reasoning ->
    // write to AI calendar / escalate. The concrete whitelist gathering and
    // streaming input are TASK-31/TASK-32; here we kick off the session and
    // hand control to the message queue so the session stays open.
    const stream = query({
      prompt: this.queue,
      options: {
        systemPrompt: this.systemPrompt,
        model: this.config.model,
        mcpServers: this.config.mcpServers,
      },
    });

    this.status = "running";
    this.runLoop = this.drain(stream);
    // Intentionally do NOT await this.runLoop — the session is long-lived.
  }

  /** Consume SDK messages until the session ends (queue closed). */
  private async drain(stream: AsyncIterable<SdkMessage>): Promise<void> {
    try {
      for await (const msg of stream) {
        this.onMessage(msg);
      }
    } finally {
      this.status = "stopped";
    }
  }

  /**
   * Reasoning-loop hook. Real handling (writing events, detecting escalation,
   * notifying the approval queue) is layered on in TASK-30/31/33. For the
   * scaffold we only react to result messages so the loop is observable.
   */
  protected onMessage(_msg: SdkMessage): void {
    // no-op scaffold; overridden / extended by later tasks
  }

  /** Stop the host: close the queue so the SDK session can terminate. */
  async stop(): Promise<void> {
    if (!this.queue.isClosed) {
      this.queue.close();
    }
    if (this.runLoop) {
      await this.runLoop;
    }
    this.status = "stopped";
  }
}
