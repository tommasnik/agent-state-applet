import * as cron from "node-cron";
import { getDb } from "./db";
import { runInteractive, runHeadless, runCalendarAgent, runCalendarAgentCli } from "./runner";

interface AgentConfig {
  id: number;
  name: string;
  project_path: string;
  prompt: string | null;
  cron: string | null;
  type: "interactive" | "headless" | "calendar_agent" | "calendar_agent_cli";
  enabled: number;
}

const tasks = new Map<number, cron.ScheduledTask>();

function executeSchedule(agent: AgentConfig): void {
  const prompt = agent.prompt ?? "";
  if (agent.type === "calendar_agent") {
    runCalendarAgent(agent.id, agent.project_path, 'scheduled');
  } else if (agent.type === "calendar_agent_cli") {
    runCalendarAgentCli(agent.id, agent.project_path, 'scheduled');
  } else if (agent.type === "interactive") {
    runInteractive(agent.id, agent.project_path, prompt, 'scheduled');
  } else {
    runHeadless(agent.id, agent.project_path, prompt, 'scheduled');
  }
}

/**
 * Register a cron job for a single agent (replaces any existing one).
 * Agents without a cron expression are not scheduled — they only run on demand.
 */
export function scheduleAdd(agent: AgentConfig): void {
  // Remove existing task if present
  scheduleRemove(agent.id);

  if (!agent.enabled) return;
  if (!agent.cron || !agent.cron.trim()) return; // on-demand agent, no schedule
  if (!cron.validate(agent.cron)) {
    console.error(`[scheduler] Invalid cron expression for agent ${agent.id}: "${agent.cron}"`);
    return;
  }

  const task = cron.schedule(agent.cron, () => executeSchedule(agent));
  tasks.set(agent.id, task);
}

/** Stop and remove the cron job for an agent. */
export function scheduleRemove(id: number): void {
  const existing = tasks.get(id);
  if (existing) {
    existing.stop();
    tasks.delete(id);
  }
}

/** Update an agent (stop old job, start new one). */
export function scheduleUpdate(agent: AgentConfig): void {
  scheduleAdd(agent);
}

/** Load all enabled, scheduled agents from DB and register their cron jobs. */
export function schedulerInit(): void {
  const db = getDb();
  const agents = db
    .prepare("SELECT * FROM agents WHERE enabled = 1 AND cron IS NOT NULL AND cron <> ''")
    .all() as AgentConfig[];

  for (const agent of agents) {
    scheduleAdd(agent);
  }

  console.log(`[scheduler] Initialized ${agents.length} scheduled agent(s).`);
}
