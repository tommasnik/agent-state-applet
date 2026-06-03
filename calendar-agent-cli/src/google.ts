/**
 * Google Calendar + Gmail operations over the *raw* Google REST APIs
 * (calendar/v3, gmail/v1), exposed as CLI command handlers.
 *
 * INDEPENDENT reimplementation inspired by calendar-agent/src/googleTools.ts,
 * but as plain CLI operations rather than SDK MCP tools. No code is imported
 * from the reference SDK package.
 *
 * HARD ENFORCEMENT (TASK-29/36): the write operations (`createEvent` /
 * `updateEvent`) accept writes ONLY to the configured AI calendar. Any other
 * `calendarId` is refused before any HTTP call. When no AI calendar is
 * configured, ALL writes are refused. Read operations are unrestricted (the
 * agent must read every calendar to detect conflicts / dedup).
 *
 * The token manager + fetch implementation are injectable so tests run without
 * touching the network or real OAuth.
 */

import { GoogleTokenManager } from "./googleAuth";

/** Injectable fetch (defaults to the Node 18+ global `fetch`). */
export type FetchImpl = typeof fetch;

export const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
export const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export interface GoogleClientOptions {
  /** Token source; defaults to a fresh {@link GoogleTokenManager}. */
  tokenManager?: GoogleTokenManager;
  /** HTTP transport; defaults to global `fetch`. */
  fetchImpl?: FetchImpl;
  /**
   * ID of the dedicated AI calendar. HARD ENFORCEMENT: the write operations
   * accept writes ONLY to this calendarId. When undefined, ALL writes are
   * refused.
   */
  aiCalendarId?: string;
}

/** A field on the event start/end (RFC3339 dateTime or all-day date). */
export interface EventDateTime {
  dateTime?: string;
  date?: string;
}

/** Raised by enforcement / argument validation; carries a clean message. */
export class GoogleClientError extends Error {}

/**
 * Thin client over the raw Google REST APIs. Holds a single
 * {@link GoogleTokenManager} and applies AI-calendar write enforcement.
 */
export class GoogleClient {
  private readonly tokenManager: GoogleTokenManager;
  private readonly fetchImpl: FetchImpl;
  private readonly aiCalendarId?: string;

  constructor(opts: GoogleClientOptions = {}) {
    this.tokenManager = opts.tokenManager ?? new GoogleTokenManager();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.aiCalendarId = opts.aiCalendarId;
  }

  /**
   * Perform an authenticated Google REST request. Fetches a fresh access token
   * PER CALL so the token manager's cache + auto-refresh keeps a long-lived
   * session valid. Throws {@link GoogleClientError} on token / network / non-2xx
   * failure with a readable message.
   */
  private async request(
    url: string,
    init: { method: string; body?: unknown } = { method: "GET" }
  ): Promise<unknown> {
    let token: string;
    try {
      token = await this.tokenManager.getAccessToken();
    } catch (err) {
      throw new GoogleClientError(
        `Failed to obtain Google access token: ${String(err)}`
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const reqInit: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    } = { method: init.method, headers };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      reqInit.body = JSON.stringify(init.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, reqInit);
    } catch (err) {
      throw new GoogleClientError(`Google request failed: ${String(err)}`);
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new GoogleClientError(
        `Google API ${res.status} ${res.statusText}: ${detail || "(no body)"}`
      );
    }

    if (res.status === 204) {
      return { success: true };
    }
    try {
      return await res.json();
    } catch (err) {
      throw new GoogleClientError(
        `Failed to parse Google response: ${String(err)}`
      );
    }
  }

