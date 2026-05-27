import * as cron from "node-cron";
import { getDb } from "./db";
import { runInteractive, runHeadless } from "./runner";

interface Schedule {
  id: number;
  name: string;
  project_path: string;
  prompt: string;
  cron: string;
  type: "interactive" | "headless";
  enabled: number;
}

const tasks = new Map<number, cron.ScheduledTask>();

function executeSchedule(schedule: Schedule): void {
  if (schedule.type === "interactive") {
    runInteractive(schedule.id, schedule.project_path, schedule.prompt, 'scheduled');
  } else {
    runHeadless(schedule.id, schedule.project_path, schedule.prompt, 'scheduled');
  }
}

/** Register a cron job for a single schedule (replaces any existing one). */
export function scheduleAdd(schedule: Schedule): void {
  // Remove existing task if present
  scheduleRemove(schedule.id);

  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cron)) {
    console.error(`[scheduler] Invalid cron expression for schedule ${schedule.id}: "${schedule.cron}"`);
    return;
  }

  const task = cron.schedule(schedule.cron, () => executeSchedule(schedule));
  tasks.set(schedule.id, task);
}

/** Stop and remove the cron job for a schedule. */
export function scheduleRemove(id: number): void {
  const existing = tasks.get(id);
  if (existing) {
    existing.stop();
    tasks.delete(id);
  }
}

/** Update a schedule (stop old job, start new one). */
export function scheduleUpdate(schedule: Schedule): void {
  scheduleAdd(schedule);
}

/** Load all enabled schedules from DB and register their cron jobs. */
export function schedulerInit(): void {
  const db = getDb();
  const schedules = db.prepare("SELECT * FROM schedules WHERE enabled = 1").all() as Schedule[];

  for (const schedule of schedules) {
    scheduleAdd(schedule);
  }

  console.log(`[scheduler] Initialized ${schedules.length} schedule(s).`);
}
