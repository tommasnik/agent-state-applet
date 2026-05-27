import * as fs from "fs";
import * as path from "path";

export interface SubProject {
  name: string;
  path: string;
  hasBacklog: true;
}

export interface Project {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasMcpJson: boolean;
  hasSkills: boolean;
  hasBacklog: boolean;
  agentYaml?: string;
  subProjects: SubProject[];
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".venv", "dist", "__pycache__"]);

function isProject(dirPath: string): boolean {
  try {
    return (
      fs.existsSync(path.join(dirPath, ".git")) ||
      fs.existsSync(path.join(dirPath, "CLAUDE.md")) ||
      fs.existsSync(path.join(dirPath, "AGENTS.md"))
    );
  } catch {
    return false;
  }
}

function readAgentYaml(dirPath: string): string | undefined {
  const claudeDir = path.join(dirPath, ".claude");
  if (!fs.existsSync(claudeDir)) return undefined;

  try {
    const entries = fs.readdirSync(claudeDir);
    const yamlFile = entries.find((e) => e.endsWith(".yaml"));
    if (!yamlFile) return undefined;
    return fs.readFileSync(path.join(claudeDir, yamlFile), "utf-8");
  } catch {
    return undefined;
  }
}

export function findSubProjects(projectPath: string, maxDepth = 3): SubProject[] {
  const results: SubProject[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      // A sub-project is a dir that contains backlog/
      if (fs.existsSync(path.join(full, "backlog"))) {
        try {
          if (fs.statSync(path.join(full, "backlog")).isDirectory()) {
            results.push({ name: path.basename(full), path: full, hasBacklog: true });
            // Don't recurse into a sub-project
            continue;
          }
        } catch {/* ignore */}
      }
      walk(full, depth + 1);
    }
  }

  walk(projectPath, 1);
  return results;
}

function scanDir(dirPath: string): Project | null {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  if (!isProject(dirPath)) return null;

  const hasClaudeMd = fs.existsSync(path.join(dirPath, "CLAUDE.md"));
  const hasMcpJson =
    fs.existsSync(path.join(dirPath, ".claude", "mcp.json")) ||
    fs.existsSync(path.join(dirPath, "mcp.json"));
  const hasSkills = fs.existsSync(path.join(dirPath, ".claude", "skills"));
  const hasBacklog = (() => {
    try {
      return fs.statSync(path.join(dirPath, "backlog")).isDirectory();
    } catch {
      return false;
    }
  })();
  const agentYaml = readAgentYaml(dirPath);
  const subProjects = findSubProjects(dirPath);

  return {
    name: path.basename(dirPath),
    path: dirPath,
    hasClaudeMd,
    hasMcpJson,
    hasSkills,
    hasBacklog,
    agentYaml,
    subProjects,
  };
}

export function scanProjects(roots: string[]): Project[] {
  const projects: Project[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;

      const fullPath = path.join(root, entry);
      const project = scanDir(fullPath);
      if (project) {
        projects.push(project);
      }
    }
  }

  return projects;
}
