import { runCalendar, runGmail } from "../commands";
import { GoogleClient, GoogleClientError } from "../google";

interface Cap {
  out: string;
  err: string;
}

function makeDeps(client: Partial<GoogleClient>): {
  deps: { makeClient: () => GoogleClient; stdout: (s: string) => void; stderr: (s: string) => void };
  cap: Cap;
} {
  const cap: Cap = { out: "", err: "" };
  return {
    deps: {
      makeClient: () => client as GoogleClient,
      stdout: (s) => {
        cap.out += s;
      },
      stderr: (s) => {
        cap.err += s;
      },
    },
    cap,
  };
}

describe("runCalendar", () => {
  it("create-event refusal (foreign calendar) surfaces error + exit 1, no HTTP", async () => {
    const createEvent = jest.fn(async () => {
      throw new GoogleClientError("Refused: writes are only allowed ...");
    });
    const { deps, cap } = makeDeps({ createEvent } as unknown as GoogleClient);
    const code = await runCalendar(
      [
        "create-event",
        "--summary",
        "X",
        "--start",
        "2026-06-03",
        "--end",
        "2026-06-04",
        "--calendar-id",
        "other@x",
      ],
      deps
    );
    expect(code).toBe(1);
    expect(cap.err).toContain("Refused");
  });

  it("create-event success prints JSON + exit 0", async () => {
    const createEvent = jest.fn(async () => ({ id: "evt1" }));
    const { deps, cap } = makeDeps({ createEvent } as unknown as GoogleClient);
    const code = await runCalendar(
      ["create-event", "--summary", "Mtg", "--start", "2026-06-03", "--end", "2026-06-04"],
      deps
    );
    expect(code).toBe(0);
    expect(JSON.parse(cap.out)).toEqual({ id: "evt1" });
    expect(createEvent).toHaveBeenCalledWith({
      calendarId: undefined,
      summary: "Mtg",
      start: { date: "2026-06-03" },
      end: { date: "2026-06-04" },
      description: undefined,
    });
  });

  it("create-event missing required flags → exit 1, no client call", async () => {
    const createEvent = jest.fn();
    const { deps, cap } = makeDeps({ createEvent } as unknown as GoogleClient);
    const code = await runCalendar(["create-event", "--summary", "X"], deps);
    expect(code).toBe(1);
    expect(cap.err).toContain("required");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("list-events passes through window flags", async () => {
    const listEvents = jest.fn(async () => ({ items: [] }));
    const { deps } = makeDeps({ listEvents } as unknown as GoogleClient);
    await runCalendar(
      ["list-events", "--calendar-id", "c@x", "--from", "A", "--to", "B"],
      deps
    );
    expect(listEvents).toHaveBeenCalledWith({
      calendarId: "c@x",
      timeMin: "A",
      timeMax: "B",
    });
  });

  it("get-event requires --event-id", async () => {
    const getEvent = jest.fn();
    const { deps } = makeDeps({ getEvent } as unknown as GoogleClient);
    const code = await runCalendar(["get-event", "--calendar-id", "c"], deps);
    expect(code).toBe(1);
    expect(getEvent).not.toHaveBeenCalled();
  });

  it("unknown subcommand → exit 2", async () => {
    const { deps } = makeDeps({});
    expect(await runCalendar(["frobnicate"], deps)).toBe(2);
  });
});

describe("runGmail", () => {
  it("search builds query and prints JSON", async () => {
    const gmailSearch = jest.fn(async () => ({ messages: [{ id: "m1" }] }));
    const { deps, cap } = makeDeps({ gmailSearch } as unknown as GoogleClient);
    const code = await runGmail(
      ["search", "--label", "Škola Slunovrat", "--newer-than", "14d"],
      deps
    );
    expect(code).toBe(0);
    expect(gmailSearch).toHaveBeenCalledWith({
      q: 'label:"Škola Slunovrat" newer_than:14d',
    });
    expect(JSON.parse(cap.out)).toEqual({ messages: [{ id: "m1" }] });
  });

  it("search with no criteria → exit 1", async () => {
    const gmailSearch = jest.fn();
    const { deps } = makeDeps({ gmailSearch } as unknown as GoogleClient);
    const code = await runGmail(["search"], deps);
    expect(code).toBe(1);
    expect(gmailSearch).not.toHaveBeenCalled();
  });

  it("get requires --id", async () => {
    const gmailGet = jest.fn();
    const { deps } = makeDeps({ gmailGet } as unknown as GoogleClient);
    expect(await runGmail(["get"], deps)).toBe(1);
    expect(gmailGet).not.toHaveBeenCalled();
  });

  it("get prints the message", async () => {
    const gmailGet = jest.fn(async () => ({ id: "m1", snippet: "hi" }));
    const { deps, cap } = makeDeps({ gmailGet } as unknown as GoogleClient);
    const code = await runGmail(["get", "--id", "m1"], deps);
    expect(code).toBe(0);
    expect(gmailGet).toHaveBeenCalledWith({ id: "m1" });
    expect(JSON.parse(cap.out)).toEqual({ id: "m1", snippet: "hi" });
  });
});
