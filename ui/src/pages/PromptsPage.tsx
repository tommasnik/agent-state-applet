import { useState, useEffect, useCallback } from "react";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

interface Usage {
  projectName: string;
  projectPath: string;
  claudeMdPath: string;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function encodePath(p: string): string {
  return btoa(unescape(encodeURIComponent(p)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ----------------------------------------------------------------
// TreeNodeRow
// ----------------------------------------------------------------

interface TreeNodeRowProps {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}

function TreeNodeRow({ node, selectedPath, onSelect, depth }: TreeNodeRowProps) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "dir") {
    return (
      <div>
        <button
          className="pt-dir-row"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className={`pt-chevron ${expanded ? "open" : ""}`}>▶</span>
          <span className="pt-dir-name">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // file node
  const isActive = node.path === selectedPath;
  return (
    <button
      className={`pt-file-row ${isActive ? "active" : ""}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={() => onSelect(node.path)}
    >
      <span className="pt-file-icon">·</span>
      <span className="pt-file-name">{node.name.replace(/\.md$/, "")}</span>
    </button>
  );
}

// ----------------------------------------------------------------
// PromptDetail
// ----------------------------------------------------------------

interface PromptDetailProps {
  filePath: string;
  vaultRoot: string;
}

function PromptDetail({ filePath, vaultRoot }: PromptDetailProps) {
  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usages, setUsages] = useState<Usage[] | null>(null);

  const encoded = encodePath(filePath);
  const displayPath = filePath.startsWith(vaultRoot)
    ? filePath.slice(vaultRoot.length).replace(/^\//, "")
    : filePath;

  // Load file content
  useEffect(() => {
    setContent(null);
    setUsages(null);
    setSaved(false);
    fetch(`/api/prompts/${encoded}`)
      .then((r) => r.json())
      .then((data: { content: string }) => {
        setContent(data.content);
        setEditContent(data.content);
      })
      .catch(() => {
        setContent("");
        setEditContent("");
      });
  }, [encoded]);

  // Load usages
  useEffect(() => {
    fetch(`/api/prompts/${encoded}/usages`)
      .then((r) => r.json())
      .then((data: Usage[]) => setUsages(data))
      .catch(() => setUsages([]));
  }, [encoded]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/prompts/${encoded}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setContent(editContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [encoded, editContent]);

  return (
    <div className="pd-container">
      {/* Header */}
      <header className="pd-head">
        <div className="pd-meta">
          <h2 className="pd-name">{displayPath.split("/").pop()?.replace(/\.md$/, "")}</h2>
          <div className="pd-path">
            <code>{displayPath}</code>
          </div>
        </div>
      </header>

      {/* Editor */}
      <section className="pd-block">
        <div className="pd-block-head pd-block-head-row">
          Content
          <button
            className="btn btn-primary pd-edit-btn"
            onClick={handleSave}
            disabled={saving || content === null}
          >
            {saving ? "Saving…" : saved ? "Saved!" : "Save"}
          </button>
        </div>
        {content === null ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div className="pd-editor">
            <textarea
              className="field-textarea pd-editor-textarea pd-prompt-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={20}
            />
          </div>
        )}
      </section>

      {/* Usages */}
      <section className="pd-block">
        <div className="pd-block-head">
          Used in projects
          {usages !== null && (
            <span className="section-count">{usages.length}</span>
          )}
        </div>
        {usages === null ? (
          <div className="empty-state">Loading…</div>
        ) : usages.length === 0 ? (
          <div className="empty-state">Not used in any project.</div>
        ) : (
          <div className="pd-list">
            {usages.map((u) => (
              <div key={u.projectPath} className="pd-list-row">
                <span className="pd-list-dot" style={{ background: "var(--accent)" }} />
                <span className="pd-list-name">{u.projectName}</span>
                <code className="pd-list-tag">{u.claudeMdPath}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ----------------------------------------------------------------
// PromptsPage
// ----------------------------------------------------------------

export function PromptsPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [vaultRoot, setVaultRoot] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data: { tree: TreeNode[] }) => {
        setTree(data.tree);
        // Auto-select first file
        if (data.tree.length > 0 && !selectedPath) {
          const firstFile = findFirstFile(data.tree);
          if (firstFile) setSelectedPath(firstFile);
        }
      })
      .catch(() => setTree([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine vault root from first tree node path
  useEffect(() => {
    if (tree.length > 0) {
      // All nodes share the same parent
      const firstNode = tree[0];
      const root = firstNode.path.substring(0, firstNode.path.lastIndexOf("/"));
      setVaultRoot(root);
    }
  }, [tree]);

  function findFirstFile(nodes: TreeNode[]): string | null {
    for (const node of nodes) {
      if (node.type === "file") return node.path;
      if (node.children) {
        const found = findFirstFile(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Count all files in tree
  function countFiles(nodes: TreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === "file") count++;
      else if (node.children) count += countFiles(node.children);
    }
    return count;
  }

  return (
    <div className="projects-page">
      {/* Left panel — tree */}
      <aside className="projects-master">
        <div className="projects-master-head">
          Master prompts{" "}
          <span className="section-count">{countFiles(tree)}</span>
        </div>
        <div className="projects-master-list">
          {tree.length === 0 ? (
            <div className="pm-empty">No prompt files found.</div>
          ) : (
            tree.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                depth={0}
              />
            ))
          )}
        </div>
      </aside>

      {/* Right panel — detail/editor */}
      <section className="projects-detail">
        {selectedPath ? (
          <PromptDetail
            key={selectedPath}
            filePath={selectedPath}
            vaultRoot={vaultRoot}
          />
        ) : (
          <div className="pd-placeholder">Select a prompt file to edit.</div>
        )}
      </section>
    </div>
  );
}
