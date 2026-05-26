import {
  detectProvider,
  extractGitHubRepoId,
  mapGitHubRunStatus,
  mapGitHubJobStatus,
} from "../routes/pipeline";

// ----------------------------------------------------------------
// detectProvider
// ----------------------------------------------------------------

describe("detectProvider", () => {
  test("returns 'gitlab' for gitlab.com HTTPS remote", () => {
    expect(detectProvider("https://gitlab.com/org/repo.git")).toBe("gitlab");
  });

  test("returns 'gitlab' for gitlab.com SSH remote", () => {
    expect(detectProvider("git@gitlab.com:org/repo.git")).toBe("gitlab");
  });

  test("returns 'gitlab' for self-hosted GitLab HTTPS", () => {
    expect(detectProvider("https://gitlab.example.com/org/repo.git")).toBe("gitlab");
  });

  test("returns 'github' for github.com HTTPS remote", () => {
    expect(detectProvider("https://github.com/owner/repo.git")).toBe("github");
  });

  test("returns 'github' for github.com SSH remote", () => {
    expect(detectProvider("git@github.com:owner/repo.git")).toBe("github");
  });

  test("returns null for unknown remote", () => {
    expect(detectProvider("https://bitbucket.org/org/repo.git")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(detectProvider("")).toBeNull();
  });
});

// ----------------------------------------------------------------
// extractGitHubRepoId
// ----------------------------------------------------------------

describe("extractGitHubRepoId", () => {
  test("extracts owner/repo from HTTPS URL with .git suffix", () => {
    expect(extractGitHubRepoId("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("extracts owner/repo from HTTPS URL without .git suffix", () => {
    expect(extractGitHubRepoId("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("extracts owner/repo from SSH URL with .git suffix", () => {
    expect(extractGitHubRepoId("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  test("extracts owner/repo from SSH URL without .git suffix", () => {
    expect(extractGitHubRepoId("git@github.com:owner/repo")).toBe("owner/repo");
  });

  test("returns null for non-GitHub URL", () => {
    expect(extractGitHubRepoId("https://gitlab.com/org/repo.git")).toBeNull();
  });
});

// ----------------------------------------------------------------
// mapGitHubRunStatus — AC#4
// ----------------------------------------------------------------

describe("mapGitHubRunStatus", () => {
  test("completed + success → success", () => {
    expect(mapGitHubRunStatus("completed", "success")).toBe("success");
  });

  test("completed + failure → failed", () => {
    expect(mapGitHubRunStatus("completed", "failure")).toBe("failed");
  });

  test("completed + cancelled → canceled", () => {
    expect(mapGitHubRunStatus("completed", "cancelled")).toBe("canceled");
  });

  test("in_progress → running", () => {
    expect(mapGitHubRunStatus("in_progress", null)).toBe("running");
  });

  test("queued → pending", () => {
    expect(mapGitHubRunStatus("queued", null)).toBe("pending");
  });

  test("waiting → pending", () => {
    expect(mapGitHubRunStatus("waiting", null)).toBe("pending");
  });

  test("completed + unknown conclusion → falls back to conclusion value", () => {
    expect(mapGitHubRunStatus("completed", "timed_out")).toBe("timed_out");
  });

  test("completed + null conclusion → falls back to status", () => {
    expect(mapGitHubRunStatus("completed", null)).toBe("completed");
  });

  test("unknown status → passthrough", () => {
    expect(mapGitHubRunStatus("action_required", null)).toBe("action_required");
  });
});

// ----------------------------------------------------------------
// mapGitHubJobStatus — AC#4
// ----------------------------------------------------------------

describe("mapGitHubJobStatus", () => {
  test("conclusion=success → success", () => {
    expect(mapGitHubJobStatus("completed", "success")).toBe("success");
  });

  test("conclusion=failure → failed", () => {
    expect(mapGitHubJobStatus("completed", "failure")).toBe("failed");
  });

  test("status=in_progress, no conclusion → running", () => {
    expect(mapGitHubJobStatus("in_progress", null)).toBe("running");
  });

  test("status=queued → pending", () => {
    expect(mapGitHubJobStatus("queued", null)).toBe("pending");
  });

  test("status=waiting → pending", () => {
    expect(mapGitHubJobStatus("waiting", null)).toBe("pending");
  });

  test("other status/conclusion → skipped", () => {
    expect(mapGitHubJobStatus("completed", "skipped")).toBe("skipped");
  });

  test("completed + neutral conclusion → skipped", () => {
    expect(mapGitHubJobStatus("completed", "neutral")).toBe("skipped");
  });
});
