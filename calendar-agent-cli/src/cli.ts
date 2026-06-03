#!/usr/bin/env node
/**
 * cal-agent — CLI entry point for the Calendar Agent CLI.
 *
 * This is the scaffold (TASK-35): argument parsing + help/usage, plus a small
 * `config` command that prints the resolved shared config. The real
 * subcommands (calendar / gmail / wa / approvals) are stubs here — they are
 * implemented by the follow-up tasks (TASK-36/37/38).
 */

import { loadConfig, configPath } from "./config";
import { runCalendar, runGmail } from "./commands";

const PROG = "cal-agent";

interface Command {
  name: string;
  summary: string;
  /** Implemented in this task, or a stub placeholder. */
  implemented: boolean;
  run(args: string[]): number | Promise<number>;
}

function usage(): string {
  const lines: string[] = [];
  lines.push(`${PROG} — Calendar Agent CLI`);
  lines.push("");
  lines.push(`Usage: ${PROG} <command> [options]`);
  lines.push("");
  lines.push("Commands:");
  for (const cmd of COMMAND_LIST) {
    const tag = cmd.implemented ? "" : " (not implemented yet)";
    lines.push(`  ${cmd.name.padEnd(12)} ${cmd.summary}${tag}`);
  }
  lines.push("");
  lines.push("Global options:");
  lines.push("  -h, --help     Show this help and exit");
  lines.push("  -v, --version  Show version and exit");
  lines.push("");
  lines.push(`Config: ${configPath()}`);
  return lines.join("\n");
}

function version(): string {
  // Read lazily to avoid a hard require at import time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function stub(name: string): Command {
  return {
    name,
    summary: `${name} operations`,
    implemented: false,
    run(): number {
      process.stderr.write(
        `${PROG}: '${name}' is not implemented yet.\n`
      );
      return 1;
    },
  };
}

const configCommand: Command = {
  name: "config",
  summary: "Show the resolved shared config (aiCalendarId, whitelist)",
  implemented: true,
  run(): number {
    const cfg = loadConfig();
    process.stdout.write(
      JSON.stringify(
        {
          configPath: configPath(),
          aiCalendarId: cfg.aiCalendarId ?? null,
          whitelist: cfg.whitelist,
        },
        null,
        2
      ) + "\n"
    );
    return 0;
  },
};

const calendarCommand: Command = {
  name: "calendar",
  summary: "Google Calendar: list/get/create/update events",
  implemented: true,
  run(args): Promise<number> {
    return runCalendar(args);
  },
};

const gmailCommand: Command = {
  name: "gmail",
  summary: "Gmail (read-only): search / get messages",
  implemented: true,
  run(args): Promise<number> {
    return runGmail(args);
  },
};

const COMMAND_LIST: Command[] = [
  configCommand,
  calendarCommand,
  gmailCommand,
  stub("wa"),
  stub("approvals"),
];

const COMMANDS: Record<string, Command> = Object.fromEntries(
  COMMAND_LIST.map((c) => [c.name, c])
);

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0) {
    process.stdout.write(usage() + "\n");
    return 0;
  }

  const first = args[0];

  if (first === "-h" || first === "--help" || first === "help") {
    process.stdout.write(usage() + "\n");
    return 0;
  }

  if (first === "-v" || first === "--version") {
    process.stdout.write(version() + "\n");
    return 0;
  }

  const cmd = COMMANDS[first];
  if (!cmd) {
    process.stderr.write(`${PROG}: unknown command '${first}'\n\n`);
    process.stderr.write(usage() + "\n");
    return 2;
  }

  return cmd.run(args.slice(1));
}

// Only run when invoked directly (not when imported by tests).
if (require.main === module) {
  main(process.argv).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${PROG}: ${String(e)}\n`);
      process.exit(1);
    }
  );
}
