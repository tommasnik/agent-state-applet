import * as path from "path";
import { loadConfig, buildWhitelist, EMPTY_WHITELIST } from "../config";

const FIXTURE = path.join(__dirname, "fixtures", "calendar-agent.json");

describe("loadConfig", () => {
  const origEnv = process.env.CALENDAR_AGENT_CONFIG;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CALENDAR_AGENT_CONFIG;
    } else {
      process.env.CALENDAR_AGENT_CONFIG = origEnv;
    }
  });

  it("reads aiCalendarId and whitelist from the fixture via env override", () => {
    process.env.CALENDAR_AGENT_CONFIG = FIXTURE;
    const cfg = loadConfig();
    expect(cfg.aiCalendarId).toBe(
      "fixture-cal-id@group.calendar.google.com"
    );
    expect(cfg.whitelist.whatsapp.groups).toEqual([
      "Rodiče 67S",
      "Slunovratí tábor 2025",
    ]);
    expect(cfg.whitelist.gmail.senders).toEqual(["school@example.com"]);
    expect(cfg.whitelist.gmail.labels).toEqual(["Škola Slunovrat"]);
  });

  it("returns safe empty default when file is missing", () => {
    process.env.CALENDAR_AGENT_CONFIG = "/nonexistent/path/xyz.json";
    const cfg = loadConfig();
    expect(cfg.aiCalendarId).toBeUndefined();
    expect(cfg.whitelist).toEqual(EMPTY_WHITELIST);
  });
});

describe("buildWhitelist", () => {
  it("returns empty whitelist for non-object input", () => {
    expect(buildWhitelist(null)).toEqual(EMPTY_WHITELIST);
    expect(buildWhitelist(undefined)).toEqual(EMPTY_WHITELIST);
    expect(buildWhitelist("nope")).toEqual(EMPTY_WHITELIST);
  });

  it("drops malformed entries and keeps valid strings", () => {
    const wl = buildWhitelist({
      whatsapp: { groups: ["A", 1, "", "B"] },
      gmail: { senders: ["s@x"], labels: [null, "L"] },
    });
    expect(wl.whatsapp.groups).toEqual(["A", "B"]);
    expect(wl.gmail.senders).toEqual(["s@x"]);
    expect(wl.gmail.labels).toEqual(["L"]);
  });
});
