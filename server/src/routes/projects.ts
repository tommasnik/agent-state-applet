import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig } from "../config";
import { scanProjects } from "../scanner";
import { runInteractiveAnon } from "../runner";

const router = Router();

// ----------------------------------------------------------------
// Prompt constants for backlog implementation actions
// ----------------------------------------------------------------

export const PROMPT_IMPLEMENT_ALL = `/start-implementing-tasks`;
export const PROMPT_IMPLEMENT_NEXT = `/implement-here implementuj první To Do task z backlogu`;
export const PROMPT_IMPLEMENT_TASK = `/implement-here implementuj task {{taskId}} z backlogu`;

// ----------------------------------------------------------------
// Helpers
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
  // Reject path traversal attempts
  if (normalized.includes("..")) return false;
  return allowedRoots.some(
    (root) =>
      normalized.startsWith(path.resolve(root) + path.sep) ||
      normalized === path.resolve(root)
  );
}

// ----------------------------------------------------------------
// GET /api/projects
// ----------------------------------------------------------------

router.get("/projects", (_req: Request, res: Response) => {
  const config = loadConfig();
  const projects = scanProjects(config.projectRoots);
  res.json(projects);
});

// ----------------------------------------------------------------
// GET /api/projects/:encodedPath/claude-md
// ----------------------------------------------------------------

router.get("/projects/:encodedPath/claude-md", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const filePath = path.join(projectPath, "CLAUDE.md");
  if (!fs.existsSync(filePath)) {
    res.json({ content: "" });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Failed to read CLAUDE.md" });
  }
});

// ----------------------------------------------------------------
// PUT /api/projects/:encodedPath/claude-md
// ----------------------------------------------------------------

router.put("/projects/:encodedPath/claude-md", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const { content } = req.body as { content?: string };
  if (typeof content !== "string") {
    res.status(400).json({ error: "content must be a string" });
    return;
  }
  const filePath = path.join(projectPath, "CLAUDE.md");
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write CLAUDE.md" });
  }
});

// ----------------------------------------------------------------
// GET /api/projects/:encodedPath/skills
// ----------------------------------------------------------------

router.get("/projects/:encodedPath/skills", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const skillsDir = path.join(projectPath, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) {
    res.json([]);
    return;
  }
  try {
    const entries = fs.readdirSync(skillsDir);
    const skills = entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => ({
        name: e.replace(/\.md$/, ""),
        path: path.join(skillsDir, e),
      }));
    res.json(skills);
  } catch {
    res.json([]);
  }
});

// ----------------------------------------------------------------
// GET /api/projects/:encodedPath/mcp-json
// ----------------------------------------------------------------

router.get("/projects/:encodedPath/mcp-json", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  // Try .claude/mcp.json first, then mcp.json in project root
  const candidates = [
    path.join(projectPath, ".claude", "mcp.json"),
    path.join(projectPath, "mcp.json"),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.json({ content });
        return;
      } catch {
        break;
      }
    }
  }
  res.json({ content: "{}" });
});

// ----------------------------------------------------------------
// PUT /api/projects/:encodedPath/mcp-json
// ----------------------------------------------------------------

router.put("/projects/:encodedPath/mcp-json", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const { content } = req.body as { content?: string };
  if (typeof content !== "string") {
    res.status(400).json({ error: "content must be a string" });
    return;
  }
  // Validate JSON
  try {
    JSON.parse(content);
  } catch {
    res.status(400).json({ error: "content must be valid JSON" });
    return;
  }
  const claudeDir = path.join(projectPath, ".claude");
  if (!fs.existsSync(claudeDir)) {
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
    } catch {
      res.status(500).json({ error: "Failed to create .claude directory" });
      return;
    }
  }
  const filePath = path.join(claudeDir, "mcp.json");
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write mcp.json" });
  }
});

// ----------------------------------------------------------------
// GET /api/projects/:encodedPath/backlog
// ----------------------------------------------------------------

router.get("/projects/:encodedPath/backlog", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const tasksDir = path.join(projectPath, "backlog", "tasks");
  if (!fs.existsSync(tasksDir)) {
    res.json({ files: [] });
    return;
  }
  try {
    const entries = fs.readdirSync(tasksDir);
    const files = entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => {
        try {
          const content = fs.readFileSync(path.join(tasksDir, e), "utf-8");
          return { name: e, content };
        } catch {
          return { name: e, content: "" };
        }
      });
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

// ----------------------------------------------------------------
// POST /api/projects/:encodedPath/implement-all
// ----------------------------------------------------------------

router.post("/projects/:encodedPath/implement-all", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const runId = runInteractiveAnon(projectPath, PROMPT_IMPLEMENT_ALL);
  res.json({ ok: true, runId });
});

// ----------------------------------------------------------------
// POST /api/projects/:encodedPath/implement-next
// ----------------------------------------------------------------

router.post("/projects/:encodedPath/implement-next", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const runId = runInteractiveAnon(projectPath, PROMPT_IMPLEMENT_NEXT);
  res.json({ ok: true, runId });
});

// ----------------------------------------------------------------
// POST /api/projects/:encodedPath/implement/:taskId
// ----------------------------------------------------------------

router.post("/projects/:encodedPath/implement/:taskId", (req: Request, res: Response) => {
  const projectPath = decodePath(req.params.encodedPath);
  if (!validatePath(projectPath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const { taskId } = req.params;
  const prompt = PROMPT_IMPLEMENT_TASK.replace("{{taskId}}", taskId);
  const runId = runInteractiveAnon(projectPath, prompt);
  res.json({ ok: true, runId });
});

export default router;
