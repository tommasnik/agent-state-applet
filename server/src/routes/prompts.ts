import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig } from "../config";
import { scanProjects } from "../scanner";

const router = Router();

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function getVaultRoot(): string {
  const home = os.homedir();
  const config = loadConfig();
  // Find in projectRoots a path ending with 'AI-docs' or 'ai-docs'
  const vaultRoot = config.projectRoots.find((r) =>
    r.replace(/^~/, home).endsWith("AI-docs") ||
    r.replace(/^~/, home).endsWith("ai-docs")
  );
  return vaultRoot?.replace(/^~/, home) ?? path.join(home, "ai-docs", "AI-docs");
}

function decodePath(encoded: string): string {
  // base64url decode
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function validatePath(filePath: string): boolean {
  const vaultRoot = getVaultRoot();
  const normalized = path.resolve(filePath);
  const normalizedRoot = path.resolve(vaultRoot);
  // Reject path traversal attempts
  if (normalized.includes("..")) return false;
  return (
    normalized.startsWith(normalizedRoot + path.sep) ||
    normalized === normalizedRoot
  );
}

const IGNORED_DIRS = new Set([".obsidian", "node_modules", ".git"]);

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

function buildTree(dirPath: string): TreeNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];

  // Sort: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = buildTree(fullPath);
      // Only include directories that have .md files (recursively)
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: "dir",
          children,
        });
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: "file",
      });
    }
  }

  return nodes;
}

// ----------------------------------------------------------------
// GET /api/prompts
// ----------------------------------------------------------------

router.get("/prompts", (_req: Request, res: Response) => {
  const vaultRoot = getVaultRoot();
  if (!fs.existsSync(vaultRoot)) {
    res.json({ tree: [] });
    return;
  }
  const tree = buildTree(vaultRoot);
  res.json({ tree });
});

// ----------------------------------------------------------------
// GET /api/prompts/:encodedPath
// ----------------------------------------------------------------

router.get("/prompts/:encodedPath", (req: Request, res: Response) => {
  const filePath = decodePath(req.params.encodedPath);
  if (!validatePath(filePath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content });
  } catch {
    res.status(500).json({ error: "Failed to read file" });
  }
});

// ----------------------------------------------------------------
// PUT /api/prompts/:encodedPath
// ----------------------------------------------------------------

router.put("/prompts/:encodedPath", (req: Request, res: Response) => {
  const filePath = decodePath(req.params.encodedPath);
  if (!validatePath(filePath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const { content } = req.body as { content?: string };
  if (typeof content !== "string") {
    res.status(400).json({ error: "content must be a string" });
    return;
  }
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to write file" });
  }
});

// ----------------------------------------------------------------
// GET /api/prompts/:encodedPath/usages
// ----------------------------------------------------------------

router.get("/prompts/:encodedPath/usages", (req: Request, res: Response) => {
  const filePath = decodePath(req.params.encodedPath);
  if (!validatePath(filePath)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const config = loadConfig();
  const projects = scanProjects(config.projectRoots);
  const usages: { projectName: string; projectPath: string; claudeMdPath: string }[] = [];

  for (const project of projects) {
    const claudeMdPath = path.join(project.path, "CLAUDE.md");
    if (!fs.existsSync(claudeMdPath)) continue;

    let claudeMdContent: string;
    try {
      claudeMdContent = fs.readFileSync(claudeMdPath, "utf-8");
    } catch {
      continue;
    }

    // Check for @{absolute path} or @{relative path} patterns
    const absRef = `@${filePath}`;
    const relRef = `@${path.relative(project.path, filePath)}`;

    if (claudeMdContent.includes(absRef) || claudeMdContent.includes(relRef)) {
      usages.push({
        projectName: project.name,
        projectPath: project.path,
        claudeMdPath,
      });
    }
  }

  res.json(usages);
});

export default router;
