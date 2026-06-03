import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GoogleTokenManager,
  loadGoogleCredentials,
  GOOGLE_TOKEN_ENDPOINT,
  TokenFetch,
} from "../googleAuth";

const CREDS = {
  client_id: "cid",
  client_secret: "secret",
  refresh_token: "rtok",
};

describe("googleAuth / loadGoogleCredentials", () => {
  it("throws a descriptive error when the file is missing", () => {
    expect(() =>
      loadGoogleCredentials("/nonexistent/google-oauth.json")
    ).toThrow(/not found/);
  });

  it("throws when a required field is missing", () => {
    const tmp = path.join(os.tmpdir(), `ga-creds-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ client_id: "x" }));
    try {
      expect(() => loadGoogleCredentials(tmp)).toThrow(/missing field/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("loads valid credentials", () => {
    const tmp = path.join(os.tmpdir(), `ga-creds-ok-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(CREDS));
    try {
      expect(loadGoogleCredentials(tmp)).toEqual(CREDS);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe("googleAuth / GoogleTokenManager", () => {
  it("exchanges refresh_token for an access_token via the token endpoint", async () => {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const fetchToken: TokenFetch = async (url, body) => {
      calls.push({ url, body });
      return { access_token: "AT-1", expires_in: 3600 };
    };
    const mgr = new GoogleTokenManager({ credentials: CREDS, fetchToken });

    const tok = await mgr.getAccessToken();
    expect(tok).toBe("AT-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(calls[0].body).toMatchObject({
      grant_type: "refresh_token",
      client_id: "cid",
      client_secret: "secret",
      refresh_token: "rtok",
    });
  });

  it("caches the token and does not re-fetch while valid", async () => {
    let n = 0;
    const fetchToken: TokenFetch = async () => {
      n += 1;
      return { access_token: `AT-${n}`, expires_in: 3600 };
    };
    let now = 1_000_000;
    const mgr = new GoogleTokenManager({
      credentials: CREDS,
      fetchToken,
      now: () => now,
    });

    expect(await mgr.getAccessToken()).toBe("AT-1");
    now += 1000; // 1s later, still well within validity
    expect(await mgr.getAccessToken()).toBe("AT-1");
    expect(n).toBe(1);
  });

  it("refreshes after expiry (accounting for the skew window)", async () => {
    let n = 0;
    const fetchToken: TokenFetch = async () => {
      n += 1;
      return { access_token: `AT-${n}`, expires_in: 100 };
    };
    let now = 0;
    const mgr = new GoogleTokenManager({
      credentials: CREDS,
      fetchToken,
      now: () => now,
    });

    expect(await mgr.getAccessToken()).toBe("AT-1");
    // expires_in=100s, skew=60s → valid until now < 40s. Jump past that.
    now = 50_000;
    expect(await mgr.getAccessToken()).toBe("AT-2");
    expect(n).toBe(2);
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    let n = 0;
    const fetchToken: TokenFetch = async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { access_token: `AT-${n}`, expires_in: 3600 };
    };
    const mgr = new GoogleTokenManager({ credentials: CREDS, fetchToken });
    const [a, b] = await Promise.all([
      mgr.getAccessToken(),
      mgr.getAccessToken(),
    ]);
    expect(a).toBe("AT-1");
    expect(b).toBe("AT-1");
    expect(n).toBe(1);
  });

  it("throws when the endpoint returns no access_token", async () => {
    const fetchToken: TokenFetch = async () =>
      ({} as unknown as { access_token: string });
    const mgr = new GoogleTokenManager({ credentials: CREDS, fetchToken });
    await expect(mgr.getAccessToken()).rejects.toThrow(/no access_token/);
  });

  it("surfaces missing-credentials errors lazily on first use", async () => {
    const mgr = new GoogleTokenManager({
      credentialsPath: "/nonexistent/google-oauth.json",
      fetchToken: async () => ({ access_token: "x", expires_in: 1 }),
    });
    await expect(mgr.getAccessToken()).rejects.toThrow(/not found/);
  });
});
