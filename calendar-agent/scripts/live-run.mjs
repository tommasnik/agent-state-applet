/**
 * LIVE run driver for the Calendar Agent — WRITES to the AI calendar.
 *
 * Same wiring as the host (config, prompt, in-process Google tools, AI-calendar
 * enforcement), but feeds a one-shot kickoff that tells the agent to actually
 * CREATE/UPDATE events on the dedicated AI calendar. Writes to any other
 * calendar are physically rejected by the tools (aiCalendarId enforcement).
 *
 * WhatsApp send_* and calendar delete are NOT in the allowlist. Escalations are
 * reported as text (no approval-queue server wired in this standalone driver).
 *
 * Run:  node calendar-agent/scripts/live-run.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { query } = await import("@anthropic-ai/claude-agent-sdk");
const cfgMod = require("../dist/config.js");
const promptMod = require("../dist/prompt.js");
const hostMod = require("../dist/host.js");
const googleToolsMod = require("../dist/googleTools.js");

const config = cfgMod.loadConfig();
const basePrompt = promptMod.loadSystemPrompt();
const aiCal = config.aiCalendarId;
const systemPrompt = hostMod.withAiCalendarRuntime
  ? hostMod.withAiCalendarRuntime(basePrompt, aiCal)
  : basePrompt;
const wl = config.whitelist;

const google = await googleToolsMod.buildGoogleMcpServers({ aiCalendarId: aiCal });
const mcpServers = { ...config.mcpServers, calendar: google.calendar, gmail: google.gmail };

// Read everywhere; write ONLY create/update (enforced to the AI calendar by the
// tools). No delete, no WhatsApp send.
const allowedTools = [
  "mcp__whatsapp__list_chats",
  "mcp__whatsapp__list_messages",
  "mcp__whatsapp__get_chat",
  "mcp__whatsapp__get_message_context",
  "mcp__whatsapp__get_last_interaction",
  "mcp__gmail__list_messages",
  "mcp__gmail__get_message",
  "mcp__gmail__list_labels",
  "mcp__calendar__list_calendars",
  "mcp__calendar__list_events",
  "mcp__calendar__get_event",
  "mcp__calendar__create_event",
  "mcp__calendar__update_event",
];

const groups = (wl.whatsapp?.groups ?? []).join(", ");
const labels = (wl.gmail?.labels ?? []).join(", ");

const kickoff = `LIVE RUN. This is a real run — you MAY create and update events on the dedicated AI calendar (its id is in your runtime configuration; the tools reject writes to any other calendar).

1. Read the most recent messages (roughly the last 14 days) from these whitelisted WhatsApp groups: ${groups}.
2. Read Gmail messages carrying the label: ${labels}.
3. Read the AI calendar's existing events first (list_events) so you can DEDUP: if a commitment already has a matching event, UPDATE it (keep + extend the sources); otherwise CREATE a new event.
4. For each calendar-worthy commitment with a clear date/time/deadline, create or update the event on the AI calendar. Put the concrete SOURCES in the event description (which WhatsApp group/message or which email).
5. Be conservative: if a commitment is ambiguous or missing a clear date/time, DO NOT create it — instead list it under "ESCALATIONS" at the end with the reason. (No approval queue is wired here, so just report escalations as text.)

When done, print a short summary: which events you CREATED, which you UPDATED, and which you ESCALATED.`;

console.log("[live-run] AI calendar id:", aiCal);
console.log("[live-run] groups:", groups);
console.log("[live-run] gmail label:", labels);
console.log("[live-run] starting LIVE turn (writes enabled, AI calendar only)...\n");

const stream = query({
  prompt: kickoff,
  options: { systemPrompt, model: config.model, mcpServers, allowedTools },
});

for await (const msg of stream) {
  if (msg.type === "system" && msg.subtype === "init") {
    const servers = (msg.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`);
    console.log("[mcp servers]", servers.join("  "));
  } else if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text" && block.text.trim()) {
        console.log("\n[agent]", block.text.trim());
      } else if (block.type === "tool_use") {
        const arg = JSON.stringify(block.input ?? {}).slice(0, 220);
        console.log(`  [tool] ${block.name} ${arg}`);
      }
    }
  } else if (msg.type === "result") {
    console.log("\n[result]", msg.subtype);
    if (msg.subtype === "success") console.log(msg.result);
  }
}
console.log("\n[live-run] done.");
