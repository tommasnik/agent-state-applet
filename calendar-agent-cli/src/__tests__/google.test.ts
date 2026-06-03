import { GoogleClient, GoogleClientError, buildGmailQuery, parseEventDateTime } from "../google";
import { GoogleTokenManager } from "../googleAuth";

/** A fake token manager that never hits the network. */
function fakeTokenManager(token = "fake-access-token"): GoogleTokenManager {
  return {
    getAccessToken: jest.fn().mockResolvedValue(token),
  } as unknown as GoogleTokenManager;
}

/** A fetch stub recording calls and returning a JSON 200 response. */
function jsonFetch(body: unknown): {
  fetchImpl: jest.Mock;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  return { fetchImpl, calls };
}

const AI_CAL = "ai-cal@group.calendar.google.com";

describe("GoogleClient AI-calendar write enforcement", () => {
  it("REFUSES create-event to a foreign calendarId WITHOUT any HTTP call", async () => {
    const { fetchImpl } = jsonFetch({});
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await expect(
      client.createEvent({
        calendarId: "someone-else@gmail.com",
        summary: "X",
        start: { date: "2026-06-03" },
        end: { date: "2026-06-04" },
      })
    ).rejects.toBeInstanceOf(GoogleClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REFUSES all writes when no aiCalendarId is configured (no HTTP call)", async () => {
    const { fetchImpl } = jsonFetch({});
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: undefined,
    });
    await expect(
      client.createEvent({
        summary: "X",
        start: { date: "2026-06-03" },
        end: { date: "2026-06-04" },
      })
    ).rejects.toThrow(/no AI calendar configured/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ALLOWS create-event when calendarId is omitted (defaults to AI calendar)", async () => {
    const { fetchImpl, calls } = jsonFetch({ id: "evt1" });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    const res = await client.createEvent({
      summary: "Meeting",
      description: "desc",
      start: { dateTime: "2026-06-03T10:00:00+02:00" },
      end: { dateTime: "2026-06-03T11:00:00+02:00" },
    });
    expect(res).toEqual({ id: "evt1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = calls[0];
    expect(url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AI_CAL)}/events`
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fake-access-token"
    );
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      summary: "Meeting",
      description: "desc",
      start: { dateTime: "2026-06-03T10:00:00+02:00" },
      end: { dateTime: "2026-06-03T11:00:00+02:00" },
    });
  });

  it("ALLOWS create-event when calendarId == aiCalendarId", async () => {
    const { fetchImpl } = jsonFetch({ id: "evt2" });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await client.createEvent({
      calendarId: AI_CAL,
      summary: "X",
      start: { date: "2026-06-03" },
      end: { date: "2026-06-04" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("REFUSES update-event to a foreign calendarId without HTTP call", async () => {
    const { fetchImpl } = jsonFetch({});
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await expect(
      client.updateEvent({ calendarId: "other@x", eventId: "e1", summary: "Y" })
    ).rejects.toBeInstanceOf(GoogleClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ALLOWS update-event (PATCH) on the AI calendar", async () => {
    const { fetchImpl, calls } = jsonFetch({ id: "e1" });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await client.updateEvent({ eventId: "e1", summary: "Y" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].url).toContain(`/events/e1`);
  });
});

describe("GoogleClient read requests", () => {
  it("list-calendars hits calendarList", async () => {
    const { fetchImpl, calls } = jsonFetch({ items: [] });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await client.listCalendars();
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    );
    expect(calls[0].init.method).toBe("GET");
  });

  it("list-events builds singleEvents + orderBy + time window, defaults to primary", async () => {
    const { fetchImpl, calls } = jsonFetch({ items: [] });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await client.listEvents({ timeMin: "2026-06-01T00:00:00Z", timeMax: "2026-06-30T00:00:00Z" });
    const url = calls[0].url;
    expect(url).toContain("/calendars/primary/events?");
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(url).toContain("timeMin=2026-06-01T00%3A00%3A00Z");
    expect(url).toContain("timeMax=2026-06-30T00%3A00%3A00Z");
  });

  it("list-events can read ANY calendar (no enforcement on reads)", async () => {
    const { fetchImpl, calls } = jsonFetch({ items: [] });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aiCalendarId: AI_CAL,
    });
    await client.listEvents({ calendarId: "anybody@gmail.com" });
    expect(calls[0].url).toContain(
      `/calendars/${encodeURIComponent("anybody@gmail.com")}/events?`
    );
  });

  it("get-event encodes ids", async () => {
    const { fetchImpl, calls } = jsonFetch({ id: "e" });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getEvent({ calendarId: "c@x", eventId: "ev 1" });
    expect(calls[0].url).toContain(
      `/calendars/${encodeURIComponent("c@x")}/events/${encodeURIComponent("ev 1")}`
    );
  });

  it("gmail search hits messages with q", async () => {
    const { fetchImpl, calls } = jsonFetch({ messages: [] });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.gmailSearch({ q: 'label:"Foo" newer_than:14d' });
    expect(calls[0].url).toContain(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q="
    );
    expect(calls[0].url).toContain("newer_than%3A14d");
  });

  it("gmail get hits message?format=full", async () => {
    const { fetchImpl, calls } = jsonFetch({ id: "m1" });
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.gmailGet({ id: "m1" });
    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=full"
    );
  });
});

describe("GoogleClient error handling", () => {
  it("throws GoogleClientError on non-2xx", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "nope",
    } as unknown as Response));
    const client = new GoogleClient({
      tokenManager: fakeTokenManager(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listCalendars()).rejects.toThrow(/403/);
  });

  it("surfaces token-manager failure as a clear error", async () => {
    const tm = {
      getAccessToken: jest.fn().mockRejectedValue(new Error("no creds")),
    } as unknown as GoogleTokenManager;
    const fetchImpl = jest.fn();
    const client = new GoogleClient({
      tokenManager: tm,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listCalendars()).rejects.toThrow(/Failed to obtain Google access token/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("buildGmailQuery quotes label and joins parts", () => {
    expect(
      buildGmailQuery({ label: "Škola Slunovrat", newerThan: "14d" })
    ).toBe('label:"Škola Slunovrat" newer_than:14d');
    expect(buildGmailQuery({ query: "from:x" })).toBe("from:x");
    expect(buildGmailQuery({})).toBe("");
  });

  it("parseEventDateTime distinguishes all-day date from dateTime", () => {
    expect(parseEventDateTime("2026-06-03")).toEqual({ date: "2026-06-03" });
    expect(parseEventDateTime("2026-06-03T10:00:00+02:00")).toEqual({
      dateTime: "2026-06-03T10:00:00+02:00",
    });
  });
});
