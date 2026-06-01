import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentsPage } from "../pages/AgentsPage";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Morning sync",
    project_path: "/home/user/my-project",
    prompt: "Review PRs",
    cron: "0 6 * * *",
    type: "interactive",
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    last_run: null,
    next_run_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    shortcut_icon: null,
    is_running: false,
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent_id: 1,
    started_at: new Date(Date.now() - 120000).toISOString(),
    finished_at: new Date(Date.now() - 60000).toISOString(),
    status: "success",
    output: "done",
    ai_title: "Processed 4 PR reviews",
    duration_ms: 60000,
    pid: 1234,
    launch_type: "scheduled",
    ...overrides,
  };
}

function mockFetchWithSchedules(schedules: unknown[], runs: unknown[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/agents/") && urlStr.includes("/runs")) {
      return Promise.resolve({ json: () => Promise.resolve(runs) } as Response);
    }
    if (urlStr.includes("/api/agents")) {
      return Promise.resolve({ json: () => Promise.resolve(schedules) } as Response);
    }
    if (urlStr.includes("/api/projects")) {
      return Promise.resolve({ json: () => Promise.resolve([]) } as Response);
    }
    return Promise.resolve({ json: () => Promise.resolve([]) } as Response);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------
// AC#9: Never run when last_run=null
// ----------------------------------------------------------------

describe("AC#9: Never run when no runs exist", () => {
  test("shows 'Never run' when last_run is null", async () => {
    mockFetchWithSchedules([makeSchedule({ last_run: null })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("never-run")).toBeInTheDocument()
    );
    expect(screen.getByTestId("never-run")).toHaveTextContent("Never run");
  });
});

// ----------------------------------------------------------------
// AC#8: Renders with last run data
// ----------------------------------------------------------------

describe("AC#8: renders with last run data", () => {
  test("shows last run status and ai_title in header", async () => {
    const lastRun = makeRun({ ai_title: "Nightly review done" });
    mockFetchWithSchedules([makeSchedule({ last_run: lastRun })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/"Nightly review done"/)).toBeInTheDocument()
    );
    // should also show the status label
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  test("shows last run duration in header", async () => {
    const lastRun = makeRun({
      ai_title: null,
      started_at: new Date(Date.now() - 65000).toISOString(),
      finished_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockFetchWithSchedules([makeSchedule({ last_run: lastRun })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Success")).toBeInTheDocument()
    );
    // duration text should appear (roughly 1m 0s)
    expect(screen.getByText(/\d+m \d+s|\d+s/)).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------
// AC#10: Run Now disabled when is_running=true
// ----------------------------------------------------------------

describe("AC#10: Run Now disabled state when run is running", () => {
  test("Run Now button is disabled when is_running=true", async () => {
    mockFetchWithSchedules([makeSchedule({ is_running: true })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("run-now-btn")).toBeInTheDocument()
    );
    expect(screen.getByTestId("run-now-btn")).toBeDisabled();
  });

  test("Run Now button shows spinner text when is_running=true", async () => {
    mockFetchWithSchedules([makeSchedule({ is_running: true })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("run-now-btn")).toBeInTheDocument()
    );
    expect(screen.getByTestId("run-now-btn")).toHaveTextContent("…");
  });

  test("Run Now button is enabled when is_running=false", async () => {
    mockFetchWithSchedules([makeSchedule({ is_running: false })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("run-now-btn")).toBeInTheDocument()
    );
    expect(screen.getByTestId("run-now-btn")).not.toBeDisabled();
    expect(screen.getByTestId("run-now-btn")).toHaveTextContent("▶ Run now");
  });
});

// ----------------------------------------------------------------
// AC#2 / AC#11: next_run_at shown with relative time
// ----------------------------------------------------------------

describe("AC#2 / AC#11: next_run_at formatting", () => {
  test("shows next run time in header when schedule is enabled", async () => {
    const nextRun = new Date(Date.now() + 7200000).toISOString(); // 2h from now
    mockFetchWithSchedules([makeSchedule({ next_run_at: nextRun, enabled: true })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("next-run-time")).toBeInTheDocument()
    );
    const el = screen.getByTestId("next-run-time");
    expect(el.textContent).toMatch(/Next:/);
    // 2h from now should show "in 1h Xm" or "in 2h 0m"
    expect(el.textContent).toMatch(/in \d+h \d+m/);
  });

  test("does not show next run time when schedule is disabled", async () => {
    const nextRun = new Date(Date.now() + 3600000).toISOString();
    mockFetchWithSchedules([makeSchedule({ next_run_at: nextRun, enabled: false })]);
    renderPage();
    // Wait for schedule to render
    await waitFor(() =>
      expect(screen.getByText("Morning sync")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("next-run-time")).not.toBeInTheDocument();
  });

  test("shows 'in Xm' for sub-hour next run", async () => {
    const nextRun = new Date(Date.now() + 1800000).toISOString(); // 30m from now
    mockFetchWithSchedules([makeSchedule({ next_run_at: nextRun, enabled: true })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("next-run-time")).toBeInTheDocument()
    );
    const el = screen.getByTestId("next-run-time");
    expect(el.textContent).toMatch(/in \d+m/);
  });
});

// ----------------------------------------------------------------
// AC#7: View all runs link present after expansion
// ----------------------------------------------------------------

describe("AC#7: View all runs link", () => {
  test("shows 'View all runs' link when schedule is expanded and has runs", async () => {
    const run = makeRun();
    mockFetchWithSchedules([makeSchedule()], [run]);
    renderPage();

    // Wait for the schedule to appear, then click to expand
    await waitFor(() =>
      expect(screen.getByText("Morning sync")).toBeInTheDocument()
    );

    // Click the header to expand
    fireEvent.click(screen.getByText("Morning sync"));

    await waitFor(() =>
      expect(screen.getByTestId("view-all-runs-link")).toBeInTheDocument()
    );
    expect(screen.getByTestId("view-all-runs-link")).toHaveAttribute("href", "/runs");
    expect(screen.getByTestId("view-all-runs-link")).toHaveTextContent("View all runs →");
  });
});

// ----------------------------------------------------------------
// AC#6: Recent runs shows last 5 runs
// ----------------------------------------------------------------

describe("AC#6: Recent runs limited to 5", () => {
  test("only shows up to 5 runs when more are available", async () => {
    const runs = Array.from({ length: 8 }, (_, i) =>
      makeRun({ id: i + 1, ai_title: `Run ${i + 1}` })
    );
    mockFetchWithSchedules([makeSchedule()], runs);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Morning sync")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("Morning sync"));

    await waitFor(() =>
      expect(screen.getByTestId("view-all-runs-link")).toBeInTheDocument()
    );

    // Only first 5 runs shown
    expect(screen.getByText(/Run 1/)).toBeInTheDocument();
    expect(screen.getByText(/Run 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Run 6/)).not.toBeInTheDocument();
  });
});
