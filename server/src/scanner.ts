import * as fs from "fs";
import * as path from "path";

export interface Project {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasMcpJson: boolean;
  hasSkills: boolean;
  agentYaml?: string;
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
  const agentYaml = readAgentYaml(dirPath);

  return {
    name: path.basename(dirPath),
    path: dirPath,
    hasClaudeMd,
    hasMcpJson,
    hasSkills,
    agentYaml,
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
