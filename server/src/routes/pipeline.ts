import { Router, Request, Response } from "express";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { loadConfig } from "../config";

const router = Router();

// ----------------------------------------------------------------
// Helpers (copied from projects.ts — not exported there)
// ----------------------------------------------------------------

function decodePath(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function validatePath(projectPath: string): boolean {
  const config = loadConfig();
  const home = os.homedir();
  const allowedRoots = [
    ...config.projectRoots.map((r) => r.replace(/^~/, home)),
    path.join(home, ".claude"),
  ];
  const normalized = path.resolve(projectPath);
  if (normalized.includes("..")) return false;
  return allowedRoots.some(
    (root) =>
      normalized.startsWith(path.resolve(root) + path.sep) ||
      normalized === path.resolve(root)
  );
}

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface PipelineJob {
  id: number;
  name: string;
  status: string;
  web_url: string;
  duration: number | null;
  started_at: string | null;
}

interface PipelineData {
  provider: "gitlab" | "github";
  status: string;
  ref: string;
  web_url: string;
  started_at: string | null;
  duration: number | null;
  jobs: PipelineJob[];
}

// ----------------------------------------------------------------
// Cache (Map keyed by projectPath, TTL 5s)
// ----------------------------------------------------------------

interface CacheEntry {
  data: PipelineData | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;

function getCached(projectPath: string): CacheEntry | undefined {
  const entry = cache.get(projectPath);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(projectPath);
    return undefined;
  }
  return entry;
}

// ----------------------------------------------------------------
// Subprocess helpers
// ----------------------------------------------------------------

function exec(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
    void child;
  });
}

async function getGitBranch(projectPath: string): Promise<string> {
  return exec("git", ["-C", projectPath, "rev-parse", "--abbrev-ref", "HEAD"], projectPath, 5000);
}

async function getGitRemoteUrl(projectPath: string): Promise<string> {
  return exec("git", ["-C", projectPath, "remote", "get-url", "origin"], projectPath, 5000);
}

/**
 * Extract "namespace/repo" from a GitLab remote URL.
 * Handles both SSH (git@gitlab.com:ns/repo.git) and HTTPS forms.
 */
function extractGitLabProjectId(remoteUrl: string): string | null {
  // SSH: git@<host>:namespace/repo.git
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // HTTPS: https://<host>/namespace/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/(?:[^@]+@)?[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

export function detectProvider(remoteUrl: string): "gitlab" | "github" | null {
  if (remoteUrl.includes("gitlab")) return "gitlab";
  if (remoteUrl.includes("github.com")) return "github";
  return null;
}

/**
 * Extract "owner/repo" from a GitHub remote URL.
 * Handles both SSH (git@github.com:owner/repo.git) and HTTPS forms.
 */
export function extractGitHubRepoId(remoteUrl: string): string | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/(?:[^@]+@)?github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

export function mapGitHubRunStatus(status: string, conclusion: string | null): string {
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure") return "failed";
    if (conclusion === "cancelled") return "canceled";
    return conclusion ?? status;
  }
  if (status === "in_progress") return "running";
  if (status === "queued" || status === "waiting") return "pending";
  return status;
}

export function mapGitHubJobStatus(status: string, conclusion: string | null): string {
  if (conclusion === "success") return "success";
  if (conclusion === "failure") return "failed";
  if (status === "in_progress") return "running";
  if (status === "queued" || status === "waiting") return "pending";
  return "skipped";
}