  /**
   * HARD ENFORCEMENT of the dedicated AI calendar. Resolve the calendarId a
   * write op may use:
   *   - no AI calendar configured  → refuse ALL writes;
   *   - incoming calendarId omitted → default to the AI calendar;
   *   - incoming calendarId differs → refuse.
   * Throws {@link GoogleClientError} (no HTTP performed) on refusal.
   */
  private enforceAiCalendar(incoming: string | undefined): string {
    if (!this.aiCalendarId) {
      throw new GoogleClientError(
        "Refused: no AI calendar configured (aiCalendarId is unset); refusing to write."
      );
    }
    const id = incoming && incoming.length > 0 ? incoming : undefined;
    if (id !== undefined && id !== this.aiCalendarId) {
      throw new GoogleClientError(
        `Refused: writes are only allowed to the dedicated AI calendar (${this.aiCalendarId}). Got calendarId=${id}.`
      );
    }
    return this.aiCalendarId;
  }

  // ---- Calendar (read) ---------------------------------------------------

  listCalendars(): Promise<unknown> {
    return this.request(`${CALENDAR_BASE}/users/me/calendarList`);
  }

  listEvents(opts: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
  }): Promise<unknown> {
    const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
    });
    if (opts.timeMin) params.set("timeMin", opts.timeMin);
    if (opts.timeMax) params.set("timeMax", opts.timeMax);
    return this.request(
      `${CALENDAR_BASE}/calendars/${calendarId}/events?${params.toString()}`
    );
  }

  getEvent(opts: { calendarId?: string; eventId: string }): Promise<unknown> {
    const calendarId = encodeURIComponent(opts.calendarId ?? "primary");
    const eventId = encodeURIComponent(opts.eventId);
    return this.request(
      `${CALENDAR_BASE}/calendars/${calendarId}/events/${eventId}`
    );
  }

  // ---- Calendar (write, enforced) ----------------------------------------

  async createEvent(opts: {
    calendarId?: string;
    summary: string;
    start: EventDateTime;
    end: EventDateTime;
    description?: string;
  }): Promise<unknown> {
    const calendarId = encodeURIComponent(this.enforceAiCalendar(opts.calendarId));
    const body: Record<string, unknown> = {
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
    };
    if (opts.description !== undefined) body.description = opts.description;
    return this.request(`${CALENDAR_BASE}/calendars/${calendarId}/events`, {
      method: "POST",
      body,
    });
  }

  async updateEvent(opts: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    start?: EventDateTime;
    end?: EventDateTime;
    description?: string;
  }): Promise<unknown> {
    const calendarId = encodeURIComponent(this.enforceAiCalendar(opts.calendarId));
    const eventId = encodeURIComponent(opts.eventId);
    const body: Record<string, unknown> = {};
    if (opts.summary !== undefined) body.summary = opts.summary;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.start !== undefined) body.start = opts.start;
    if (opts.end !== undefined) body.end = opts.end;
    return this.request(
      `${CALENDAR_BASE}/calendars/${calendarId}/events/${eventId}`,
      { method: "PATCH", body }
    );
  }

  // ---- Gmail (read-only) -------------------------------------------------

  gmailSearch(opts: { q?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString();
    return this.request(
      `${GMAIL_BASE}/users/me/messages${qs ? `?${qs}` : ""}`
    );
  }

  gmailGet(opts: { id: string }): Promise<unknown> {
    const id = encodeURIComponent(opts.id);
    return this.request(`${GMAIL_BASE}/users/me/messages/${id}?format=full`);
  }
}

/**
 * Build a Gmail search query string from a label / free query / newer-than
 * window. `label:"..."` is quoted to tolerate spaces in label names.
 */
export function buildGmailQuery(opts: {
  label?: string;
  query?: string;
  newerThan?: string;
}): string {
  const parts: string[] = [];
  if (opts.label) parts.push(`label:"${opts.label}"`);
  if (opts.newerThan) parts.push(`newer_than:${opts.newerThan}`);
  if (opts.query) parts.push(opts.query);
  return parts.join(" ");
}

/**
 * Parse a start/end CLI value into an event date/time field. A bare date
 * (YYYY-MM-DD) becomes an all-day `{ date }`; anything else is treated as an
 * RFC3339 `{ dateTime }`.
 */
export function parseEventDateTime(value: string): EventDateTime {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: value };
}
