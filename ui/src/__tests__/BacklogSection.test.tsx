import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BacklogSection } from "../components/BacklogSection";

function makeFile(name: string, title: string, status = "todo", priority = "high") {
  return {
    name,
    content: `---\ntitle: ${title}\nstatus: ${status}\npriority: ${priority}\n---\n`,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("BacklogSection: loading and empty state", () => {
  test("shows Loading while fetch pending", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  test("shows empty state when no open tasks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ files: [] }),
    } as Response);
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    await waitFor(() =>
      expect(screen.getByText("No open tasks found.")).toBeInTheDocument()
    );
  });

  test("filters out done tasks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({
          files: [
            makeFile("task-01.md", "Open task", "todo"),
            makeFile("task-02.md", "Done task", "done"),
          ],
        }),
    } as Response);
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    await waitFor(() =>
      expect(screen.getByText("Open task")).toBeInTheDocument()
    );
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
  });
});

describe("BacklogSection: task list", () => {
  test("renders task title, id, priority, status columns", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({ files: [makeFile("task-03.md", "Fix login bug")] }),
    } as Response);
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    await waitFor(() =>
      expect(screen.getByText("Fix login bug")).toBeInTheDocument()
    );
    expect(screen.getByText("TASK-03")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("todo")).toBeInTheDocument();
  });

  test("shows count badge with number of open tasks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({
          files: [
            makeFile("task-01.md", "Task A"),
            makeFile("task-02.md", "Task B"),
          ],
        }),
    } as Response);
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });
});

describe("BacklogSection: action buttons", () => {
  test("renders Next task and Implementuj vše buttons", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () => Promise.resolve({ files: [] }),
    } as Response);
    render(
      <BacklogSection backlogPath="/p" actionRootPath="/p" projectName="proj" />
    );
    await waitFor(() =>
      expect(screen.getByText("No open tasks found.")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Next task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Implementuj vše" })).toBeInTheDocument();
  });
});
