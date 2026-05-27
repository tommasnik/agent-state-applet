import { spawn } from "child_process";
import { getDb } from "./db";
import { broadcast } from "./ws";

function insertRun(scheduleId: number, launchType: 'scheduled' | 'manual_trigger'): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO runs (schedule_id, started_at, status, launch_type) VALUES (?, datetime('now'), 'running', ?)"
  );
  const result = stmt.run(scheduleId, launchType);
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
  prompt: string,
  launchType: 'scheduled' | 'manual_trigger' = 'scheduled'
): number {
  const runId = insertRun(scheduleId, launchType);

  const escapedPath = projectPath.replace(/'/g, "'\\''");
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const display = process.env.DISPLAY || ":0";
  const child = spawn(
    "ghostty",
    [`--working-directory=${projectPath}`, "-e", "bash", "-lic", `cd '${escapedPath}' && claude '${escapedPrompt}' ; exec bash`],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, DISPLAY: display, SCHEDULE_ID: scheduleId.toString() },
    }
  );

  // Write child PID to DB immediately after spawn
  if (child.pid !== undefined) {
    getDb().prepare("UPDATE runs SET pid = ? WHERE id = ?").run(child.pid, runId);
  }

  child.on("error", (err) => {
    console.error(`[runner] ghostty launch failed: ${err.message}`);
    finalizeRun(runId, "failed", `Launch failed: ${err.message}`);
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[runner] ghostty exited with code ${code} (DISPLAY=${display})`);
      finalizeRun(runId, "failed", `Ghostty exited with code ${code}`);
    }
  });
  child.unref();

  return runId;
}

/**
 * Launch an interactive Ghostty terminal without recording a DB run.
 * Used for ad-hoc implement actions from the UI (no schedule context).
 * Returns 0 as a placeholder run ID.
 */
export function runInteractiveAnon(projectPath: string, prompt: string): number {
  const escapedPath = projectPath.replace(/'/g, "'\\''");
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const display = process.env.DISPLAY || ":0";
  const child = spawn(
    "ghostty",
    [`--working-directory=${projectPath}`, "-e", "bash", "-lic", `cd '${escapedPath}' && claude '${escapedPrompt}' ; exec bash`],
    { detached: true, stdio: "ignore", env: { ...process.env, DISPLAY: display } }
  );
  child.on("error", (err) => {
    console.error(`[runner] ghostty launch failed: ${err.message}`);
  });
  child.unref();
  return 0;
}

/**
 * Run Claude Code headlessly (--print mode), streaming stdout/stderr over WebSocket.
 */
export function runHeadless(
  scheduleId: number,
  projectPath: string,
  prompt: string,
  launchType: 'scheduled' | 'manual_trigger' = 'scheduled'
): void {
  const runId = insertRun(scheduleId, launchType);

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
