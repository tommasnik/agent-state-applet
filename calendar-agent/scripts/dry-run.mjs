/**
 * Dry-run driver for the Calendar Agent — SAFE, READ-ONLY.
 *
 * Mirrors the host's query() setup (config, system prompt, Google bearer
 * injection) but:
 *   - sends a one-shot string kickoff prompt (runs a single turn, then exits),
 *   - restricts allowedTools to READ-ONLY MCP tools (no create/update/delete
 *     event, no WhatsApp send_*), so it physically cannot write anywhere,
 *   - prints the agent's reasoning, every MCP tool call, and the final result.
 *
 * Run:  node calendar-agent/scripts/dry-run.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { query } = await import("@anthropic-ai/claude-agent-sdk");
const cfgMod = require("../dist/config.js");
const promptMod = require("../dist/prompt.js");
const googleToolsMod = require("../dist/googleTools.js");

const config = cfgMod.loadConfig();
const systemPrompt = promptMod.loadSystemPrompt();
const wl = config.whitelist;

// Build the in-process Google MCP servers (Calendar + Gmail over raw REST),
// exactly like the host does, and merge with the configured stdio servers.
const google = await googleToolsMod.buildGoogleMcpServers();
const mcpServers = {
  ...config.mcpServers,
  calendar: google.calendar,
  gmail: google.gmail,
};
console.log("[dry-run] in-process Google MCP servers wired: calendar, gmail");

// READ-ONLY allowlist: explicitly no create/update/delete_event, no send_*.
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
];

const groups = (wl.whatsapp?.groups ?? []).join(", ");
const labels = (wl.gmail?.labels ?? []).join(", ");

const kickoff = `DRY RUN — READ ONLY. Do NOT create, update, or delete any calendar event; do NOT send any WhatsApp message. This is an observation pass only.

Read the most recent messages (roughly the last 14 days) from these whitelisted WhatsApp groups: ${groups}.
Also look at Gmail messages carrying the label: ${labels}.

Identify any calendar-worthy commitments (something with a clear date/time/deadline). For EACH one, report as a short list item:
  - What event you WOULD create or update on the AI calendar (title + date/time)
  - The exact source (which group/message or which email)
  - Whether you would CREATE new or UPDATE an existing event (you may read the AI calendar to check), or ESCALATE because it's ambiguous.

Then list anything you would ESCALATE and why. Do not write anything — just report what you would do.`;

console.log("\n[dry-run] whitelisted groups:", groups);
console.log("[dry-run] gmail label:", labels);
console.log("[dry-run] starting one-shot read-only turn...\n");

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
        const arg = JSON.stringify(block.input ?? {}).slice(0, 160);
        console.log(`  [tool] ${block.name} ${arg}`);
      }
    }
  } else if (msg.type === "result") {
    console.log("\n[result]", msg.subtype);
    if (msg.subtype === "success") console.log(msg.result);
  }
}
console.log("\n[dry-run] done.");
