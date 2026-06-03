/**
 * `cal-agent calendar ...` and `cal-agent gmail ...` subcommand handlers.
 *
 * Each runner returns a Promise<number> exit code. Success prints JSON on
 * stdout; failures print a readable message on stderr and return a non-zero
 * code. The {@link GoogleClient} is injectable so tests run without OAuth /
 * network.
 */

import { loadConfig } from "./config";
import {
  GoogleClient,
  GoogleClientError,
  buildGmailQuery,
  parseEventDateTime,
} from "./google";
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
