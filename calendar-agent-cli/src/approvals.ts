/**
 * `cal-agent approvals ...` — the escalation queue client.
 *
 * One-shot escalation model (no long-lived session): a run is `claude -p`. When
 * the agent is uncertain about an action it registers the item in the applet
 * server's approvals queue via `approvals add` and finishes. A human answers it
 * later (in the applet UI / via the answer endpoint). The *next* run starts by
 * reading the answered items with `approvals answered` and applying them — there
 * is no blocking wait inside a run.
 *
 * Talks to the applet server's approvals HTTP API (reused, see
 * `server/src/routes/approvals.ts`). The base URL defaults to
 * http://127.0.0.1:7855 and is overridable via `$AGENT_MANAGER_URL`. Both the
 * base URL and the `fetch` implementation are injectable so tests run without a
 * real server.
 */

import { parseFlags } from "./args";

const PROG = "cal-agent";

/** The default applet-server base URL (override with $AGENT_MANAGER_URL). */
export const DEFAULT_BASE_URL = "http://127.0.0.1:7855";

/** Minimal subset of the global `fetch` we depend on (injectable for tests). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ApprovalRow {
  id: number;
  run_id: number | null;
  session_id: string | null;
  created_at: string;
  status: "pending" | "answered" | "dismissed";
  payload: string | null;
  answer: string | null;
  answered_at: string | null;
}

/** Error carrying a human-readable message for the CLI to print on stderr. */
export class ApprovalsError extends Error {}

export interface ApprovalsClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

/** Thin HTTP client over the applet server's approvals API. */
export class ApprovalsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ApprovalsClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, "");
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new ApprovalsError(
        "no fetch implementation available (Node 18+ provides a global fetch)"
      );
    }
    this.fetchImpl = f;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApprovalsError(`request to ${url} failed: ${String(e)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ApprovalsError(
        `${method} ${path} → HTTP ${res.status}${text ? `: ${text}` : ""}`
      );
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new ApprovalsError(`${method} ${path} → invalid JSON response`);
    }
  }

  /** POST /api/approvals — register a pending item, returns the created row. */
  async add(input: {
    payload: unknown;
    runId?: number;
    sessionId?: string;
  }): Promise<ApprovalRow> {
    const body: { payload: unknown; run_id?: number; session_id?: string } = {
      payload: input.payload,
    };
    if (input.runId !== undefined) body.run_id = input.runId;
    if (input.sessionId !== undefined) body.session_id = input.sessionId;
    return (await this.request("POST", "/api/approvals", body)) as ApprovalRow;
  }

  /** GET /api/approvals[?status=] — list approvals of a given status. */
  async list(
    status: "pending" | "answered" | "dismissed" | "all" = "pending"
  ): Promise<ApprovalRow[]> {
    const qs = status === "pending" ? "" : `?status=${status}`;
    const res = (await this.request("GET", `/api/approvals${qs}`)) as {
      approvals?: ApprovalRow[];
    };
    return res?.approvals ?? [];
  }
}

/** Resolve the base URL from the environment (used when none is injected). */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const v = env["AGENT_MANAGER_URL"];
  return v && v.length > 0 ? v : DEFAULT_BASE_URL;
}

const APPROVALS_USAGE = `${PROG} approvals <subcommand>
  add        --payload <json>            Register a pending item, prints its id
             | --summary <s> [--reason <r>] [--source <s>]...
             [--run-id <n>] [--session-id <id>]
  list                                   List pending approvals
  answered                               List answered approvals (apply on next run)
  Global: [--base-url <url>]  (default $AGENT_MANAGER_URL or ${DEFAULT_BASE_URL})

One-shot escalation model: a run registers uncertain items with \`add\` and
exits; a human answers them later; the NEXT run reads them with \`answered\` and
applies the answers. No blocking wait inside a run.`;

/** Dependencies for {@link runApprovals} — injectable for tests. */
export interface ApprovalsCommandDeps {
  /** Build the HTTP client (defaults to one wired from base-url/env + global fetch). */
  makeClient?: (baseUrl?: string) => ApprovalsClient;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

function resolveDeps(deps: ApprovalsCommandDeps): Required<ApprovalsCommandDeps> {
  return {
    makeClient: deps.makeClient ?? ((baseUrl) => new ApprovalsClient({ baseUrl })),
    stdout: deps.stdout ?? ((s) => void process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => void process.stderr.write(s)),
  };
}

function emit(stdout: (s: string) => void, value: unknown): number {
  stdout(JSON.stringify(value, null, 2) + "\n");
  return 0;
}

function err(stderr: (s: string) => void, message: string): number {
  stderr(`${PROG}: ${message}\n`);
  return 1;
}

function flag(flags: Record<string, string>, name: string): string | undefined {
  const v = flags[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

/**
 * Build the approval payload from flags. `--payload <json>` wins; otherwise it
 * is assembled from `--summary` (required) + optional `--reason` and repeated
 * `--source` values. Returns a parsed/structured value or throws ApprovalsError.
 */
function buildPayload(
  flags: Record<string, string>,
  sources: string[]
): unknown {
  const raw = flag(flags, "payload");
  if (raw !== undefined) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApprovalsError("add: --payload must be valid JSON");
    }
  }
  const summary = flag(flags, "summary");
  if (!summary) {
    throw new ApprovalsError(
      "add: either --payload <json> or --summary <text> is required"
    );
  }
  const payload: Record<string, unknown> = { summary };
  const reason = flag(flags, "reason");
  if (reason) payload["reason"] = reason;
  if (sources.length > 0) payload["sources"] = sources;
  return payload;
}

/**
 * Collect repeated `--source` values. parseFlags keeps only the last value for
 * a repeated flag, so re-scan the raw args to support multiple `--source`.
 */
function collectSources(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) out.push(next);
    } else if (a.startsWith("--source=")) {
      out.push(a.slice("--source=".length));
    }
  }
  return out;
}

export async function runApprovals(
  args: string[],
  deps: ApprovalsCommandDeps = {}
): Promise<number> {
  const { makeClient, stdout, stderr } = resolveDeps(deps);
  const sub = args[0];
  if (!sub || sub === "-h" || sub === "--help") {
    (sub ? stdout : stderr)(APPROVALS_USAGE + "\n");
    return sub ? 0 : 2;
  }

  const rest = args.slice(1);
  const { flags } = parseFlags(rest);
  const baseUrl = flag(flags, "base-url");

  try {
    const client = makeClient(baseUrl);

    switch (sub) {
      case "add": {
        const payload = buildPayload(flags, collectSources(rest));
        const runIdRaw = flag(flags, "run-id");
        const runId = runIdRaw !== undefined ? Number(runIdRaw) : undefined;
        if (runId !== undefined && (Number.isNaN(runId) || !Number.isInteger(runId))) {
          return err(stderr, "add: --run-id must be an integer");
        }
        const row = await client.add({
          payload,
          runId,
          sessionId: flag(flags, "session-id"),
        });
        return emit(stdout, { id: row.id, approval: row });
      }

      case "list":
        return emit(stdout, { approvals: await client.list("pending") });

      case "answered":
        return emit(stdout, { approvals: await client.list("answered") });

      default:
        stderr(`${PROG}: unknown approvals subcommand '${sub}'\n\n${APPROVALS_USAGE}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof ApprovalsError) return err(stderr, e.message);
    return err(stderr, String(e));
  }
}
