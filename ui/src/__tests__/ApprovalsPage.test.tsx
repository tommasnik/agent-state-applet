import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { AgentsContext } from "../store/agents";
import type { AgentsState } from "../store/agents";

// ----------------------------------------------------------------
// Types (mirror server ApprovalRow)
// ----------------------------------------------------------------

interface Approval {
  id: number;
  run_id: number | null;
  session_id: string | null;
  created_at: string;
  status: "pending" | "answered" | "dismissed";
  payload: string | null;
  answer: string | null;
  answered_at: string | null;
}

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 1,
    run_id: 42,
    session_id: "sess-abcdef12",
    created_at: "2026-06-03T08:00:00Z",
    status: "pending",
    payload: JSON.stringify({
      proposedAction: "Reply to the customer email confirming the meeting",
      uncertaintyReason: "Two emails from the same sender; unclear which thread to use",
      sources: [
        { type: "email", label: "Re: Schedule", url: "https://mail.example/123" },
        { type: "whatsapp", text: "Can we move to 3pm?" },
      ],
    }),
    answer: null,
    answered_at: null,
    ...overrides,
  };
}

// ----------------------------------------------------------------
// WebSocket mock — captures the instance so tests can push messages.
// ----------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // open asynchronously like a real socket
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send() {}
  close() {
    this.readyState = 3;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// ----------------------------------------------------------------
// Fetch mock — routes by URL + method.
// ----------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: string | undefined;
}

let fetchCalls: FetchCall[] = [];

function installFetch(initial: Approval[]) {
  fetchCalls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    fetchCalls.push({ url, method, body: init?.body as string | undefined });

    if (url === "/api/approvals" && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ approvals: initial }),
      } as Response);
    }
    // answer / dismiss
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
  });
}

function makeAgentsState(overrides: Partial<AgentsState> = {}): AgentsState {
  return {
    agents: {},
    reviews: [],
    connected: true,
    updatedAt: null,
    ...overrides,
  };
}

function renderPage(agentsState: AgentsState = makeAgentsState()) {
  return render(
    <MemoryRouter>
      <AgentsContext.Provider value={agentsState}>
        <ApprovalsPage />
      </AgentsContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  MockWebSocket.reset();
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ----------------------------------------------------------------
// AC#1: live pending list from API + WebSocket
// ----------------------------------------------------------------

describe("AC#1: renders pending approvals", () => {
  test("renders items returned by GET /api/approvals", async () => {
    installFetch([makeApproval(), makeApproval({ id: 2, session_id: "sess-22222222" })]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-item-1")).toBeInTheDocument());
    expect(screen.getByTestId("approval-item-2")).toBeInTheDocument();
    expect(screen.getByTestId("approvals-count")).toHaveTextContent("2 pending");
  });

  test("shows empty state when no approvals", async () => {
    installFetch([]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approvals-empty")).toBeInTheDocument());
  });

  test("adds a new item live on approval_pending WS event", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-item-1")).toBeInTheDocument());

    act(() => {
      MockWebSocket.latest().emit({
        event: "approval_pending",
        approval: makeApproval({ id: 99, session_id: "sess-99999999" }),
      });
    });

    await waitFor(() => expect(screen.getByTestId("approval-item-99")).toBeInTheDocument());
    expect(screen.getByTestId("approvals-count")).toHaveTextContent("2 pending");
  });

  test("ignores agents-snapshot WS messages", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-item-1")).toBeInTheDocument());

    act(() => {
      MockWebSocket.latest().emit({ agents: {}, reviews: [], updated_at: 123 });
    });
    // still exactly one item
    expect(screen.getByTestId("approvals-count")).toHaveTextContent("1 pending");
  });
});

// ----------------------------------------------------------------
// AC#2: detail shows action, uncertainty, sources, agent badge
// ----------------------------------------------------------------

describe("AC#2: detail content", () => {
  test("shows proposed action, uncertainty and sources", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-detail")).toBeInTheDocument());

    expect(screen.getByTestId("approval-action")).toHaveTextContent(
      "Reply to the customer email confirming the meeting"
    );
    expect(screen.getByTestId("approval-uncertainty")).toHaveTextContent(
      "unclear which thread to use"
    );
    const sources = screen.getByTestId("approval-sources");
    expect(sources).toBeInTheDocument();
    // email source rendered as a link
    const link = screen.getByText("Re: Schedule");
    expect(link).toHaveAttribute("href", "https://mail.example/123");
    // whatsapp text source
    expect(screen.getByText("Can we move to 3pm?")).toBeInTheDocument();
  });

  test("renders raw payload fallback when payload is not structured", async () => {
    installFetch([makeApproval({ payload: "just a plain string, not json" })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("approval-raw")).toHaveTextContent("just a plain string")
    );
  });

  test("shows agent badge linked to waiting agent", async () => {
    installFetch([makeApproval()]);
    const agentsState = makeAgentsState({
      agents: {
        "1234": {
          pid: 1234,
          cwd: "/x",
          state: "waiting_for_approval",
          timestamp: 0,
          hook_event: "",
          tool_name: "",
          session_id: "sess-abcdef12",
          subagent_count: 0,
          started_at: 0,
          window_id: "",
          tab_name: "",
          terminal_type: "",
          tty: "",
          project_root: "",
          ai_title: "",
        },
      },
    });
    renderPage(agentsState);
    await waitFor(() => expect(screen.getByTestId("approval-agent-badge")).toBeInTheDocument());
    expect(screen.getByTestId("approval-agent-badge")).toHaveTextContent("sess-abc");
  });
});

// ----------------------------------------------------------------
// AC#3: answer goes to /answer and item disappears
// ----------------------------------------------------------------

describe("AC#3: answering", () => {
  test("posts answer and removes the item from pending", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-detail")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("approval-answer-input"), {
      target: { value: "Use the most recent thread" },
    });
    fireEvent.click(screen.getByTestId("approval-submit"));

    await waitFor(() =>
      expect(
        fetchCalls.find((c) => c.url === "/api/approvals/1/answer" && c.method === "POST")
      ).toBeTruthy()
    );
    const call = fetchCalls.find((c) => c.url === "/api/approvals/1/answer")!;
    expect(JSON.parse(call.body!)).toEqual({ answer: "Use the most recent thread" });

    await waitFor(() => expect(screen.getByTestId("approvals-empty")).toBeInTheDocument());
  });

  test("submit is disabled when answer is empty", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-submit")).toBeInTheDocument());
    expect(screen.getByTestId("approval-submit")).toBeDisabled();
  });

  test("removes item when approval_answer WS event arrives", async () => {
    installFetch([makeApproval(), makeApproval({ id: 2, session_id: "sess-22222222" })]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-item-2")).toBeInTheDocument());

    act(() => {
      MockWebSocket.latest().emit({ event: "approval_answer", id: 2, answer: "ok" });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("approval-item-2")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("approvals-count")).toHaveTextContent("1 pending");
  });
});

// ----------------------------------------------------------------
// AC#4: dismiss
// ----------------------------------------------------------------

describe("AC#4: dismiss", () => {
  test("posts dismiss and removes the item", async () => {
    installFetch([makeApproval()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("approval-detail")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("approval-dismiss"));

    await waitFor(() =>
      expect(
        fetchCalls.find((c) => c.url === "/api/approvals/1/dismiss" && c.method === "POST")
      ).toBeTruthy()
    );
    await waitFor(() => expect(screen.getByTestId("approvals-empty")).toBeInTheDocument());
  });
});
