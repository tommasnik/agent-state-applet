import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";

import {
  ensureBridgeLive,
  isGroupWhitelisted,
  listWhitelistedChats,
  messagesForGroup,
  openBridgeDb,
  parseBridgeTimestamp,
  resolveWhitelistedGroup,
  WhatsAppDeps,
  WhatsAppError,
} from "../whatsapp";
import { runWhatsApp } from "../commands";
import { WhitelistConfig } from "../config";

/**
 * Build a small fixture SQLite DB mirroring the real bridge schema and return
 * its path. The REAL messages.db is never touched — every test uses a fresh
 * temp file with synthetic data.
 */
function makeFixtureDb(opts?: { latestOffsetHours?: number }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-fixture-"));
  const dbPath = path.join(dir, "messages.db");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);" +
      "CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, " +
      "timestamp TIMESTAMP, is_from_me BOOLEAN, media_type TEXT, " +
      "PRIMARY KEY (id, chat_jid));"
  );

  // Newest message timestamp: now minus latestOffsetHours (default ~0 = fresh).
  const offsetH = opts?.latestOffsetHours ?? 0;
  const latest = new Date(Date.now() - offsetH * 3_600_000);
  const fmt = (d: Date): string =>
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00:00");

  const insChat = db.prepare(
    "INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)"
  );
  // Two whitelisted groups, one non-whitelisted group, one direct chat (not @g.us).
  insChat.run("g-allowed@g.us", "Rodiče 67S", fmt(latest));
  insChat.run(
    "g-allowed2@g.us",
    "  slunovratí tábor 2025 ", // weird case + whitespace to exercise norm()
    fmt(new Date(latest.getTime() - 3_600_000))
  );
  insChat.run("g-secret@g.us", "Secret Cabal", fmt(latest));
  insChat.run("123456@s.whatsapp.net", "Direct Person", fmt(latest));

  const insMsg = db.prepare(
    "INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insMsg.run("m1", "g-allowed@g.us", "111", "hello", fmt(latest), 0, null);
  insMsg.run(
    "m2",
    "g-allowed@g.us",
    "222",
    "world",
    fmt(new Date(latest.getTime() - 7_200_000)),
    1,
    null
  );
  insMsg.run(
    "m3",
    "g-secret@g.us",
    "333",
    "do not read me",
    fmt(latest),
    0,
    null
  );
  db.close();
  return dbPath;
}

const WHITELIST: WhitelistConfig = {
  whatsapp: { groups: ["Rodiče 67S", "Slunovratí tábor 2025"] },
  gmail: { senders: [], labels: [] },
};

function liveProbe(): Promise<boolean> {
  return Promise.resolve(true);
}
function deadProbe(): Promise<boolean> {
  return Promise.resolve(false);
}

describe("isGroupWhitelisted", () => {
  it("matches case-insensitively and trims", () => {
    expect(isGroupWhitelisted("rodiče 67s", WHITELIST)).toBe(true);
    expect(isGroupWhitelisted("  Slunovratí tábor 2025  ", WHITELIST)).toBe(true);
    expect(isGroupWhitelisted("Secret Cabal", WHITELIST)).toBe(false);
  });
});

describe("parseBridgeTimestamp", () => {
  it("parses the bridge space-separated RFC3339 timestamp", () => {
    expect(parseBridgeTimestamp("2026-06-03 18:42:39+02:00")).toBe(
      Date.parse("2026-06-03T18:42:39+02:00")
    );
  });
  it("returns null for garbage", () => {
    expect(parseBridgeTimestamp("not a date")).toBeNull();
  });
});

describe("listWhitelistedChats", () => {
  it("returns ONLY whitelisted groups, never non-whitelisted or direct chats", () => {
    const dbPath = makeFixtureDb();
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    const chats = listWhitelistedChats(deps);
    db.close();

    const names = chats.map((c) => c.name.trim());
    expect(names.sort()).toEqual(["Rodiče 67S", "slunovratí tábor 2025"].sort());
    expect(names).not.toContain("Secret Cabal");
    expect(names).not.toContain("Direct Person");
  });
});

