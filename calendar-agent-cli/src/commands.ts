/**
 * `cal-agent calendar ...` and `cal-agent gmail ...` subcommand handlers.
 *
 * Each runner returns a Promise<number> exit code. Success prints JSON on
 * stdout; failures print a readable message on stderr and return a non-zero
 * code. The {@link GoogleClient} is injectable so tests run without OAuth /
 * network.
 */

import { loadConfig, WhitelistConfig } from "./config";
import {
  GoogleClient,
  GoogleClientError,
  buildGmailQuery,
  parseEventDateTime,
} from "./google";
import {
  BridgeDb,
  LivenessProbe,
  WhatsAppDeps,
  WhatsAppError,
  defaultBridgeDbPath,
  ensureBridgeLive,
  listWhitelistedChats,
  messagesForGroup,
  openBridgeDb,
  tcpLivenessProbe,
} from "./whatsapp";
import { parseFlags } from "./args";

const PROG = "cal-agent";

/** Factory for the Google client (overridable in tests). */
export type GoogleClientFactory = () => GoogleClient;

export interface CommandDeps {
  /** Build the Google client. Defaults to one wired from the shared config. */
  makeClient?: GoogleClientFactory;
  /** stdout writer (defaults to process.stdout.write). */
  stdout?: (s: string) => void;
  /** stderr writer (defaults to process.stderr.write). */
  stderr?: (s: string) => void;
}

function defaultClientFactory(): GoogleClient {
  const cfg = loadConfig();
  return new GoogleClient({ aiCalendarId: cfg.aiCalendarId });
}

function resolveDeps(deps: CommandDeps): Required<CommandDeps> {
  return {
    makeClient: deps.makeClient ?? defaultClientFactory,
    stdout: deps.stdout ?? ((s) => void process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => void process.stderr.write(s)),
  };
}

/** Print a JSON value + trailing newline, return exit 0. */
function emit(stdout: (s: string) => void, value: unknown): number {
  stdout(JSON.stringify(value, null, 2) + "\n");
  return 0;
}

/** Print an error on stderr, return exit 1. */
function err(stderr: (s: string) => void, message: string): number {
  stderr(`${PROG}: ${message}\n`);
  return 1;
}

