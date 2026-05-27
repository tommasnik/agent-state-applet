import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { scanProjects } from "../scanner";

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scanner-test-"));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("scanProjects", () => {
  test("empty root returns empty array", () => {
    const root = mkTmpDir();
    try {
      const result = scanProjects([root]);
      expect(result).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("non-existent root returns empty array", () => {
    const result = scanProjects(["/tmp/definitely-does-not-exist-12345"]);
    expect(result).toEqual([]);
  });

  test("directory with .git is included as project", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "my-project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));

      const result = scanProjects([root]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("my-project");
      expect(result[0].path).toBe(projectDir);
    } finally {
      cleanup(root);
    }
  });

  test("directory with CLAUDE.md is included as project", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "claude-project");
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), "# Claude");

      const result = scanProjects([root]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-project");
      expect(result[0].hasClaudeMd).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test("directory with AGENTS.md is included as project", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "agents-project");
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, "AGENTS.md"), "# Agents");

      const result = scanProjects([root]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("agents-project");
    } finally {
      cleanup(root);
    }
  });

  test("directory without .git/CLAUDE.md/AGENTS.md is not included", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "not-a-project");
      fs.mkdirSync(projectDir);
      fs.writeFileSync(path.join(projectDir, "README.md"), "just a readme");

      const result = scanProjects([root]);
      expect(result).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("node_modules is ignored", () => {
    const root = mkTmpDir();
    try {
      const nmDir = path.join(root, "node_modules");
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, ".git"));

      const result = scanProjects([root]);
      expect(result).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test(".git directory itself is ignored", () => {
    const root = mkTmpDir();
    try {
      const gitDir = path.join(root, ".git");
      fs.mkdirSync(gitDir);

      const result = scanProjects([root]);
      expect(result).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test(".venv is ignored", () => {
    const root = mkTmpDir();
    try {
      const venvDir = path.join(root, ".venv");
      fs.mkdirSync(venvDir);
      fs.writeFileSync(path.join(venvDir, "CLAUDE.md"), "# shouldn't appear");

      const result = scanProjects([root]);
      expect(result).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("hasClaudeMd is false when CLAUDE.md absent", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));

      const result = scanProjects([root]);
      expect(result[0].hasClaudeMd).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  test("hasMcpJson detected via .claude/mcp.json", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));
      fs.mkdirSync(path.join(projectDir, ".claude"));
      fs.writeFileSync(path.join(projectDir, ".claude", "mcp.json"), "{}");

      const result = scanProjects([root]);
      expect(result[0].hasMcpJson).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test("hasSkills detected via .claude/skills/ directory", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));
      fs.mkdirSync(path.join(projectDir, ".claude", "skills"), { recursive: true });

      const result = scanProjects([root]);
      expect(result[0].hasSkills).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test("agentYaml is undefined when no yaml in .claude/", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));

      const result = scanProjects([root]);
      expect(result[0].agentYaml).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });

  test("agentYaml contains file content when yaml exists in .claude/", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));
      fs.mkdirSync(path.join(projectDir, ".claude"));
      fs.writeFileSync(path.join(projectDir, ".claude", "agent.yaml"), "name: test-agent");

      const result = scanProjects([root]);
      expect(result[0].agentYaml).toBe("name: test-agent");
    } finally {
      cleanup(root);
    }
  });

  test("multiple roots are scanned", () => {
    const root1 = mkTmpDir();
    const root2 = mkTmpDir();
    try {
      const p1 = path.join(root1, "proj1");
      const p2 = path.join(root2, "proj2");
      fs.mkdirSync(p1);
      fs.mkdirSync(path.join(p1, ".git"));
      fs.mkdirSync(p2);
      fs.writeFileSync(path.join(p2, "CLAUDE.md"), "# proj2");

      const result = scanProjects([root1, root2]);
      expect(result).toHaveLength(2);
      const names = result.map((p) => p.name);
      expect(names).toContain("proj1");
      expect(names).toContain("proj2");
    } finally {
      cleanup(root1);
      cleanup(root2);
    }
  });

  test("hasBacklog is true when backlog/ directory exists at project root", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));
      fs.mkdirSync(path.join(projectDir, "backlog", "tasks"), { recursive: true });

      const result = scanProjects([root]);
      expect(result[0].hasBacklog).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test("hasBacklog is false when backlog/ directory is absent", () => {
    const root = mkTmpDir();
    try {
      const projectDir = path.join(root, "project");
      fs.mkdirSync(projectDir);
      fs.mkdirSync(path.join(projectDir, ".git"));

      const result = scanProjects([root]);
      expect(result[0].hasBacklog).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
