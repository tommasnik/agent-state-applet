import {
  GoogleTokenManager,
  loadGoogleCredentials,
} from "../googleAuth";

const CREDS = {
  client_id: "cid",
  client_secret: "secret",
  refresh_token: "rtok",
};

describe("GoogleTokenManager", () => {
  it("exchanges refresh_token and caches the access_token", async () => {
    const fetchToken = jest.fn().mockResolvedValue({
      access_token: "tokA",
      expires_in: 3600,
    });
    const tm = new GoogleTokenManager({
      credentials: CREDS,
      fetchToken,
      now: () => 0,
    });
    expect(await tm.getAccessToken()).toBe("tokA");
    expect(await tm.getAccessToken()).toBe("tokA");
    // Cached → only one exchange.
    expect(fetchToken).toHaveBeenCalledTimes(1);
    const [, body] = fetchToken.mock.calls[0];
    expect(body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "rtok",
      client_id: "cid",
      client_secret: "secret",
    });
  });

  it("auto-refreshes once the cached token nears expiry", async () => {
    let clock = 0;
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce({ access_token: "tokA", expires_in: 3600 })
      .mockResolvedValueOnce({ access_token: "tokB", expires_in: 3600 });
    const tm = new GoogleTokenManager({
      credentials: CREDS,
      fetchToken,
      now: () => clock,
    });
    expect(await tm.getAccessToken()).toBe("tokA");
    // Advance past expiry (3600s) → forces refresh.
    clock = 3600_000 + 1;
    expect(await tm.getAccessToken()).toBe("tokB");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when credentials file is missing", () => {
    expect(() =>
      loadGoogleCredentials("/nonexistent/google-oauth.json")
    ).toThrow(/not found/);
  });

  it("throws when the token endpoint returns no access_token", async () => {
    const fetchToken = jest.fn().mockResolvedValue({ access_token: "" });
    const tm = new GoogleTokenManager({ credentials: CREDS, fetchToken });
    await expect(tm.getAccessToken()).rejects.toThrow(/no access_token/);
  });
});
