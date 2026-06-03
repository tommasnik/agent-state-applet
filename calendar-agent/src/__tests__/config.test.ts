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

  it("loadConfig falls back to an empty MCP map when no file exists", () => {
    const prev = process.env.CALENDAR_AGENT_CONFIG;
    process.env.CALENDAR_AGENT_CONFIG = "/nonexistent/path/does-not-exist.json";
    try {
      const cfg = loadConfig();
      expect(cfg.mcpServers).toEqual({});
    } finally {
      if (prev === undefined) delete process.env.CALENDAR_AGENT_CONFIG;
      else process.env.CALENDAR_AGENT_CONFIG = prev;
    }
  });
});
