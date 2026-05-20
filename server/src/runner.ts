import { spawn } from "child_process";
import { getDb } from "./db";
import { broadcast } from "./ws";

function insertRun(scheduleId: number): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO runs (schedule_id, started_at, status) VALUES (?, datetime('now'), 'running')"
  );
  const result = stmt.run(scheduleId);
  return result.lastInsertRowid as number;
}

function finalizeRun(runId: number, status: "success" | "failed", output: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE runs SET finished_at = datetime('now'), status = ?, output = ? WHERE id = ?"
  ).run(status, output, runId);
}

/**
 * Launch an interactive Ghostty terminal running Claude Code.
 * Returns the run ID recorded in the DB (status stays 'running' — no exit tracking).
 */
export function runInteractive(
  scheduleId: number,
  projectPath: string,
  prompt: string
): number {
  const runId = insertRun(scheduleId);

  const child = spawn(
    "ghostty",
    [`--working-directory=${projectPath}`, "-e", "claude", "--prompt", prompt],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  return runId;
}

/**
 * Run Claude Code headlessly (--print mode), streaming stdout/stderr over WebSocket.
 */
export function runHeadless(
  scheduleId: number,
  projectPath: string,
  prompt: string
): void {
  const runId = insertRun(scheduleId);

  const proc = spawn("claude", ["--print", prompt], {
    cwd: projectPath,
    env: { ...process.env },
  });

  let output = "";

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    broadcast({ event: "run_output", runId, chunk: text });
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    broadcast({ event: "run_output", runId, chunk: text });
  });

  proc.on("close", (code: number | null) => {
    const status = code === 0 ? "success" : "failed";
    finalizeRun(runId, status, output);
    broadcast({ event: "run_finished", runId, status });
  });
}