async function fetchGitHubPipeline(projectPath: string, branch: string, repoId: string): Promise<PipelineData | null> {
  // 1. Get latest run for the branch
  let runsRaw: string;
  try {
    runsRaw = await exec(
      "gh",
      ["run", "list", "--branch", branch, "--limit", "1", "--json", "databaseId,status,conclusion,url,headBranch,createdAt,updatedAt", "--repo", repoId],
      projectPath,
      10000
    );
  } catch (err) {
    process.stderr.write(`[pipeline] gh run list failed for ${projectPath}: ${err}\n`);
    return null;
  }

  let runs: Array<{
    databaseId: number;
    status: string;
    conclusion: string | null;
    url: string;
    headBranch: string;
    createdAt: string;
    updatedAt: string;
  }>;
  try {
    runs = JSON.parse(runsRaw);
  } catch {
    process.stderr.write(`[pipeline] gh run list returned invalid JSON for ${projectPath}\n`);
    return null;
  }

  if (!Array.isArray(runs) || runs.length === 0) return null;

  const run = runs[0];
  const unifiedStatus = mapGitHubRunStatus(run.status, run.conclusion ?? null);

  // 2. Get jobs for the run
  let jobs: PipelineJob[] = [];
  try {
    const jobsRaw = await exec(
      "gh",
      ["run", "view", String(run.databaseId), "--json", "jobs", "--repo", repoId],
      projectPath,
      10000
    );
    const parsed = JSON.parse(jobsRaw) as {
      jobs: Array<{
        databaseId: number;
        name: string;
        status: string;
        conclusion: string | null;
        startedAt: string | null;
        completedAt: string | null;
        url: string;
      }>;
    };
    if (Array.isArray(parsed.jobs)) {
      jobs = parsed.jobs.map((j) => {
        let duration: number | null = null;
        if (j.startedAt && j.completedAt) {
          const diff = (new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000;
          duration = Math.round(diff);
        }
        return {
          id: j.databaseId,
          name: j.name,
          status: mapGitHubJobStatus(j.status, j.conclusion ?? null),
          web_url: j.url,
          duration,
          started_at: j.startedAt ?? null,
        };
      });
    }
  } catch (err) {
    process.stderr.write(`[pipeline] gh run view jobs failed for ${projectPath}: ${err}\n`);
    // Return pipeline without jobs rather than null
  }

  return {
    provider: "github",
    status: unifiedStatus,
    ref: run.headBranch,
    web_url: run.url,
    started_at: run.createdAt ?? null,
    duration: null,
    jobs,
  };
}

async function glabApi(endpoint: string, cwd: string): Promise<unknown> {
  const raw = await exec("glab", ["api", endpoint], cwd, 10000);
  return JSON.parse(raw);
}

// ----------------------------------------------------------------
// Fetch pipeline data
// ----------------------------------------------------------------

async function fetchPipeline(projectPath: string): Promise<PipelineData | null> {
  // 1. Get branch
  let branch: string;
  try {
    branch = await getGitBranch(projectPath);
  } catch {
    return null;
  }

  // 2. Get remote URL
  let remoteUrl: string;
  try {
    remoteUrl = await getGitRemoteUrl(projectPath);
  } catch {
    return null;
  }

  // 3. Detect provider
  const provider = detectProvider(remoteUrl);
  process.stderr.write(`[pipeline] ${projectPath}: branch=${branch} remote=${remoteUrl} provider=${provider}\n`);

  if (provider === "github") {
    const repoId = extractGitHubRepoId(remoteUrl);
    process.stderr.write(`[pipeline] ${projectPath}: github repoId=${repoId}\n`);
    if (!repoId) return null;
    return fetchGitHubPipeline(projectPath, branch, repoId);
  }

  if (provider !== "gitlab") return null;

  const projectId = extractGitLabProjectId(remoteUrl);
  process.stderr.write(`[pipeline] ${projectPath}: projectId=${projectId}\n`);
  if (!projectId) return null;

  const encodedId = encodeURIComponent(projectId);

  // 4. Get latest pipeline
  let pipelines: unknown[];
  try {
    const raw = await glabApi(
      `projects/${encodedId}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1&order_by=id&sort=desc`,
      projectPath
    );
    pipelines = Array.isArray(raw) ? raw : [];
  } catch (err) {
    process.stderr.write(`[pipeline] glab pipelines failed for ${projectPath}: ${err}\n`);
    return null;
  }

  process.stderr.write(`[pipeline] ${projectPath}: found ${pipelines.length} pipeline(s)\n`);
  if (pipelines.length === 0) return null;

  const pipeline = pipelines[0] as {
    id: number;
    status: string;
    ref: string;
    web_url: string;
    started_at: string | null;
    duration: number | null;
  };

  // 5. Get jobs
  let jobs: PipelineJob[] = [];
  try {
    const rawJobs = await glabApi(
      `projects/${encodedId}/pipelines/${pipeline.id}/jobs`,
      projectPath
    );
    if (Array.isArray(rawJobs)) {
      jobs = (rawJobs as Array<{
        id: number;
        name: string;
        status: string;
        web_url: string;
        duration: number | null;
        started_at: string | null;
      }>).map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status,
        web_url: j.web_url,
        duration: j.duration ?? null,
        started_at: j.started_at ?? null,
      }));
    }
  } catch (err) {
    process.stderr.write(`[pipeline] glab jobs failed for ${projectPath}: ${err}\n`);
    // Return pipeline without jobs rather than null
  }

  return {
    provider: "gitlab",
    status: pipeline.status,
    ref: pipeline.ref,
    web_url: pipeline.web_url,
    started_at: pipeline.started_at ?? null,
    duration: pipeline.duration ?? null,
    jobs,
  };
}

// ----------------------------------------------------------------
// GET /api/projects/:encodedPath/pipeline
// ----------------------------------------------------------------

router.get("/projects/:encodedPath/pipeline", async (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Check cache
  const cached = getCached(projectPath);
  if (cached !== undefined) {
    res.json(cached.data);
    return;
  }

  try {
    const data = await fetchPipeline(projectPath);
    cache.set(projectPath, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    process.stderr.write(`[pipeline] unexpected error for ${projectPath}: ${err}\n`);
    cache.set(projectPath, { data: null, fetchedAt: Date.now() });
    res.json(null);
  }
});

export default router;
