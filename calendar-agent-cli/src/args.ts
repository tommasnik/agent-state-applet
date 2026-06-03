/**
 * Tiny `--flag value` argument parser shared by the subcommands. Supports
 * `--flag value` and `--flag=value`. Unknown / valueless trailing flags map to
 * the empty string. Bare positionals are collected separately.
 */

export interface ParsedArgs {
  flags: Record<string, string>;
  positionals: string[];
}

export function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "";
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}
