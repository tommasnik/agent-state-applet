import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectsPage } from "../pages/ProjectsPage";

function mockProjects(projects: object[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/projects") {
      return Promise.resolve({ json: () => Promise.resolve(projects) } as Response);
    }
    if (url === "/api/config") {
      return Promise.resolve({
        json: () => Promise.resolve({ projectRoots: [] }),
      } as Response);
    }
    return Promise.resolve({ json: () => Promise.resolve(null) } as Response);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar BL badge on parent projects", () => {
  test("project with hasBacklog shows BL badge in sidebar", async () => {
    mockProjects([
      {
        name: "my-project",
        path: "/code/my-project",
        hasClaudeMd: false,
        hasMcpJson: false,
        hasSkills: false,
        hasBacklog: true,
        subProjects: [],
      },
    ]);
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );
    // Wait for sidebar to render project row
    await waitFor(() =>
      expect(screen.getAllByText("my-project").length).toBeGreaterThan(0)
    );
    // BL badge with title="Backlog" should appear
    const badges = screen.getAllByTitle("Backlog");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toHaveTextContent("BL");
  });

  test("project without hasBacklog does not show BL badge in sidebar", async () => {
    mockProjects([
      {
        name: "other-project",
        path: "/code/other-project",
        hasClaudeMd: false,
        hasMcpJson: false,
        hasSkills: false,
        hasBacklog: false,
        subProjects: [],
      },
    ]);
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getAllByText("other-project").length).toBeGreaterThan(0)
    );
    expect(screen.queryAllByTitle("Backlog")).toHaveLength(0);
  });
});
