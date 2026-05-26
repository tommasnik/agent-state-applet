import { resolveWindowId } from "../routes/focus";

type WmWindow = { xid: string; desktop: string; title: string };

describe("resolveWindowId", () => {
  const windows: WmWindow[] = [
    { xid: "0x1111", desktop: "0", title: "bot-platform – IntelliJ IDEA" },
    { xid: "0x2222", desktop: "0", title: "bot-platform – IntelliJ IDEA" },
    { xid: "0x3333", desktop: "0", title: "other-project" },
  ];

  test("returns stored window_id when found in window list (first window)", () => {
    expect(resolveWindowId("0x1111", "/side-project/bot-platform", windows)).toBe("0x1111");
  });

  test("returns stored window_id when found in window list (second window)", () => {
    expect(resolveWindowId("0x2222", "/work/bot-platform", windows)).toBe("0x2222");
  });

  test("stored id wins over name match — different instance same name", () => {
    // Key fix: both projects are named "bot-platform", but agent has window_id 0x2222
    // Should NOT fall back to 0x1111 (first name match)
    const result = resolveWindowId("0x2222", "/side-project/bot-platform", windows);
    expect(result).toBe("0x2222");
  });

  test("falls back to name match when stored window_id not in list", () => {
    const result = resolveWindowId("0xdead", "/work/bot-platform", windows);
    expect(result).toBe("0x1111"); // first name match
  });

  test("falls back to name match when stored window_id is empty", () => {
    const result = resolveWindowId("", "/code/other-project", windows);
    expect(result).toBe("0x3333");
  });

  test("returns empty string when no match and no valid stored id", () => {
    const result = resolveWindowId("", "/nonexistent/project", windows);
    expect(result).toBe("");
  });

  test("decimal xid also validates correctly", () => {
    // 0x1111 = 4369 decimal
    expect(resolveWindowId("4369", "/side-project/bot-platform", windows)).toBe("4369");
  });
});
