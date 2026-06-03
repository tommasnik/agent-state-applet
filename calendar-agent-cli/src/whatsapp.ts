/**
 * WhatsApp operations for `cal-agent wa ...`.
 *
 * Reads DIRECTLY from the Go bridge's SQLite store (READ-ONLY) — there is no
 * python whatsapp-mcp / uv in the loop. Data liveness is guaranteed by the Go
 * bridge process: it holds the WhatsApp connection and writes incoming messages
 * into the SQLite DB in real time. So our liveness guard is simply "is the
 * bridge process listening on its port (:8080)?".
 *
 * Bridge SQLite (default):
 *   ~/work/external/whatsapp-mcp/whatsapp-bridge/store/messages.db
 * Schema (verified):
 *   chats(jid TEXT PK, name TEXT, last_message_time TIMESTAMP)
 *   messages(id, chat_jid, sender, content, timestamp, is_from_me, media_type, ...)
 *   groups: jid LIKE '%@g.us'
 *
 * Whitelist enforcement: only WhatsApp GROUPS whose name is listed (by name,
 * case-insensitive + trimmed) in config `whitelist.whatsapp.groups` are ever
 * returned. `list-chats` lists only whitelisted groups; `messages <group>`
 * refuses any group not on the whitelist (error + non-zero exit) so a scheduled
 * run can never read non-whitelisted chats.
 *
 * Both the SQLite reader and the liveness check are injectable so tests run
 * against a fixture DB and a mocked "is the port live" probe — the real
 * messages.db is never touched in tests.
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import Database from "better-sqlite3";

import { WhitelistConfig } from "./config";

/** Default bridge SQLite path (override via opts / $WHATSAPP_BRIDGE_DB). */
export function defaultBridgeDbPath(): string {
  const env = process.env.WHATSAPP_BRIDGE_DB;
  if (env && env.length > 0) return env;
  return path.join(
    os.homedir(),
    "work",
    "external",
    "whatsapp-mcp",
    "whatsapp-bridge",
    "store",
    "messages.db"
  );
}

/** Default TCP port the Go bridge listens on. */
export const BRIDGE_PORT = 8080;

/** Raised by WhatsApp ops; carries a clean, user-facing message. */
export class WhatsAppError extends Error {}

/** A whitelisted group chat as returned by `list-chats`. */
export interface ChatRow {
  jid: string;
  name: string;
  last_message_time: string | null;
}

/** A single message as returned by `messages`. */
export interface MessageRow {
  id: string;
  chat_jid: string;
  sender: string;
  content: string | null;
  timestamp: string;
  is_from_me: boolean;
  media_type: string | null;
}

/** Minimal read-only SQLite surface we depend on (injectable for tests). */
export interface BridgeDb {
  listGroups(): ChatRow[];
  /** Most recent message timestamp across ALL chats, or null if empty. */
  latestMessageTimestamp(): string | null;
  /** Messages for a chat jid, newest-first, optional since/limit. */
  messagesForChat(opts: {
    chatJid: string;
    sinceIso?: string;
    limit?: number;
  }): MessageRow[];
  close(): void;
}

/** Open the bridge SQLite read-only. Throws {@link WhatsAppError} if missing. */
export function openBridgeDb(dbPath: string): BridgeDb {
  if (!fs.existsSync(dbPath)) {
    throw new WhatsAppError(
      `WhatsApp bridge DB not found at ${dbPath} (is the bridge installed?)`
    );
  }
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    throw new WhatsAppError(`Failed to open bridge DB ${dbPath}: ${String(e)}`);
  }

  return {
    listGroups(): ChatRow[] {
      return db
        .prepare(
          "SELECT jid, name, last_message_time FROM chats " +
            "WHERE jid LIKE '%@g.us' ORDER BY last_message_time DESC"
        )
        .all() as ChatRow[];
    },
    latestMessageTimestamp(): string | null {
      const row = db
        .prepare("SELECT MAX(timestamp) AS ts FROM messages")
        .get() as { ts: string | null } | undefined;
      return row?.ts ?? null;
    },
    messagesForChat(opts): MessageRow[] {
      const params: unknown[] = [opts.chatJid];
      let sql =
        "SELECT id, chat_jid, sender, content, timestamp, is_from_me, media_type " +
        "FROM messages WHERE chat_jid = ?";
      if (opts.sinceIso) {
        sql += " AND timestamp >= ?";
        params.push(opts.sinceIso);
      }
      sql += " ORDER BY timestamp DESC";
      if (opts.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit);
      }
      const rows = db.prepare(sql).all(...params) as Array<
        Omit<MessageRow, "is_from_me"> & { is_from_me: number | boolean }
      >;
      return rows.map((r) => ({ ...r, is_from_me: Boolean(r.is_from_me) }));
    },
    close(): void {
      db.close();
    },
  };
}