function require_(
  flags: Record<string, string>,
  name: string
): string | undefined {
  const v = flags[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

const CALENDAR_USAGE = `${PROG} calendar <subcommand>
  list-calendars
  list-events   [--calendar-id <id>] [--from <iso>] [--to <iso>]
  get-event     --calendar-id <id> --event-id <id>
  create-event  --summary <s> --start <iso|date> --end <iso|date> [--description <d>] [--calendar-id <id>]
  update-event  --event-id <id> [--summary <s>] [--start <iso|date>] [--end <iso|date>] [--description <d>] [--calendar-id <id>]`;

const GMAIL_USAGE = `${PROG} gmail <subcommand>
  search  --label <l> [--query <q>] [--newer-than <14d>]
  get     --id <messageId>`;

export async function runCalendar(
  args: string[],
  deps: CommandDeps = {}
): Promise<number> {
  const { makeClient, stdout, stderr } = resolveDeps(deps);
  const sub = args[0];
  if (!sub || sub === "-h" || sub === "--help") {
    (sub ? stdout : stderr)(CALENDAR_USAGE + "\n");
    return sub ? 0 : 2;
  }
  const { flags } = parseFlags(args.slice(1));

  try {
    switch (sub) {
      case "list-calendars":
        return emit(stdout, await makeClient().listCalendars());

      case "list-events":
        return emit(
          stdout,
          await makeClient().listEvents({
            calendarId: require_(flags, "calendar-id"),
            timeMin: require_(flags, "from"),
            timeMax: require_(flags, "to"),
          })
        );

      case "get-event": {
        const eventId = require_(flags, "event-id");
        if (!eventId) return err(stderr, "get-event: --event-id is required");
        return emit(
          stdout,
          await makeClient().getEvent({
            calendarId: require_(flags, "calendar-id"),
            eventId,
          })
        );
      }

      case "create-event": {
        const summary = require_(flags, "summary");
        const start = require_(flags, "start");
        const end = require_(flags, "end");
        if (!summary || !start || !end) {
          return err(
            stderr,
            "create-event: --summary, --start and --end are required"
          );
        }
        return emit(
          stdout,
          await makeClient().createEvent({
            calendarId: require_(flags, "calendar-id"),
            summary,
            start: parseEventDateTime(start),
            end: parseEventDateTime(end),
            description: require_(flags, "description"),
          })
        );
      }

      case "update-event": {
        const eventId = require_(flags, "event-id");
        if (!eventId) return err(stderr, "update-event: --event-id is required");
        const start = require_(flags, "start");
        const end = require_(flags, "end");
        return emit(
          stdout,
          await makeClient().updateEvent({
            calendarId: require_(flags, "calendar-id"),
            eventId,
            summary: require_(flags, "summary"),
            description: require_(flags, "description"),
            start: start ? parseEventDateTime(start) : undefined,
            end: end ? parseEventDateTime(end) : undefined,
          })
        );
      }

      default:
        stderr(`${PROG}: unknown calendar subcommand '${sub}'\n\n${CALENDAR_USAGE}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof GoogleClientError) return err(stderr, e.message);
    return err(stderr, String(e));
  }
}

export async function runGmail(
  args: string[],
  deps: CommandDeps = {}
): Promise<number> {
  const { makeClient, stdout, stderr } = resolveDeps(deps);
  const sub = args[0];
  if (!sub || sub === "-h" || sub === "--help") {
    (sub ? stdout : stderr)(GMAIL_USAGE + "\n");
    return sub ? 0 : 2;
  }
  const { flags } = parseFlags(args.slice(1));

  try {
    switch (sub) {
      case "search": {
        const q = buildGmailQuery({
          label: require_(flags, "label"),
          query: require_(flags, "query"),
          newerThan: require_(flags, "newer-than"),
        });
        if (!q) {
          return err(
            stderr,
            "search: at least one of --label / --query / --newer-than is required"
          );
        }
        return emit(stdout, await makeClient().gmailSearch({ q }));
      }

      case "get": {
        const id = require_(flags, "id");
        if (!id) return err(stderr, "get: --id is required");
        return emit(stdout, await makeClient().gmailGet({ id }));
      }

      default:
        stderr(`${PROG}: unknown gmail subcommand '${sub}'\n\n${GMAIL_USAGE}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof GoogleClientError) return err(stderr, e.message);
    return err(stderr, String(e));
  }
}

// ---- WhatsApp (read bridge SQLite, whitelist, liveness) ------------------

const WA_USAGE = `${PROG} wa <subcommand>
  list-chats                 List ONLY whitelisted WhatsApp groups
  messages <group name>      Messages from a whitelisted group
                             [--since <iso>] [--limit <n>]
  Global: [--db <path>] [--max-age-hours <n>]`;

/** Default max staleness (hours) before a non-fatal warning is emitted. */
const DEFAULT_MAX_AGE_HOURS = 24;

/** Dependencies for {@link runWhatsApp} — injectable for tests. */
export interface WhatsAppCommandDeps {
  /** Open a {@link BridgeDb} for a path (defaults to read-only better-sqlite3). */
  openDb?: (dbPath: string) => BridgeDb;
  /** Liveness probe (defaults to a TCP connect to :8080). */
  liveness?: LivenessProbe;
  /** Whitelist (defaults to the shared config's whitelist). */
  whitelist?: WhitelistConfig;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

function resolveWaDeps(deps: WhatsAppCommandDeps): {
  openDb: (dbPath: string) => BridgeDb;
  liveness: LivenessProbe;
  whitelist: WhitelistConfig;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
} {
  return {
    openDb: deps.openDb ?? openBridgeDb,
    liveness: deps.liveness ?? tcpLivenessProbe,
    whitelist: deps.whitelist ?? loadConfig().whitelist,
    stdout: deps.stdout ?? ((s) => void process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => void process.stderr.write(s)),
  };
}

export async function runWhatsApp(
  args: string[],
  deps: WhatsAppCommandDeps = {}
): Promise<number> {
  const { openDb, liveness, whitelist, stdout, stderr } = resolveWaDeps(deps);
  const sub = args[0];
  if (!sub || sub === "-h" || sub === "--help") {
    (sub ? stdout : stderr)(WA_USAGE + "\n");
    return sub ? 0 : 2;
  }
  const { flags, positionals } = parseFlags(args.slice(1));

  const dbPath = require_(flags, "db") ?? defaultBridgeDbPath();
  const maxAgeRaw = require_(flags, "max-age-hours");
  const maxAgeHours =
    maxAgeRaw !== undefined ? Number(maxAgeRaw) : DEFAULT_MAX_AGE_HOURS;
  if (Number.isNaN(maxAgeHours) || maxAgeHours < 0) {
    return err(stderr, "wa: --max-age-hours must be a non-negative number");
  }

  let db: BridgeDb;
  try {
    db = openDb(dbPath);
  } catch (e) {
    if (e instanceof WhatsAppError) return err(stderr, e.message);
    return err(stderr, String(e));
  }

  const waDeps: WhatsAppDeps = { db, whitelist, liveness };

  try {
    // Liveness guard runs before any read: bridge down → hard error, never
    // silently serve stale data. Staleness → non-fatal warning on stderr.
    const { staleWarning } = await ensureBridgeLive(waDeps, maxAgeHours);
    if (staleWarning) stderr(staleWarning + "\n");

    switch (sub) {
      case "list-chats":
        return emit(stdout, listWhitelistedChats(waDeps));

      case "messages": {
        const groupName = positionals[0];
        if (!groupName) {
          return err(stderr, "messages: <group name> is required");
        }
        const limitRaw = require_(flags, "limit");
        const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
        if (limit !== undefined && (Number.isNaN(limit) || limit < 0)) {
          return err(stderr, "messages: --limit must be a non-negative number");
        }
        const result = messagesForGroup(waDeps, {
          groupName,
          sinceIso: require_(flags, "since"),
          limit,
        });
        return emit(stdout, result);
      }

      default:
        stderr(`${PROG}: unknown wa subcommand '${sub}'\n\n${WA_USAGE}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof WhatsAppError) return err(stderr, e.message);
    return err(stderr, String(e));
  } finally {
    db.close();
  }
}
