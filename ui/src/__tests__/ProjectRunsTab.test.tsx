import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectRunsTab } from "../pages/ProjectsPage";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface RunItem {
  id: number;
  schedule_id: number | null;
  launch_type: string | null;
  terminal_type: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string | null;
  ai_title: string | null;
  schedule_name: string | null;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeRun(overrides: Partial<RunItem> = {}): RunItem {
  return {
    id: 1,
    schedule_id: null,
    launch_type: "manual",
    terminal_type: "ghostty",
    started_at: new Date(Date.now() - 120000).toISOString(),
    finished_at: new Date(Date.now() - 60000).toISOString(),
    duration_ms: 60000,
    status: "success",
    ai_title: "Test session",
    schedule_name: null,
    ...overrides,
  };
}

function mockFetch(runs: RunItem[], total?: number) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    json: () => Promise.resolve({ runs, total: total ?? runs.length }),
  } as Response);
}

function renderTab(projectPath = "/home/user/my-project") {
  return render(
    <MemoryRouter>
      <ProjectRunsTab projectPath={projectPath} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------
// AC#7: fetch called with correct project filter
// ----------------------------------------------------------------

describe("AC#7: fetch includes project filter in API call", () => {
  test("fetch is called with project=projectPath in URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    renderTab("/home/user/my-project");

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toContain("project=%2Fhome%2Fuser%2Fmy-project");
    });
  });

  test("fetch URL contains the correct project path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    renderTab("/home/tom/code/some-project");

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const url = calls[0][0];
      expect(url).toContain("/api/runs");
      // The project path is URL-encoded in the query string
      expect(url).toContain("project=");
      expect(decodeURIComponent(url)).toContain("project=/home/tom/code/some-project");
    });
  });
});

// ----------------------------------------------------------------
// AC#8: type and status filter interactions
// ----------------------------------------------------------------

describe("AC#8: type filter", () => {
  test("fetch is called with type=scheduled when type filter is changed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);

    renderTab();
    await waitFor(() => expect(screen.getByTestId("runs-tab-status-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("runs-tab-filter-type"), {
      target: { value: "scheduled" },
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("type=scheduled");
    });
  });
});

describe("AC#8: status filter", () => {
  test("fetch is called with status=success when status filter is changed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);

    renderTab();
    await waitFor(() => expect(screen.getByTestId("runs-tab-status-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("runs-tab-filter-status"), {
      target: { value: "success" },
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls as Array<[string]>;
      const lastUrl = calls[calls.length - 1][0];
      expect(lastUrl).toContain("status=success");
    });
  });

  test("fetch is called with status=failed when status filter is changed to failed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ runs: [makeRun()], total: 1 }),
    } as Response);

    renderTab();
    await waitFor(() => expect(screen.getByTestId("runs-tab-status-1")).toBeInTheDocument());

    fetchSpy.mockResolvedValue({
      json: () => Promise.resolve({ runs: [], total: 0 }),
    } as Response);

    fireEvent.change(screen.getByTestId("runs-tab-filter-status"), {
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
// AC#9: empty state for project with no runs
// ----------------------------------------------------------------

describe("AC#9: empty state", () => {
  test("shows empty state when no runs returned", async () => {
    mockFetch([], 0);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-empty")).toBeInTheDocument()
    );
    expect(screen.getByTestId("runs-tab-empty")).toHaveTextContent(
      "No runs yet for this project."
    );
  });

  test("table is not rendered when runs list is empty", async () => {
    mockFetch([], 0);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-empty")).toBeInTheDocument()
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// AC#1: tab renders run rows
// ----------------------------------------------------------------

describe("AC#1: renders run rows", () => {
  test("renders status badge for a returned run", async () => {
    mockFetch([makeRun({ id: 5, status: "success" })]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-status-5")).toBeInTheDocument()
    );
    expect(screen.getByTestId("runs-tab-status-5")).toHaveTextContent("success");
  });

  test("renders ai_title in table", async () => {
    mockFetch([makeRun({ ai_title: "My awesome session" })]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("My awesome session")).toBeInTheDocument()
    );
  });
});

// ----------------------------------------------------------------
// AC#3: no project filter input present
// ----------------------------------------------------------------

describe("AC#3: no project filter dropdown", () => {
  test("project filter input is not present in the runs tab", async () => {
    mockFetch([], 0);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-empty")).toBeInTheDocument()
    );
    // The runs tab must NOT have a project filter input
    expect(screen.queryByTestId("filter-project")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter by project...")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// AC#6: scheduled badge navigates to /schedules
// ----------------------------------------------------------------

describe("AC#6: scheduled badge links to /schedules", () => {
  test("scheduled run type shows Link element pointing to /schedules", async () => {
    mockFetch([
      makeRun({
        id: 10,
        launch_type: "scheduled",
        schedule_id: 3,
        schedule_name: "Nightly run",
      }),
    ]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-schedule-link-10")).toBeInTheDocument()
    );
    const link = screen.getByTestId("runs-tab-schedule-link-10");
    expect(link).toHaveAttribute("href", "/schedules");
    expect(link).toHaveTextContent("scheduled");
  });

  test("non-scheduled run does not have a schedule link", async () => {
    mockFetch([makeRun({ id: 20, launch_type: "manual", schedule_id: null })]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByTestId("runs-tab-status-20")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("runs-tab-schedule-link-20")).not.toBeInTheDocument();
  });
});
