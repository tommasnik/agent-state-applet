import { loadConfig } from "./config";
import { CalendarAgentHost } from "./host";

/**
 * Entrypoint: `node dist/index.js` (i.e. `node calendar-agent` from the
 * package). Boots the long-lived Calendar Agent SDK host: connects the
 * configured MCP servers, opens the session, and keeps the process alive so
 * the session can wait for approvals.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const host = new CalendarAgentHost({ config });

  const mcp = host.configuredMcpServers();
  console.log(
    `[calendar-agent] starting host with ${mcp.length} MCP server(s): ` +
      (mcp.length ? mcp.join(", ") : "(none configured — see TASK-29)")
  );

  await host.start();
  console.log(`[calendar-agent] host status: ${host.getStatus()}`);
  console.log("[calendar-agent] session is live; waiting for input / approvals.");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[calendar-agent] received ${signal}, shutting down…`);
    await host.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Keep the process alive for the long-lived session. The session loop runs
  // in the background (driven by the message queue); we park here until a
  // shutdown signal closes it.
  await new Promise<void>(() => {
    /* never resolves — process stays up until SIGINT/SIGTERM */
  });
}

main().catch((err) => {
  console.error("[calendar-agent] fatal:", err);
  process.exit(1);
});
