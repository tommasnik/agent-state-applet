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
  provider: "gitlab";
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

function detectProvider(remoteUrl: string): "gitlab" | null {
  if (remoteUrl.includes("gitlab")) return "gitlab";
  return null;
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
