import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildMcpServers, loadConfig } from "../config";

describe("config / MCP server assembly", () => {
  it("imports and exposes the config API", () => {
    expect(typeof buildMcpServers).toBe("function");
    expect(typeof loadConfig).toBe("function");
  });

  it("builds an MCP server map from a passed list (stdio, sse, http)", () => {
    const servers = buildMcpServers({
      whatsapp: { command: "whatsapp-mcp", args: ["--stdio"] },
      remote: { type: "sse", url: "http://localhost:5001/sse" },
      other: { type: "http", url: "http://localhost:5002" },
    });
    expect(Object.keys(servers).sort()).toEqual([
      "other",
      "remote",
      "whatsapp",
    ]);
    expect(servers.whatsapp).toMatchObject({ command: "whatsapp-mcp" });
    expect(servers.remote).toMatchObject({ type: "sse" });
  });

  it("drops malformed MCP entries", () => {
    const servers = buildMcpServers({
      good: { command: "x" },
      bogusNoCommand: { args: ["y"] },
      bogusSseNoUrl: { type: "sse" },
      notAnObject: 42,
    });
    expect(Object.keys(servers)).toEqual(["good"]);
  });

  it("returns an empty map for non-object input", () => {
    expect(buildMcpServers(undefined)).toEqual({});
    expect(buildMcpServers(null)).toEqual({});
    expect(buildMcpServers("nope")).toEqual({});
  });

  it("loadConfig falls back to an empty MCP map + deny-all whitelist when no file exists", () => {
    const prev = process.env.CALENDAR_AGENT_CONFIG;
    process.env.CALENDAR_AGENT_CONFIG = "/nonexistent/path/does-not-exist.json";
    try {
      const cfg = loadConfig();
      expect(cfg.mcpServers).toEqual({});
      expect(cfg.aiCalendarId).toBeUndefined();
      expect(cfg.whitelist).toEqual({
        whatsapp: { groups: [] },
        gmail: { senders: [], labels: [] },
      });
    } finally {
      if (prev === undefined) delete process.env.CALENDAR_AGENT_CONFIG;
      else process.env.CALENDAR_AGENT_CONFIG = prev;
    }
  });

  it("loadConfig parses only the whatsapp stdio server + whitelist (no calendar/gmail in JSON)", () => {
    const prev = process.env.CALENDAR_AGENT_CONFIG;
    const tmp = path.join(os.tmpdir(), `ca-config-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        model: "claude-x",
        aiCalendarId: "ai@group.calendar.google.com",
        mcpServers: {
          whatsapp: { command: "uv", args: ["run", "main.py"] },
        },
        whitelist: {
          whatsapp: { groups: ["Family"] },
          gmail: { senders: ["@daktela.com"], labels: ["Important"] },
        },
      })
    );
    process.env.CALENDAR_AGENT_CONFIG = tmp;
    try {
      const cfg = loadConfig();
      expect(cfg.model).toBe("claude-x");
      expect(cfg.aiCalendarId).toBe("ai@group.calendar.google.com");
      // Calendar + Gmail are NOT configured here — host builds them in-process.
      expect(Object.keys(cfg.mcpServers)).toEqual(["whatsapp"]);
      expect(cfg.whitelist.whatsapp.groups).toEqual(["Family"]);
      expect(cfg.whitelist.gmail.senders).toEqual(["@daktela.com"]);
      expect(cfg.whitelist.gmail.labels).toEqual(["Important"]);
    } finally {
      fs.unlinkSync(tmp);
      if (prev === undefined) delete process.env.CALENDAR_AGENT_CONFIG;
      else process.env.CALENDAR_AGENT_CONFIG = prev;
    }
  });
});
