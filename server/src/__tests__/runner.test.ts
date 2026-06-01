import { EventEmitter } from "events";
import Database from "better-sqlite3";
import { initDb, setTestDb } from "../db";

// Mock child_process.spawn before importing runner
const mockChildProcess = new EventEmitter() as EventEmitter & { pid: number; unref: jest.Mock };
mockChildProcess.unref = jest.fn();
mockChildProcess.pid = 99999;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSpawn = jest.fn((..._args: any[]) => mockChildProcess);

jest.mock("child_process", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Mock ws broadcast to avoid side effects
jest.mock("../ws", () => ({
  broadcast: jest.fn(),
}));

// Import runner AFTER mocks are set up
import { runInteractive } from "../runner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const db = initDb(":memory:");

  // Insert a schedule so agent_id FK constraint is satisfied
  db.prepare(
    "INSERT INTO agents (id, name, project_path, prompt, cron, type, enabled) VALUES (1, 'test', '/tmp', 'do work', '* * * * *', 'interactive', 1)"
  ).run();

  setTestDb(db);
  return db;
}

// ---------------------------------------------------------------------------
// AC #1 — runs.pid equals child.pid after runInteractive
// ---------------------------------------------------------------------------
describe("runInteractive — PID written to DB", () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSpawn.mockClear();
    mockChildProcess.pid = 99999;
    db = setupDb();
  });

  test("runs.pid is set to the spawned child PID", () => {
    const runId = runInteractive(1, "/tmp/project", "do something", "scheduled");

    const row = db
      .prepare("SELECT pid FROM runs WHERE id = ?")
      .get(runId) as { pid: number };

    expect(row).toBeDefined();
    expect(row.pid).toBe(99999);
  });

  test("runs.pid reflects the actual child pid (different PID)", () => {
    mockChildProcess.pid = 12345;
    const runId = runInteractive(1, "/tmp/project", "do something", "scheduled");

    const row = db
      .prepare("SELECT pid FROM runs WHERE id = ?")
      .get(runId) as { pid: number };

    expect(row.pid).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// AC #2 — launch_type = 'scheduled' for cron-triggered runs
// ---------------------------------------------------------------------------
describe("runInteractive — launch_type 'scheduled'", () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSpawn.mockClear();
    db = setupDb();
  });

  test("launch_type is 'scheduled' when called with 'scheduled'", () => {
    const runId = runInteractive(1, "/tmp/project", "do something", "scheduled");

    const row = db
      .prepare("SELECT launch_type FROM runs WHERE id = ?")
      .get(runId) as { launch_type: string };

    expect(row.launch_type).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// AC #3 — launch_type = 'manual_trigger' for Run Now triggered runs
// ---------------------------------------------------------------------------
describe("runInteractive — launch_type 'manual_trigger'", () => {
  let db: Database.Database;

  beforeEach(() => {
    mockSpawn.mockClear();
    db = setupDb();
  });

  test("launch_type is 'manual_trigger' when called with 'manual_trigger'", () => {
    const runId = runInteractive(1, "/tmp/project", "do something", "manual_trigger");

    const row = db
      .prepare("SELECT launch_type FROM runs WHERE id = ?")
      .get(runId) as { launch_type: string };

    expect(row.launch_type).toBe("manual_trigger");
  });

  test("launch_type distincts between 'scheduled' and 'manual_trigger'", () => {
    const scheduledRunId = runInteractive(1, "/tmp/project", "do something", "scheduled");
    const manualRunId = runInteractive(1, "/tmp/project", "do something else", "manual_trigger");

    const scheduledRow = db
      .prepare("SELECT launch_type FROM runs WHERE id = ?")
      .get(scheduledRunId) as { launch_type: string };
    const manualRow = db
      .prepare("SELECT launch_type FROM runs WHERE id = ?")
      .get(manualRunId) as { launch_type: string };

    expect(scheduledRow.launch_type).toBe("scheduled");
    expect(manualRow.launch_type).toBe("manual_trigger");
  });
});

// ---------------------------------------------------------------------------
// AC #4 — SCHEDULE_ID env var present in child process env
// ---------------------------------------------------------------------------
describe("runInteractive — SCHEDULE_ID env var", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    setupDb();
  });

  test("SCHEDULE_ID is passed as env var to the spawned child", () => {
    runInteractive(1, "/tmp/project", "do something", "scheduled");

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnCall = mockSpawn.mock.calls[0] as unknown[];
    // spawn(cmd, args, options) — options is the 3rd argument
    const spawnOptions = spawnCall[2] as { env?: Record<string, string> };

    expect(spawnOptions.env).toBeDefined();
    expect(spawnOptions.env!["SCHEDULE_ID"]).toBe("1");
  });

  test("SCHEDULE_ID matches the scheduleId passed to runInteractive", () => {
    // Insert a second schedule to test a different ID
    const db = setupDb();
    db.prepare(
      "INSERT INTO agents (id, name, project_path, prompt, cron, type, enabled) VALUES (2, 'test2', '/tmp', 'do work', '* * * * *', 'interactive', 1)"
    ).run();
    setTestDb(db);

    runInteractive(2, "/tmp/project", "another task", "manual_trigger");

    const spawnOptions = (mockSpawn.mock.calls[0] as unknown[])[2] as { env?: Record<string, string> };
    expect(spawnOptions.env!["SCHEDULE_ID"]).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Interactive command — prompt vs. no-prompt
// ---------------------------------------------------------------------------
describe("runInteractive — bash command", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    setupDb();
  });

  function spawnedCommand(): string {
    const argv = (mockSpawn.mock.calls[0] as unknown[])[1] as string[];
    return argv[argv.length - 1];
  }

  test("with a prompt → runs `claude '<prompt>'`", () => {
    runInteractive(1, "/tmp/project", "do something", "manual_trigger");
    expect(spawnedCommand()).toContain("claude 'do something'");
  });

  test("empty prompt → runs plain `claude` (no prompt arg)", () => {
    runInteractive(1, "/tmp/project", "", "manual_trigger");
    const cmd = spawnedCommand();
    expect(cmd).toContain("&& claude ;");
    expect(cmd).not.toContain("claude ''");
  });

  test("whitespace-only prompt → runs plain `claude`", () => {
    runInteractive(1, "/tmp/project", "   ", "manual_trigger");
    expect(spawnedCommand()).toContain("&& claude ;");
  });
});
