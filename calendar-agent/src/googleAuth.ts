import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Google OAuth token manager for the official Google remote MCP servers
 * (Calendar / Gmail). The Claude Agent SDK does NOT perform any OAuth flow for
 * remote (`type: "http"`) MCP servers — it only forwards a bearer token in the
 * `Authorization` header. This module owns that token: it reads long-lived
 * OAuth credentials (client_id / client_secret / refresh_token) from disk and
 * exchanges the refresh_token for a short-lived access_token, caching it until
 * shortly before it expires.
 *
 * The HTTP call to Google's token endpoint is injectable ({@link TokenFetch})
 * so tests never touch the network.
 */

/** Where the Google OAuth credentials live by default. */
const DEFAULT_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".config",
  "agent-manager",
  "google-oauth.json"
);

/** Google's OAuth2 token endpoint (refresh_token grant). */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Seconds of head-room before actual expiry at which we proactively refresh. */
const EXPIRY_SKEW_SECONDS = 60;

/** Stored Google OAuth credentials. */
export interface GoogleOAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

/** Raw response shape from the Google token endpoint we care about. */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Minimal injectable transport: given the token endpoint and a form-encoded
 * body, return the parsed JSON token response. Defaults to a `fetch`-based
 * implementation; tests inject a stub. Kept tiny on purpose so it is trivial to
 * mock and does not couple the module to a particular HTTP client.
 */
export type TokenFetch = (
  url: string,
  body: Record<string, string>
) => Promise<GoogleTokenResponse>;

/** Resolve the credentials path (override via $GOOGLE_OAUTH_CREDENTIALS). */
export function credentialsPath(): string {
  const explicit = process.env.GOOGLE_OAUTH_CREDENTIALS;
  return explicit && explicit.length > 0 ? explicit : DEFAULT_CREDENTIALS_PATH;
}

/**
 * Load + validate Google OAuth credentials from disk. Throws a descriptive
 * error if the file is missing or any required field is absent — a misconfigured
 * Google auth is a loud failure, not a silent one (the agent cannot reach
 * Calendar/Gmail without it).
 */
export function loadGoogleCredentials(
  filePath: string = credentialsPath()
): GoogleOAuthCredentials {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Google OAuth credentials not found at ${filePath}. ` +
        "Create it with { client_id, client_secret, refresh_token } " +
        "(see docs/SETUP.md, Part 2)."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Google OAuth credentials at ${filePath} are not valid JSON: ${String(err)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Google OAuth credentials at ${filePath} are malformed.`);
  }
  const o = parsed as Record<string, unknown>;
  const missing = (["client_id", "client_secret", "refresh_token"] as const).filter(
    (k) => typeof o[k] !== "string" || (o[k] as string).length === 0
  );
  if (missing.length > 0) {
    throw new Error(
      `Google OAuth credentials at ${filePath} missing field(s): ${missing.join(", ")}.`
    );
  }
  return {
    client_id: o.client_id as string,
    client_secret: o.client_secret as string,
    refresh_token: o.refresh_token as string,
  };
}

/** Default fetch-based token transport (Node 18+ global `fetch`). */
const defaultTokenFetch: TokenFetch = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google token endpoint returned ${res.status}: ${text || res.statusText}`
    );
  }
  return (await res.json()) as GoogleTokenResponse;
};

export interface GoogleTokenManagerOptions {
  /** Pre-loaded credentials (skips disk read). */
  credentials?: GoogleOAuthCredentials;
  /** Path to load credentials from (used when `credentials` is omitted). */
  credentialsPath?: string;
  /** Injectable token transport (tests pass a stub; defaults to fetch). */
  fetchToken?: TokenFetch;
  /** Injectable clock (defaults to Date.now), in ms. */
  now?: () => number;
}

/**
 * Caches a Google access_token obtained by exchanging a refresh_token, and
 * transparently refreshes it once it nears expiry. One instance per Google
 * identity; the host holds a single instance for the lifetime of the session.
 */
export class GoogleTokenManager {
  private credentials?: GoogleOAuthCredentials;
  private readonly credentialsFile?: string;
  private readonly fetchToken: TokenFetch;
  private readonly now: () => number;

  private cachedToken: string | null = null;
  /** Absolute epoch ms at which the cached token must be considered expired. */
  private expiresAtMs = 0;
  /** In-flight refresh, so concurrent callers share one network call. */
  private inFlight: Promise<string> | null = null;

  constructor(opts: GoogleTokenManagerOptions = {}) {
    this.credentials = opts.credentials;
    this.credentialsFile = opts.credentialsPath;
    this.fetchToken = opts.fetchToken ?? defaultTokenFetch;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Resolve credentials, loading from disk lazily on first use. */
  private getCredentials(): GoogleOAuthCredentials {
    if (!this.credentials) {
      this.credentials = loadGoogleCredentials(
        this.credentialsFile ?? credentialsPath()
      );
    }
    return this.credentials;
  }

  /** True if we hold a cached token that is still valid (with skew head-room). */
  private isCachedTokenValid(): boolean {
    return (
      this.cachedToken !== null &&
      this.now() < this.expiresAtMs - EXPIRY_SKEW_SECONDS * 1000
    );
  }

  /**
   * Get a valid Google access_token, refreshing from the refresh_token if the
   * cache is empty or near expiry. Concurrent calls share one refresh.
   */
  async getAccessToken(): Promise<string> {
    if (this.isCachedTokenValid()) {
      return this.cachedToken as string;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Force a token exchange against Google, updating the cache. */
  private async refresh(): Promise<string> {
    const creds = this.getCredentials();
    const resp = await this.fetchToken(GOOGLE_TOKEN_ENDPOINT, {
      grant_type: "refresh_token",
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
    });
    if (!resp || typeof resp.access_token !== "string" || !resp.access_token) {
      throw new Error("Google token endpoint returned no access_token.");
    }
    const expiresIn =
      typeof resp.expires_in === "number" && resp.expires_in > 0
        ? resp.expires_in
        : 3600;
    this.cachedToken = resp.access_token;
    this.expiresAtMs = this.now() + expiresIn * 1000;
    return this.cachedToken;
  }
}
