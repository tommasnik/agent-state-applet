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
      gmail: { type: "sse", url: "http://localhost:5001/sse" },
      calendar: { type: "http", url: "http://localhost:5002" },
    });
    expect(Object.keys(servers).sort()).toEqual([
      "calendar",
      "gmail",
      "whatsapp",
    ]);
    expect(servers.whatsapp).toMatchObject({ command: "whatsapp-mcp" });
    expect(servers.gmail).toMatchObject({ type: "sse" });
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
      expect(cfg.whitelist).toEqual({
        whatsapp: { groups: [] },
        gmail: { senders: [], labels: [] },
      });
    } finally {
      if (prev === undefined) delete process.env.CALENDAR_AGENT_CONFIG;
      else process.env.CALENDAR_AGENT_CONFIG = prev;
    }
  });

  it("loadConfig parses MCP servers + whitelist from a config file", () => {
    const prev = process.env.CALENDAR_AGENT_CONFIG;
    const tmp = path.join(os.tmpdir(), `ca-config-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        model: "claude-x",
        mcpServers: {
          whatsapp: { command: "uv", args: ["run", "main.py"] },
          gmail: { command: "npx", args: ["@gongrzhe/server-gmail-autoauth-mcp"] },
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
      expect(Object.keys(cfg.mcpServers).sort()).toEqual(["gmail", "whatsapp"]);
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