/** Probe: is something listening on the bridge's TCP port? (injectable) */
export type LivenessProbe = (port: number) => Promise<boolean>;

/** Default liveness probe: TCP connect to 127.0.0.1:<port> with a timeout. */
export function tcpLivenessProbe(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

/** Normalised, case-insensitive comparison helper (mirrors whitelist logic). */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** True if a group name is on the WhatsApp whitelist (ci + trimmed). */
export function isGroupWhitelisted(
  name: string,
  wl: WhitelistConfig
): boolean {
  const allowed = wl.whatsapp.groups.map(norm);
  return allowed.includes(norm(name));
}

export interface WhatsAppDeps {
  db: BridgeDb;
  whitelist: WhitelistConfig;
  liveness: LivenessProbe;
  /** Bridge port to probe (default {@link BRIDGE_PORT}). */
  port?: number;
}

/**
 * Liveness guard. Throws {@link WhatsAppError} if the bridge is NOT listening,
 * so a scheduled run fails loudly instead of silently serving stale data.
 * Returns the latest message timestamp + a staleness warning (if any) so the
 * caller can emit a non-fatal warning on stderr.
 */
export async function ensureBridgeLive(
  deps: WhatsAppDeps,
  maxAgeHours: number
): Promise<{ latestTimestamp: string | null; staleWarning?: string }> {
  const port = deps.port ?? BRIDGE_PORT;
  const alive = await deps.liveness(port);
  if (!alive) {
    throw new WhatsAppError(
      `WhatsApp bridge is not running (port ${port}). ` +
        `Start it: systemctl --user start whatsapp-bridge`
    );
  }

  const latest = deps.db.latestMessageTimestamp();
  let staleWarning: string | undefined;
  if (latest) {
    const latestMs = parseBridgeTimestamp(latest);
    if (latestMs !== null) {
      const ageHours = (Date.now() - latestMs) / 3_600_000;
      if (ageHours > maxAgeHours) {
        staleWarning =
          `WARNING: newest WhatsApp message is ${ageHours.toFixed(1)}h old ` +
          `(threshold ${maxAgeHours}h) — bridge may be behind / disconnected.`;
      }
    }
  }
  return { latestTimestamp: latest, staleWarning };
}

/**
 * Parse a bridge timestamp ("YYYY-MM-DD HH:MM:SS+TZ") into epoch ms, or null
 * if unparseable. The bridge uses a space separator; replace it with 'T' so
 * Date can parse the RFC3339 value.
 */
export function parseBridgeTimestamp(ts: string): number | null {
  const ms = Date.parse(ts.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

/** `list-chats`: only whitelisted groups (jid, name, last_message_time). */
export function listWhitelistedChats(deps: WhatsAppDeps): ChatRow[] {
  return deps.db
    .listGroups()
    .filter((c) => isGroupWhitelisted(c.name ?? "", deps.whitelist));
}

/**
 * Resolve a group by name to its jid, enforcing the whitelist. Throws
 * {@link WhatsAppError} if the name is NOT whitelisted, or if no whitelisted
 * group matches it.
 */
export function resolveWhitelistedGroup(
  deps: WhatsAppDeps,
  groupName: string
): ChatRow {
  if (!isGroupWhitelisted(groupName, deps.whitelist)) {
    throw new WhatsAppError(
      `Refused: group '${groupName}' is not on the WhatsApp whitelist.`
    );
  }
  const target = norm(groupName);
  const match = deps.db
    .listGroups()
    .find((c) => norm(c.name ?? "") === target);
  if (!match) {
    throw new WhatsAppError(
      `No WhatsApp group named '${groupName}' found in the bridge store.`
    );
  }
  return match;
}

/** `messages <group>`: whitelisted-only messages, newest-first. */
export function messagesForGroup(
  deps: WhatsAppDeps,
  opts: { groupName: string; sinceIso?: string; limit?: number }
): { group: ChatRow; messages: MessageRow[] } {
  const group = resolveWhitelistedGroup(deps, opts.groupName);
  const messages = deps.db.messagesForChat({
    chatJid: group.jid,
    sinceIso: opts.sinceIso,
    limit: opts.limit,
  });
  return { group, messages };
}
