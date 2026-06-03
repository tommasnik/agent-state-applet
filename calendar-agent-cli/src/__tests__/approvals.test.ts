import {
  ApprovalsClient,
  ApprovalRow,
  FetchLike,
  resolveBaseUrl,
  runApprovals,
  DEFAULT_BASE_URL,
} from "../approvals";

interface Cap {
  out: string;
  err: string;
}

interface RecordedCall {
  url: string;
  method?: string;
  body?: unknown;
}

/** A scripted mock `fetch`: each call pops the next response. */
function mockFetch(
  responses: Array<{ ok?: boolean; status?: number; body: unknown }>
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const r = responses[i++] ?? { body: {} };
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => text,
    };
  };
  return { fetch, calls };
}

function makeDeps(fetch: FetchLike): {
  deps: Parameters<typeof runApprovals>[1];
  cap: Cap;
} {
  const cap: Cap = { out: "", err: "" };
  return {
    deps: {
      makeClient: (baseUrl) => new ApprovalsClient({ baseUrl, fetch }),
      stdout: (s) => {
        cap.out += s;
      },
      stderr: (s) => {
        cap.err += s;
      },
    },
    cap,
  };
}

const ROW = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: 1,
  run_id: null,
  session_id: null,
  created_at: "2026-06-03 10:00:00",
  status: "pending",
  payload: null,
  answer: null,
  answered_at: null,
  ...over,
});

describe("resolveBaseUrl", () => {
  it("defaults to 127.0.0.1:7855", () => {
    expect(resolveBaseUrl({})).toBe(DEFAULT_BASE_URL);
  });
  it("honors $AGENT_MANAGER_URL", () => {
    expect(resolveBaseUrl({ AGENT_MANAGER_URL: "http://host:9000" })).toBe(
      "http://host:9000"
    );
  });
});

describe("ApprovalsClient", () => {
  it("add POSTs payload and returns the created row", async () => {
    const { fetch, calls } = mockFetch([
      { status: 201, body: ROW({ id: 42, payload: '{"summary":"x"}' }) },
    ]);
    const client = new ApprovalsClient({ baseUrl: "http://h:1", fetch });
    const row = await client.add({
      payload: { summary: "x" },
      runId: 5,
      sessionId: "s1",
    });
    expect(row.id).toBe(42);
    expect(calls[0].url).toBe("http://h:1/api/approvals");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({
      payload: { summary: "x" },
      run_id: 5,
      session_id: "s1",
    });
  });

  it("list(pending) hits the bare endpoint", async () => {
    const { fetch, calls } = mockFetch([{ body: { approvals: [ROW()] } }]);
    const client = new ApprovalsClient({ baseUrl: "http://h:1", fetch });
    const rows = await client.list("pending");
    expect(rows).toHaveLength(1);
    expect(calls[0].url).toBe("http://h:1/api/approvals");
  });

  it("list(answered) appends ?status=answered", async () => {
    const { fetch, calls } = mockFetch([
      { body: { approvals: [ROW({ status: "answered", answer: "yes" })] } },
    ]);
    const client = new ApprovalsClient({ baseUrl: "http://h:1", fetch });
    const rows = await client.list("answered");
    expect(calls[0].url).toBe("http://h:1/api/approvals?status=answered");
    expect(rows[0].answer).toBe("yes");
  });

  it("throws ApprovalsError on a non-OK response", async () => {
    const { fetch } = mockFetch([{ ok: false, status: 500, body: "boom" }]);
    const client = new ApprovalsClient({ baseUrl: "http://h:1", fetch });
    await expect(client.list()).rejects.toThrow(/HTTP 500/);
  });
});

describe("runApprovals", () => {
  it("add --payload registers and prints the returned id (exit 0)", async () => {
    const { fetch, calls } = mockFetch([{ status: 201, body: ROW({ id: 7 }) }]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(
      ["add", "--payload", '{"action":"create_event","uncertainty":0.6}'],
      deps
    );
    expect(code).toBe(0);
    expect(JSON.parse(cap.out).id).toBe(7);
    expect(calls[0].body).toEqual({
      payload: { action: "create_event", uncertainty: 0.6 },
    });
  });

  it("add assembles payload from --summary/--reason/--source", async () => {
    const { fetch, calls } = mockFetch([{ status: 201, body: ROW({ id: 8 }) }]);
    const { deps } = makeDeps(fetch);
    const code = await runApprovals(
      [
        "add",
        "--summary",
        "Move dentist to 15:00",
        "--reason",
        "conflict with school pickup",
        "--source",
        "email-42",
        "--source",
        "wa-Slunovrat",
      ],
      deps
    );
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({
      payload: {
        summary: "Move dentist to 15:00",
        reason: "conflict with school pickup",
        sources: ["email-42", "wa-Slunovrat"],
      },
    });
  });

  it("add with invalid JSON payload → exit 1, no HTTP", async () => {
    const { fetch, calls } = mockFetch([]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(["add", "--payload", "{not json"], deps);
    expect(code).toBe(1);
    expect(cap.err).toContain("valid JSON");
    expect(calls).toHaveLength(0);
  });

  it("add with neither --payload nor --summary → exit 1", async () => {
    const { fetch } = mockFetch([]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(["add", "--reason", "x"], deps);
    expect(code).toBe(1);
    expect(cap.err).toContain("required");
  });

  it("list prints pending approvals", async () => {
    const { fetch, calls } = mockFetch([
      { body: { approvals: [ROW({ id: 1 }), ROW({ id: 2 })] } },
    ]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(["list"], deps);
    expect(code).toBe(0);
    expect(JSON.parse(cap.out).approvals).toHaveLength(2);
    expect(calls[0].url).toContain("/api/approvals");
    expect(calls[0].url).not.toContain("status=");
  });

  it("answered queries status=answered and prints them", async () => {
    const { fetch, calls } = mockFetch([
      { body: { approvals: [ROW({ id: 3, status: "answered", answer: "go" })] } },
    ]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(["answered"], deps);
    expect(code).toBe(0);
    expect(calls[0].url).toContain("status=answered");
    expect(JSON.parse(cap.out).approvals[0].answer).toBe("go");
  });

  it("surfaces a server error on stderr with exit 1", async () => {
    const { fetch } = mockFetch([{ ok: false, status: 503, body: "down" }]);
    const { deps, cap } = makeDeps(fetch);
    const code = await runApprovals(["list"], deps);
    expect(code).toBe(1);
    expect(cap.err).toContain("HTTP 503");
  });

  it("unknown subcommand → exit 2", async () => {
    const { fetch } = mockFetch([]);
    const { deps } = makeDeps(fetch);
    expect(await runApprovals(["frobnicate"], deps)).toBe(2);
  });

  it("no subcommand prints usage on stderr (exit 2)", async () => {
    const { fetch } = mockFetch([]);
    const { deps, cap } = makeDeps(fetch);
    expect(await runApprovals([], deps)).toBe(2);
    expect(cap.err).toContain("add");
  });
});
