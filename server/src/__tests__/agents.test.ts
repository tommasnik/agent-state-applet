import { AgentStore } from "../agents";

describe("AgentStore", () => {
  let store: AgentStore;

  beforeEach(() => {
    store = new AgentStore();
  });

  // Test: nový agent se přidá
  test("upsert adds a new agent", () => {
    store.upsert({
      pid: 1234,
      cwd: "/home/user/project",
      state: "working",
      hook_event: "UserPromptSubmit",
      session_id: "sess-abc",
      project_root: "/home/user/project",
      tty: "/dev/pts/1",
      window_id: "0x1234",
      tab_name: "cc-sessabc",
      terminal_type: "idea",
    });

    const agent = store.get("1234");
    expect(agent).toBeDefined();
    expect(agent?.pid).toBe(1234);
    expect(agent?.state).toBe("working");
    expect(agent?.cwd).toBe("/home/user/project");
  });

  // Test: started_at se nenastaví znovu při update
  test("started_at is preserved across updates", () => {
    store.upsert({
      pid: 1234,
      state: "initialized",
      hook_event: "SessionStart",
    });

    const first = store.get("1234");
    const startedAt = first?.started_at;
    expect(startedAt).toBeDefined();

    // Wait a tiny bit to ensure timestamp would differ
    const before = Date.now() / 1000;

    store.upsert({
      pid: 1234,
      state: "working",
      hook_event: "UserPromptSubmit",
    });

    const second = store.get("1234");
    expect(second?.started_at).toBe(startedAt);
    expect(second?.started_at).toBeLessThanOrEqual(before);
  });

  // Test: TTY collision (nová session na stejném TTY smaže starou done)
  test("TTY collision: new SessionStart on same TTY removes old done agent", () => {
    // Old agent with done state on /dev/pts/3
    store.upsert({
      pid: 1000,
      state: "done",
      hook_event: "Stop",
      tty: "/dev/pts/3",
    });
    expect(store.has("1000")).toBe(true);

    // New session starts on same TTY
    store.upsert({
      pid: 2000,
      state: "initialized",
      hook_event: "SessionStart",
      tty: "/dev/pts/3",
    });

    // Old done agent should be removed
    expect(store.has("1000")).toBe(false);
    // New agent should exist
    expect(store.has("2000")).toBe(true);
  });

  // TTY collision does NOT remove non-done agents
  test("TTY collision: does not remove non-done agent on same TTY", () => {
    store.upsert({
      pid: 1000,
      state: "working",
      hook_event: "UserPromptSubmit",
      tty: "/dev/pts/3",
    });

    store.upsert({
      pid: 2000,
      state: "initialized",
      hook_event: "SessionStart",
      tty: "/dev/pts/3",
    });

    // Working agent should NOT be removed
    expect(store.has("1000")).toBe(true);
    expect(store.has("2000")).toBe(true);
  });

  // Test: window_id se neaktualizuje pokud přichozí hodnota je prázdná
  test("window_id is preserved when incoming value is empty", () => {
    store.upsert({
      pid: 1234,
      state: "initialized",
      hook_event: "SessionStart",
      window_id: "0xABCD",
    });
    expect(store.get("1234")?.window_id).toBe("0xABCD");

    // Update with no window_id — should preserve existing
    store.upsert({
      pid: 1234,
      state: "working",
      hook_event: "PreToolUse",
      window_id: "",
    });
    expect(store.get("1234")?.window_id).toBe("0xABCD");
  });

  test("window_id IS updated for UserPromptSubmit", () => {
    store.upsert({
      pid: 1234,
      state: "initialized",
      hook_event: "SessionStart",
      window_id: "0xABCD",
    });

    store.upsert({
      pid: 1234,
      state: "working",
      hook_event: "UserPromptSubmit",
      window_id: "0x5678",
    });
    expect(store.get("1234")?.window_id).toBe("0x5678");
  });

  // Test: session_end removes the agent
  test("session_end removes the agent", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    expect(store.has("1234")).toBe(true);

    store.upsert({ pid: 1234, state: "session_end", hook_event: "Stop" });
    expect(store.has("1234")).toBe(false);
  });

  // Test: waiting_for_approval does not overwrite done state
  test("waiting_for_approval does not overwrite done state", () => {
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });

    // Notification fires after Stop — should be ignored
    store.upsert({ pid: 1234, state: "waiting_for_approval", hook_event: "Notification" });

    expect(store.get("1234")?.state).toBe("done");
  });

  // Test: ai_title is preserved and not overwritten from hook
  test("ai_title is preserved and not overwritten from hook payload", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.setAiTitle("1234", "My AI Title");
    expect(store.get("1234")?.ai_title).toBe("My AI Title");

    // Another upsert should not overwrite ai_title
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    expect(store.get("1234")?.ai_title).toBe("My AI Title");
  });

  // Test: setAiTitle does not overwrite existing title
  test("setAiTitle does not overwrite already-set title", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.setAiTitle("1234", "First Title");
    const result = store.setAiTitle("1234", "Second Title");

    expect(result).toBe(false);
    expect(store.get("1234")?.ai_title).toBe("First Title");
  });

  // Test: remove
  test("remove deletes agent and returns true", () => {
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    expect(store.remove("1234")).toBe(true);
    expect(store.has("1234")).toBe(false);
    expect(store.remove("1234")).toBe(false);
  });

  // Test: onChange listener fires on upsert
  test("onChange listener fires on state changes", () => {
    const calls: number[] = [];
    store.onChange(() => calls.push(1));

    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    expect(calls.length).toBe(1);

    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    expect(calls.length).toBe(2);
  });

  // Test: onChange listener does NOT fire for no-op (waiting_for_approval on done)
  test("onChange listener does NOT fire for no-op upsert", () => {
    const calls: number[] = [];
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    store.onChange(() => calls.push(1));

    // This should be silently ignored
    store.upsert({ pid: 1234, state: "waiting_for_approval", hook_event: "Notification" });
    expect(calls.length).toBe(0);
  });

  // Test: snapshot returns copy, not reference
  test("snapshot returns independent copy of agents", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    const snap = store.snapshot();
    snap["1234"].state = "mutated";

    // Original store should not be affected
    expect(store.get("1234")?.state).toBe("working");
  });

  // ---------------------------------------------------------------------------
  // prompt
  // ---------------------------------------------------------------------------

  test("prompt is empty string on new agent", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    expect(store.get("1234")?.prompt).toBe("");
  });

  test("prompt is set when provided on UserPromptSubmit", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit", prompt: "fix the auth bug" });
    expect(store.get("1234")?.prompt).toBe("fix the auth bug");
  });

  test("prompt is preserved across other events", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit", prompt: "fix the auth bug" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", tool_name: "Bash" });
    expect(store.get("1234")?.prompt).toBe("fix the auth bug");
  });

  test("prompt is updated when new UserPromptSubmit arrives", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit", prompt: "first prompt" });
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit", prompt: "second prompt" });
    expect(store.get("1234")?.prompt).toBe("second prompt");
  });

  // ---------------------------------------------------------------------------
  // activity
  // ---------------------------------------------------------------------------

  test("activity is empty array on new agent", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    expect(store.get("1234")?.activity).toEqual([]);
  });

  test("activity_item is appended to activity list", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Bash: git status" });
    expect(store.get("1234")?.activity).toEqual(["Bash: git status"]);
  });

  test("activity accumulates multiple items", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Bash: git diff" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Read: foo.ts" });
    expect(store.get("1234")?.activity).toEqual(["Bash: git diff", "Read: foo.ts"]);
  });

  test("activity is capped at 3 items, oldest dropped", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Bash: git diff" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Read: foo.ts" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Edit: bar.ts" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Write: baz.ts" });
    expect(store.get("1234")?.activity).toEqual(["Read: foo.ts", "Edit: bar.ts", "Write: baz.ts"]);
  });

  test("activity is preserved across events without activity_item", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Bash: ls" });
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    expect(store.get("1234")?.activity).toEqual(["Bash: ls"]);
  });

  test("activity is reset on new UserPromptSubmit", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", activity_item: "Bash: ls" });
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit", prompt: "new task" });
    expect(store.get("1234")?.activity).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // todos
  // ---------------------------------------------------------------------------

  test("todos is empty array on new agent", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    expect(store.get("1234")?.todos).toEqual([]);
  });

  test("todos are replaced when provided", () => {
    store.upsert({ pid: 1234, state: "working", hook_event: "UserPromptSubmit" });
    const todos = [{ id: "1", content: "Fix bug", status: "pending", priority: "high" }];
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", todos });
    expect(store.get("1234")?.todos).toEqual(todos);
  });

  test("todos are preserved when not in payload", () => {
    const todos = [{ id: "1", content: "Fix bug", status: "pending", priority: "high" }];
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", todos });
    store.upsert({ pid: 1234, state: "done", hook_event: "Stop" });
    expect(store.get("1234")?.todos).toEqual(todos);
  });

  test("todos are replaced wholesale on next TodoWrite", () => {
    const todos1 = [{ id: "1", content: "Task A", status: "pending", priority: "high" }];
    const todos2 = [
      { id: "1", content: "Task A", status: "completed", priority: "high" },
      { id: "2", content: "Task B", status: "in_progress", priority: "medium" },
    ];
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", todos: todos1 });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse", todos: todos2 });
    expect(store.get("1234")?.todos).toEqual(todos2);
  });

  // ---------------------------------------------------------------------------
  // agent_id / agent_type
  // ---------------------------------------------------------------------------

  test("agent_id and agent_type are empty string on new agent", () => {
    store.upsert({ pid: 1234, state: "initialized", hook_event: "SessionStart" });
    expect(store.get("1234")?.agent_id).toBe("");
    expect(store.get("1234")?.agent_type).toBe("");
  });

  test("agent_id and agent_type are set from payload", () => {
    store.upsert({ pid: 1234, state: "initialized", hook_event: "SessionStart", agent_id: "abc123", agent_type: "Explore" });
    expect(store.get("1234")?.agent_id).toBe("abc123");
    expect(store.get("1234")?.agent_type).toBe("Explore");
  });

  test("agent_id and agent_type are preserved across events", () => {
    store.upsert({ pid: 1234, state: "initialized", hook_event: "SessionStart", agent_id: "abc123", agent_type: "Explore" });
    store.upsert({ pid: 1234, state: "working", hook_event: "PreToolUse" });
    expect(store.get("1234")?.agent_id).toBe("abc123");
    expect(store.get("1234")?.agent_type).toBe("Explore");
  });

  // ---------------------------------------------------------------------------
  // parent_session_id linking
  // ---------------------------------------------------------------------------

  test("subagent stores parent_session_id", () => {
    store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });
    expect(store.get("2000")?.parent_session_id).toBe("parent-sess");
  });

  test("subagent without parent_session_id has undefined parent_session_id", () => {
    store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart" });
    expect(store.get("2000")?.parent_session_id).toBeUndefined();
  });

  test("registering subagent increments parent subagent_count", () => {
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "UserPromptSubmit" });
    expect(store.get("1000")?.subagent_count).toBe(0);

    store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });

    expect(store.get("1000")?.subagent_count).toBe(1);
  });

  test("re-upserting same subagent does not double-increment parent", () => {
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });
    store.upsert({ pid: 2000, session_id: "child-sess", state: "working", hook_event: "PreToolUse", parent_session_id: "parent-sess" });
    store.upsert({ pid: 2000, session_id: "child-sess", state: "done", hook_event: "Stop", parent_session_id: "parent-sess" });

    expect(store.get("1000")?.subagent_count).toBe(1);
  });

  test("two different subagents each increment parent once", () => {
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 2000, session_id: "child-a", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });
    store.upsert({ pid: 3000, session_id: "child-b", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });

    expect(store.get("1000")?.subagent_count).toBe(2);
  });

  test("subagent with nonexistent parent just stores parent_session_id without error", () => {
    expect(() => {
      store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart", parent_session_id: "ghost-parent" });
    }).not.toThrow();
    expect(store.get("2000")?.parent_session_id).toBe("ghost-parent");
  });

  test("parent subagent_count is preserved across its own subsequent events", () => {
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "UserPromptSubmit" });
    store.upsert({ pid: 2000, session_id: "child-sess", state: "initialized", hook_event: "SessionStart", parent_session_id: "parent-sess" });

    // Parent fires its own hook events after child registered
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "PreToolUse" });
    store.upsert({ pid: 1000, session_id: "parent-sess", state: "working", hook_event: "PostToolUse" });

    expect(store.get("1000")?.subagent_count).toBe(1);
  });
});
