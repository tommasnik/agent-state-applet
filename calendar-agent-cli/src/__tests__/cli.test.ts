import { main } from "../cli";

async function capture(
  fn: () => Promise<number>
): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout.write as unknown) = (s: string) => {
    out += s;
    return true;
  };
  (process.stderr.write as unknown) = (s: string) => {
    err += s;
    return true;
  };
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

describe("cli usage", () => {
  it("prints usage with no args (exit 0)", async () => {
    const r = await capture(() => main(["node", "cli.js"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: cal-agent");
    expect(r.out).toContain("Commands:");
  });

  it("prints usage on --help", async () => {
    const r = await capture(() => main(["node", "cli.js", "--help"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: cal-agent");
  });

  it("lists all implemented commands", async () => {
    const r = await capture(() => main(["node", "cli.js", "--help"]));
    expect(r.out).toContain("calendar");
    expect(r.out).toContain("gmail");
    expect(r.out).toContain("wa");
    expect(r.out).toContain("approvals");
  });

  it("exits 2 on unknown command", async () => {
    const r = await capture(() => main(["node", "cli.js", "bogus"]));
    expect(r.code).toBe(2);
    expect(r.err).toContain("unknown command");
  });

  it("approvals with no subcommand prints usage (exit 2)", async () => {
    const r = await capture(() => main(["node", "cli.js", "approvals"]));
    expect(r.code).toBe(2);
    expect(r.err).toContain("add");
  });

  it("calendar with no subcommand prints usage (exit 2)", async () => {
    const r = await capture(() => main(["node", "cli.js", "calendar"]));
    expect(r.code).toBe(2);
    expect(r.err).toContain("list-calendars");
  });

  it("gmail --help prints usage (exit 0)", async () => {
    const r = await capture(() => main(["node", "cli.js", "gmail", "--help"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("search");
  });

  it("prints version on --version", async () => {
    const r = await capture(() => main(["node", "cli.js", "--version"]));
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
