import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildMcpServers,
  loadConfig,
  injectGoogleBearer,
  googleServerNames,
  isGoogleHttpServer,
  GOOGLE_CALENDAR_MCP_URL,
  GOOGLE_GMAIL_MCP_URL,
  McpServerConfig,
} from "../config";

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

  it("keeps google http entries (url + google flag + scopes) and whatsapp stdio", () => {
    const servers = buildMcpServers({
      calendar: {
        type: "http",
        url: GOOGLE_CALENDAR_MCP_URL,
        google: true,
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
      gmail: {
        type: "http",
        url: GOOGLE_GMAIL_MCP_URL,
        google: true,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      whatsapp: { command: "/home/tom/.local/bin/uv", args: ["run", "main.py"] },
    });
    expect(Object.keys(servers).sort()).toEqual([
      "calendar",
      "gmail",
      "whatsapp",
    ]);
    expect(servers.calendar).toMatchObject({
      type: "http",
      url: GOOGLE_CALENDAR_MCP_URL,
      google: true,
    });
    expect(googleServerNames(servers).sort()).toEqual(["calendar", "gmail"]);
    expect(isGoogleHttpServer(servers.calendar)).toBe(true);
    expect(isGoogleHttpServer(servers.whatsapp)).toBe(false);
  });

  it("injectGoogleBearer adds Bearer header to google servers, strips markers, leaves others", () => {
    const servers: Record<string, McpServerConfig> = {
      calendar: {
        type: "http",
        url: GOOGLE_CALENDAR_MCP_URL,
        google: true,
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
      whatsapp: { command: "uv", args: ["run", "main.py"] },
    };
    const out = injectGoogleBearer(servers, "tok-123");
    const cal = out.calendar as unknown as Record<string, unknown>;
    expect((cal.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-123"
    );
    // internal marker fields must not leak to the SDK
    expect(cal.google).toBeUndefined();
    expect(cal.scopes).toBeUndefined();
    expect(cal.type).toBe("http");
    expect(cal.url).toBe(GOOGLE_CALENDAR_MCP_URL);
    // non-google entry untouched (still stdio)
    expect(out.whatsapp).toEqual(servers.whatsapp);
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
          gmail: {
            type: "http",
            url: GOOGLE_GMAIL_MCP_URL,
            google: true,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          },
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
