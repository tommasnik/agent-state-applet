import {
  buildWhitelist,
  filterInputs,
  isAllowed,
  isGmailAllowed,
  isWhatsAppAllowed,
  WhitelistConfig,
  WhatsAppInput,
  GmailInput,
} from "../whitelist";

const WL: WhitelistConfig = {
  whatsapp: { groups: ["Family", "Team Standup"] },
  gmail: {
    senders: ["@daktela.com", "boss@example.com"],
    labels: ["Important", "Invoices"],
  },
};

function wa(group: string, text = "hi"): WhatsAppInput {
  return { source: "whatsapp", group, text };
}
function gm(
  from: string,
  labels: string[] = [],
  subject = "subj"
): GmailInput {
  return { source: "gmail", from, labels, subject };
}

describe("buildWhitelist", () => {
  it("parses a full whitelist object", () => {
    const wl = buildWhitelist({
      whatsapp: { groups: ["A", "B"] },
      gmail: { senders: ["x@y.com"], labels: ["L"] },
    });
    expect(wl.whatsapp.groups).toEqual(["A", "B"]);
    expect(wl.gmail.senders).toEqual(["x@y.com"]);
    expect(wl.gmail.labels).toEqual(["L"]);
  });

  it("returns empty deny-all whitelist for malformed / missing input", () => {
    for (const bad of [undefined, null, 42, "nope", []]) {
      const wl = buildWhitelist(bad);
      expect(wl.whatsapp.groups).toEqual([]);
      expect(wl.gmail.senders).toEqual([]);
      expect(wl.gmail.labels).toEqual([]);
    }
  });

  it("drops non-string and empty entries", () => {
    const wl = buildWhitelist({
      whatsapp: { groups: ["ok", 1, "", null] },
      gmail: { senders: [2, "good@x.com"], labels: [false, "L"] },
    });
    expect(wl.whatsapp.groups).toEqual(["ok"]);
    expect(wl.gmail.senders).toEqual(["good@x.com"]);
    expect(wl.gmail.labels).toEqual(["L"]);
  });

  it("tolerates partial config (only whatsapp, only gmail)", () => {
    expect(buildWhitelist({ whatsapp: { groups: ["A"] } }).gmail).toEqual({
      senders: [],
      labels: [],
    });
    expect(buildWhitelist({ gmail: { labels: ["L"] } }).whatsapp).toEqual({
      groups: [],
    });
  });
});

describe("isWhatsAppAllowed", () => {
  it("allows whitelisted groups (case-insensitive, trimmed)", () => {
    expect(isWhatsAppAllowed(wa("Family"), WL)).toBe(true);
    expect(isWhatsAppAllowed(wa("  family  "), WL)).toBe(true);
    expect(isWhatsAppAllowed(wa("TEAM STANDUP"), WL)).toBe(true);
  });

  it("blocks non-whitelisted groups", () => {
    expect(isWhatsAppAllowed(wa("Random Group"), WL)).toBe(false);
    expect(isWhatsAppAllowed(wa("Fam"), WL)).toBe(false);
  });
});

describe("isGmailAllowed", () => {
  it("allows by sender substring match", () => {
    expect(isGmailAllowed(gm("Jane <jane@daktela.com>"), WL)).toBe(true);
    expect(isGmailAllowed(gm("boss@example.com"), WL)).toBe(true);
  });

  it("allows by label", () => {
    expect(isGmailAllowed(gm("nobody@nowhere.com", ["Important"]), WL)).toBe(
      true
    );
    expect(isGmailAllowed(gm("nobody@nowhere.com", ["invoices"]), WL)).toBe(
      true
    );
  });

  it("blocks unknown sender with no matching label", () => {
    expect(isGmailAllowed(gm("spam@evil.com", ["Promotions"]), WL)).toBe(false);
    expect(isGmailAllowed(gm("spam@evil.com"), WL)).toBe(false);
  });
});

describe("isAllowed / filterInputs", () => {
  it("routes by source", () => {
    expect(isAllowed(wa("Family"), WL)).toBe(true);
    expect(isAllowed(gm("x@daktela.com"), WL)).toBe(true);
    expect(isAllowed(wa("Nope"), WL)).toBe(false);
  });

  it("filters a mixed batch down to whitelisted inputs only", () => {
    const inputs = [
      wa("Family", "keep1"),
      wa("Strangers", "drop1"),
      gm("ceo@daktela.com", [], "keep2"),
      gm("spam@evil.com", ["Promotions"], "drop2"),
      gm("x@nowhere.com", ["Invoices"], "keep3"),
    ];
    const kept = filterInputs(inputs, WL);
    const texts = kept.map((i) =>
      i.source === "whatsapp" ? i.text : (i as GmailInput).subject
    );
    expect(texts).toEqual(["keep1", "keep2", "keep3"]);
  });

  it("deny-all whitelist passes nothing", () => {
    const empty = buildWhitelist(undefined);
    expect(filterInputs([wa("Family"), gm("x@daktela.com")], empty)).toEqual(
      []
    );
  });
});