describe("resolveWhitelistedGroup / messagesForGroup", () => {
  it("returns messages for a whitelisted group", () => {
    const dbPath = makeFixtureDb();
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    const { group, messages } = messagesForGroup(deps, {
      groupName: "rodiče 67s",
    });
    db.close();
    expect(group.jid).toBe("g-allowed@g.us");
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2"]); // newest-first
    expect(messages[1].is_from_me).toBe(true); // coerced to boolean
  });

  it("refuses a non-whitelisted group (throws WhatsAppError, no data)", () => {
    const dbPath = makeFixtureDb();
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    expect(() => resolveWhitelistedGroup(deps, "Secret Cabal")).toThrow(
      WhatsAppError
    );
    db.close();
  });

  it("honours --since and --limit", () => {
    const dbPath = makeFixtureDb();
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    const { messages } = messagesForGroup(deps, {
      groupName: "Rodiče 67S",
      limit: 1,
    });
    db.close();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("m1");
  });
});

describe("ensureBridgeLive (liveness guard)", () => {
  it("throws when the bridge port is dead", async () => {
    const dbPath = makeFixtureDb();
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: deadProbe };
    await expect(ensureBridgeLive(deps, 24)).rejects.toThrow(
      /bridge is not running/
    );
    db.close();
  });

  it("passes (no warning) when bridge is live and data is fresh", async () => {
    const dbPath = makeFixtureDb({ latestOffsetHours: 1 });
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    const res = await ensureBridgeLive(deps, 24);
    db.close();
    expect(res.staleWarning).toBeUndefined();
    expect(res.latestTimestamp).not.toBeNull();
  });

  it("emits a staleness warning when newest message is too old", async () => {
    const dbPath = makeFixtureDb({ latestOffsetHours: 48 });
    const db = openBridgeDb(dbPath);
    const deps: WhatsAppDeps = { db, whitelist: WHITELIST, liveness: liveProbe };
    const res = await ensureBridgeLive(deps, 24);
    db.close();
    expect(res.staleWarning).toMatch(/old/);
  });
});

describe("runWhatsApp (command runner)", () => {
  function cap() {
    const c = { out: "", err: "" };
    return {
      c,
      stdout: (s: string) => {
        c.out += s;
      },
      stderr: (s: string) => {
        c.err += s;
      },
    };
  }

  it("list-chats prints only whitelisted groups (exit 0)", async () => {
    const dbPath = makeFixtureDb();
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(["list-chats", "--db", dbPath], {
      openDb: openBridgeDb,
      liveness: liveProbe,
      whitelist: WHITELIST,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as Array<{ name: string }>;
    expect(parsed.map((p) => p.name.trim()).sort()).toEqual(
      ["Rodiče 67S", "slunovratí tábor 2025"].sort()
    );
    expect(c.out).not.toContain("Secret Cabal");
  });

  it("messages of a non-whitelisted group → error + exit 1, no data", async () => {
    const dbPath = makeFixtureDb();
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(["messages", "Secret Cabal", "--db", dbPath], {
      openDb: openBridgeDb,
      liveness: liveProbe,
      whitelist: WHITELIST,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(c.err).toContain("not on the WhatsApp whitelist");
    expect(c.out).toBe("");
  });

  it("messages of a whitelisted group prints messages", async () => {
    const dbPath = makeFixtureDb();
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(["messages", "Rodiče 67S", "--db", dbPath], {
      openDb: openBridgeDb,
      liveness: liveProbe,
      whitelist: WHITELIST,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.out) as { messages: Array<{ id: string }> };
    expect(parsed.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("bridge down → hard error, exit 1, no data (no stale read)", async () => {
    const dbPath = makeFixtureDb();
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(["list-chats", "--db", dbPath], {
      openDb: openBridgeDb,
      liveness: deadProbe,
      whitelist: WHITELIST,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(c.err).toContain("bridge is not running");
    expect(c.out).toBe("");
  });

  it("stale data → warning on stderr but still exits 0 with data", async () => {
    const dbPath = makeFixtureDb({ latestOffsetHours: 48 });
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(
      ["list-chats", "--db", dbPath, "--max-age-hours", "24"],
      {
        openDb: openBridgeDb,
        liveness: liveProbe,
        whitelist: WHITELIST,
        stdout,
        stderr,
      }
    );
    expect(code).toBe(0);
    expect(c.err).toMatch(/WARNING/);
    expect(JSON.parse(c.out)).toHaveLength(2);
  });

  it("missing DB file → error exit 1", async () => {
    const { c, stdout, stderr } = cap();
    const code = await runWhatsApp(
      ["list-chats", "--db", "/nonexistent/xyz.db"],
      { liveness: liveProbe, whitelist: WHITELIST, stdout, stderr }
    );
    expect(code).toBe(1);
    expect(c.err).toMatch(/not found/);
  });
});
