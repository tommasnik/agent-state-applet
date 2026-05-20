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
});
