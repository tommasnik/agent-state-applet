import {
  CalendarAgentConfig,
  McpServerConfig,
  googleServerNames,
  injectGoogleBearer,
} from "./config";
import { GoogleTokenManager } from "./googleAuth";
import { loadSystemPrompt } from "./prompt";
import { MessageQueue, QueueUserMessage } from "./messageQueue";
import { AgentInput, filterInputs, WhitelistConfig } from "./whitelist";
import {
  ApprovalBridge,
  ApprovalRegistration,
  ApprovalTimeoutError,
  BridgeConnectionLostError,
} from "./bridge";

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
    allowedTools?: string[];
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
  /**
   * The agent config. `whitelist` may be omitted by callers (it defaults to
   * deny-all); everything {@link loadConfig} produces includes it.
   */
  config: Omit<CalendarAgentConfig, "whitelist"> &
    Partial<Pick<CalendarAgentConfig, "whitelist">>;
  /** Override the SDK query fn (used by tests to avoid real API calls). */
  queryFn?: SdkQueryFn;
  /** Override the system prompt (defaults to loading prompt.md). */
  systemPrompt?: string;
  /**
   * The streaming-input bridge to the server's approval queue (TASK-32). When
   * omitted, escalation falls back to local-only behavior (no remote answer
   * delivery). Tests inject a bridge with stubbed transport.
   */
  bridge?: ApprovalBridge;
  /** Optional correlation hints attached to registered approvals. */
  runId?: number | null;
  sessionId?: string | null;
  /**
   * Google OAuth token manager. The official Google remote MCP servers
   * (Calendar / Gmail) need a `Bearer <access_token>` header which the SDK does
   * NOT obtain on its own. The host calls this before opening the session to
   * get a fresh access token and inject it into the Google servers' headers.
   * Tests inject a manager with a stubbed token transport; if omitted, one is
   * created lazily ONLY when the config actually contains Google servers.
   */
  googleTokenManager?: GoogleTokenManager;
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
  private readonly bridge?: ApprovalBridge;
  private readonly runId?: number | null;
  private readonly sessionId?: string | null;
  private googleTokenManager?: GoogleTokenManager;

  constructor(opts: CalendarAgentHostOptions) {
    // Be defensive: a config without an explicit whitelist gets the empty
    // (deny-all) default rather than crashing the filter path.
    this.config = {
      ...opts.config,
      whitelist: opts.config.whitelist ?? {
        whatsapp: { groups: [] },
        gmail: { senders: [], labels: [] },
      },
    };
    this.queryFn = opts.queryFn;
    this.systemPrompt = opts.systemPrompt ?? loadSystemPrompt();
    this.bridge = opts.bridge;
    this.runId = opts.runId;
    this.sessionId = opts.sessionId;
    this.googleTokenManager = opts.googleTokenManager;
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
   * Wildcard `allowedTools` entries for every configured MCP server, e.g.
   * `mcp__calendar__*`. WITHOUT these the SDK lets Claude SEE the MCP tools but
   * never CALL them — required for headless / unattended operation. The server
   * names must match the keys in `mcpServers`.
   */
  allowedTools(): string[] {
    return this.configuredMcpServers().map((name) => `mcp__${name}__*`);
  }

  /** The active input whitelist (TASK-29 AC#3). */
  whitelist(): WhitelistConfig {
    return this.config.whitelist;
  }

  /**
   * Gate raw MCP inputs through the whitelist BEFORE they reach the model.
   * Only whitelisted WhatsApp groups / Gmail senders / labels survive — this
   * is the token-saving, noise-reducing filter required by AC#3. Callers feed
   * the survivors into {@link submit}.
   */
  filterInputs(inputs: AgentInput[]): AgentInput[] {
    return filterInputs(inputs, this.config.whitelist);
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
   * Escalate an uncertain action and BLOCK on the user's answer (TASK-32).
   *
   * Mechanics:
   *   1. Register the escalation with the server's approval queue via the
   *      bridge (POST /api/approvals) → get an approval id.
   *   2. Go to `waiting_for_approval`. The SDK session does NOT end — the
   *      MessageQueue iterator is parked, keeping the session alive.
   *   3. Await the answer delivered over WebSocket (correlated by id).
   *   4. On answer: go back to `running` and {@link submit} the answer text as
   *      a *continuation prompt*. The reasoning loop then proceeds to write the
   *      event to the AI calendar (AC#3 — exercised in tests via a mocked tool
   *      call; real Google Calendar write needs live OAuth from TASK-29).
   *   5. On timeout / connection loss (AC#4): the loss is logged by the bridge;
   *      the host returns to `running` and surfaces the failure to the caller
   *      so the escalation can be abandoned without killing the session.
   *
   * Requires a bridge to have been provided; throws otherwise.
   */
  async escalate(reg: Omit<ApprovalRegistration, "runId" | "sessionId"> &
    Partial<Pick<ApprovalRegistration, "runId" | "sessionId">>): Promise<string> {
    if (!this.bridge) {
      throw new Error("Cannot escalate: no approval bridge configured");
    }
    this.markWaitingForApproval();
    try {
      const answer = await this.bridge.registerAndWait({
        runId: reg.runId ?? this.runId ?? null,
        sessionId: reg.sessionId ?? this.sessionId ?? null,
        payload: reg.payload,
      });
      // Answer arrived: resume the live session and feed it back in as a
      // continuation prompt so the model can act on it (e.g. write the event).
      this.status = "running";
      this.submit(answer);
      return answer;
    } catch (err) {
      // AC#4: defined behavior on loss. The bridge has already logged the
      // specific cause; here we unblock the session rather than leave it stuck.
      if (err instanceof ApprovalTimeoutError) {
        this.status = "running";
        throw err;
      }
      if (err instanceof BridgeConnectionLostError) {
        this.status = "running";
        throw err;
      }
      this.status = "running";
      throw err;
    }
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

    // Resolve the Google bearer token (if any Google remote MCP server is
    // configured) and inject it into those servers' Authorization headers. The
    // SDK does not perform OAuth for remote MCP servers — we must supply the
    // bearer ourselves. Non-Google servers (WhatsApp stdio) pass through.
    const mcpServers = await this.resolveMcpServers();

    // Seed the loop skeleton: one run = walk whitelist inputs -> reasoning ->
    // write to AI calendar / escalate. The concrete whitelist gathering and
    // streaming input are TASK-31/TASK-32; here we kick off the session and
    // hand control to the message queue so the session stays open.
    const stream = query({
      prompt: this.queue,
      options: {
        systemPrompt: this.systemPrompt,
        model: this.config.model,
        mcpServers,
        // Wildcards so Claude may actually CALL the MCP tools (not just see
        // them). Without this the headless agent never invokes a tool.
        allowedTools: this.allowedTools(),
      },
    });

    this.status = "running";
    this.runLoop = this.drain(stream);
    // Intentionally do NOT await this.runLoop — the session is long-lived.
  }

  /**
   * Resolve the final `mcpServers` map handed to the SDK. If any server is a
   * Google remote server, fetch a fresh access token via the token manager and
   * inject `Authorization: Bearer <token>` into those servers' headers.
   *
   * NOTE on long-lived sessions: the access token is fetched ONCE here at
   * startup. The session may outlive the token's validity (Google access tokens
   * are ~1h). The SDK does not expose a hook to re-inject headers on a live MCP
   * connection, so full mid-session re-injection is out of MVP scope. The token
   * manager caches + refreshes for any FUTURE (re)connections; a connection
   * that has already been open for >1h may need the host to be restarted. This
   * limitation is documented in docs/SETUP.md.
   */
  private async resolveMcpServers(): Promise<
    Record<string, McpServerConfig>
  > {
    const googleNames = googleServerNames(this.config.mcpServers);
    if (googleNames.length === 0) {
      return this.config.mcpServers;
    }
    if (!this.googleTokenManager) {
      this.googleTokenManager = new GoogleTokenManager();
    }
    const accessToken = await this.googleTokenManager.getAccessToken();
    console.log(
      `[calendar-agent] injected Google bearer for: ${googleNames.join(", ")}`
    );
    return injectGoogleBearer(this.config.mcpServers, accessToken);
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
  protected onMessage(msg: SdkMessage): void {
    // Log MCP connection status from the SDK's init/system message so we can see
    // which servers connected vs. failed (e.g. a stale Google bearer → failed).
    this.logMcpStatus(msg);
  }

  /**
   * If the message is the SDK `system`/`init` message, log each MCP server's
   * connection status (`connected` / `failed` / etc.). The init message carries
   * `mcp_servers: [{ name, status }]`.
   */
  private logMcpStatus(msg: SdkMessage): void {
    const isInit =
      msg.type === "system" &&
      (msg.subtype === "init" || msg.subtype === undefined);
    const servers = (msg as { mcp_servers?: unknown }).mcp_servers;
    if (!isInit || !Array.isArray(servers)) return;
    for (const s of servers as Array<Record<string, unknown>>) {
      const name = typeof s.name === "string" ? s.name : "(unknown)";
      const status = typeof s.status === "string" ? s.status : "(unknown)";
      const ok = status === "connected";
      console.log(
        `[calendar-agent] MCP server "${name}": ${status}` +
          (ok ? "" : " — NOT connected")
      );
    }
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
