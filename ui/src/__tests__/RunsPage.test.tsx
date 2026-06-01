import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunsPage } from "../pages/RunsPage";

// ----------------------------------------------------------------
// Types (duplicated here so tests are self-contained)
// ----------------------------------------------------------------

interface Run {
  id: number;
  agent_id: number | null;
  pid: number | null;
  session_id: string | null;
  project_root: string | null;
  launch_type: string | null;
  terminal_type: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string | null;
  ai_title: string | null;
  agent_name: string | null;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    agent_id: null,
    pid: 1234,
    session_id: "sess-abc",
    project_root: "/home/user/my-project",
    launch_type: "manual",
    terminal_type: "ghostty",
    started_at: new Date(Date.now() - 120000).toISOString(),
    finished_at: new Date(Date.now() - 60000).toISOString(),
    duration_ms: 60000,
    status: "success",
    ai_title: "Test session",
    agent_name: null,
    ...overrides,
  };
}

function mockFetch(runs: Run[], total?: number) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    json: () => Promise.resolve({ runs, total: total ?? runs.length }),
  } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------
// AC#1: renders table with runs from API
// ----------------------------------------------------------------

describe("AC#1: renders runs from API", () => {
  test("shows project name and status badge for a returned run", async () => {
    mockFetch([makeRun()]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("project-link-1")).toBeInTheDocument()
    );
    expect(screen.getByTestId("project-link-1")).toHaveTextContent("my-project");
    expect(screen.getByTestId("status-badge-1")).toBeInTheDocument();
  });

  test("renders ai_title in table", async () => {
    mockFetch([makeRun({ ai_title: "My awesome session" })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("My awesome session")).toBeInTheDocument()
    );
  });
});

// ----------------------------------------------------------------
// AC#2: project filter
// ----------------------------------------------------------------

describe("AC#2: project filter", () => {
  test("fetch is called with project param when filter is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("project-link-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("filter-project"), {
      target: { value: "my-project" },
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("project=my-project");
    });
  });
});

// ----------------------------------------------------------------
// AC#3: type filter
// ----------------------------------------------------------------

describe("AC#3: type filter", () => {
  test("fetch is called with type param when filter is changed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("project-link-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("filter-type"), {
      target: { value: "scheduled" },
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("type=scheduled");
    });
  });
});

// ----------------------------------------------------------------
// AC#4: status filter
// ----------------------------------------------------------------

describe("AC#4: status filter", () => {
  test("fetch is called with status param when filter is changed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("project-link-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("filter-status"), {
      target: { value: "failed" },
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("status=failed");
    });
  });
});

// ----------------------------------------------------------------
// AC#5: date range filter
// ----------------------------------------------------------------

describe("AC#5: date range filter", () => {
  test("fetch includes since and until params when set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("project-link-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("filter-since"), {
      target: { value: "2025-01-01" },
    });
    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("since=2025-01-01");
    });

    fireEvent.change(screen.getByTestId("filter-until"), {
      target: { value: "2025-12-31" },
    });
    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("until=2025-12-31");
    });
  });
});

// ----------------------------------------------------------------
// AC#6: clicking project name sets project filter
// ----------------------------------------------------------------

describe("AC#6: clicking project name sets project filter", () => {
  test("project input is updated after clicking project link", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({
          runs: [makeRun({ id: 1, project_root: "/home/user/cool-project" })],
          total: 1,
        }),
    } as Response);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("project-link-1")).toBeInTheDocument()
    );

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.click(screen.getByTestId("project-link-1"));

    await waitFor(() => {
      const input = screen.getByTestId("filter-project") as HTMLInputElement;
      expect(input.value).toBe("cool-project");
    });

    // also verify fetch was called with the project filter
    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("project=cool-project");
    });
  });
});

// ----------------------------------------------------------------
// AC#7: scheduled type badge links to /agents
// ----------------------------------------------------------------

describe("AC#7: scheduled type badge navigates to /agents", () => {
  test("scheduled run has a link to /agents", async () => {
    mockFetch([
      makeRun({
        id: 2,
        launch_type: "scheduled",
        agent_id: 5,
        agent_name: "Nightly check",
      }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("agent-link-2")).toBeInTheDocument()
    );
    const link = screen.getByTestId("agent-link-2");
    expect(link).toHaveAttribute("href", "/agents");
    expect(link).toHaveTextContent("scheduled");
  });

  test("non-scheduled run does not have schedule link", async () => {
    mockFetch([makeRun({ id: 3, launch_type: "manual", agent_id: null })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("project-link-3")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("agent-link-3")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// AC#8: pagination
// ----------------------------------------------------------------

describe("AC#8: pagination", () => {
  test("shows page 1 of 1 with only a few results", async () => {
    mockFetch([makeRun()], 1);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("page-info")).toHaveTextContent("Page 1 of 1")
    );
  });

  test("prev button disabled on first page", async () => {
    mockFetch([makeRun()], 1);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("prev-page")).toBeDisabled()
    );
  });

  test("next button disabled when total <= limit", async () => {
    mockFetch([makeRun()], 1);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("next-page")).toBeDisabled()
    );
  });

  test("next button enabled when there are more pages", async () => {
    const runs = Array.from({ length: 20 }, (_, i) => makeRun({ id: i + 1 }));
    mockFetch(runs, 50);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("next-page")).not.toBeDisabled()
    );
    expect(screen.getByTestId("page-info")).toHaveTextContent("Page 1 of 3");
  });

  test("clicking next increments page and fetches with new offset", async () => {
    const runs = Array.from({ length: 20 }, (_, i) => makeRun({ id: i + 1 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs, total: 50 }),
    } as Response);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("next-page")).not.toBeDisabled()
    );

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 50 }),
    } as Response);

    fireEvent.click(screen.getByTestId("next-page"));

    await waitFor(() => {
      const url = String((fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as [string])[0]);
      expect(url).toContain("offset=20");
    });
    expect(screen.getByTestId("page-info")).toHaveTextContent("Page 2 of 3");
  });
});

// ----------------------------------------------------------------
// AC#9: running sessions show 'running' badge
// ----------------------------------------------------------------

describe("AC#9: running sessions", () => {
  test("running run shows running status badge", async () => {
    mockFetch([
      makeRun({
        id: 10,
        status: "running",
        duration_ms: null,
        finished_at: null,
        started_at: new Date(Date.now() - 30000).toISOString(),
      }),
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("status-badge-10")).toBeInTheDocument()
    );
    expect(screen.getByTestId("status-badge-10")).toHaveTextContent("running");
  });
});

// ----------------------------------------------------------------
// AC#10 & AC#13: empty state
// ----------------------------------------------------------------

describe("AC#10 and AC#13: empty state", () => {
  test("shows empty state message when no runs returned", async () => {
    mockFetch([], 0);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("empty-state")).toBeInTheDocument()
    );
    expect(screen.getByTestId("empty-state")).toHaveTextContent(
      "No runs match the current filters."
    );
  });

  test("table is not rendered when runs list is empty", async () => {
    mockFetch([], 0);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("empty-state")).toBeInTheDocument()
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// AC#14: status badge color mapping
// ----------------------------------------------------------------

describe("AC#14: status badge colors", () => {
  async function renderWithStatus(status: string, id = 99) {
    mockFetch([makeRun({ id, status })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId(`status-badge-${id}`)).toBeInTheDocument()
    );
    return screen.getByTestId(`status-badge-${id}`);
  }

  test("success badge is green", async () => {
    const badge = await renderWithStatus("success");
    expect(badge).toHaveStyle({ color: "#1a7f37" });
    expect(badge).toHaveStyle({ backgroundColor: "#dafbe1" });
  });

  test("failed badge is red", async () => {
    const badge = await renderWithStatus("failed", 98);
    expect(badge).toHaveStyle({ color: "#cf222e" });
    expect(badge).toHaveStyle({ backgroundColor: "#ffebe9" });
  });

  test("running badge is yellow", async () => {
    const badge = await renderWithStatus("running", 97);
    expect(badge).toHaveStyle({ color: "#9a6700" });
    expect(badge).toHaveStyle({ backgroundColor: "#fff8c5" });
  });

  test("cancelled badge is grey", async () => {
    const badge = await renderWithStatus("cancelled", 96);
    expect(badge).toHaveStyle({ color: "#57606a" });
    expect(badge).toHaveStyle({ backgroundColor: "#f6f8fa" });
  });
});
