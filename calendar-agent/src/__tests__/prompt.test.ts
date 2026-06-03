import * as fs from "fs";
import * as path from "path";
import { loadSystemPrompt, promptPath } from "../prompt";

/**
 * TASK-30 — the master decision-logic prompt lives in `prompt.md` at the
 * package root and is loaded verbatim as the SDK system prompt. These tests
 * pin the loader wiring (AC#1) and the *concepts* the prompt must define
 * (AC#2, AC#3). They check for key directives/sections rather than exact
 * wording, so the prompt can be reworded without breaking the suite.
 */
describe("system prompt (prompt.md)", () => {
  const prompt = loadSystemPrompt();
  const lower = prompt.toLowerCase();

  // AC#1 — the loader resolves to the package-root prompt.md by default and
  // returns non-empty content used as the system prompt.
  describe("AC#1: prompt.md exists and is loaded as the system prompt", () => {
    it("default promptPath() points at the package-root prompt.md", () => {
      const prev = process.env.CALENDAR_AGENT_PROMPT;
      delete process.env.CALENDAR_AGENT_PROMPT;
      try {
        const p = promptPath();
        expect(path.basename(p)).toBe("prompt.md");
        expect(fs.existsSync(p)).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.CALENDAR_AGENT_PROMPT;
        else process.env.CALENDAR_AGENT_PROMPT = prev;
      }
    });

    it("loads non-trivial, real (non-placeholder) prompt content", () => {
      expect(prompt.trim().length).toBeGreaterThan(500);
      // The TASK-30 placeholder was explicitly marked; ensure it is gone.
      expect(lower).not.toContain("(placeholder)");
      expect(lower).not.toContain("will be replaced");
    });
  });

  // AC#2 — conservative event criteria, semantic dedup, source embedding.
  describe("AC#2: conservative criteria, semantic dedup, source embedding", () => {
    it("defines conservative event criteria (concrete date/time required)", () => {
      expect(lower).toContain("conservativ");
      // requires an unambiguous date/time/deadline
      expect(lower).toMatch(/unambiguous|concrete/);
      expect(lower).toMatch(/date|time|deadline/);
      // vague/ambiguous hints must NOT be written
      expect(lower).toMatch(/vague|ambiguous|hint/);
    });

    it("requires semantic deduplication: read the calendar, match by topic, update vs create", () => {
      expect(lower).toMatch(/dedup|duplicat/);
      // read the AI calendar before writing
      expect(lower).toMatch(/read the ai calendar|read the calendar|before .*writ/);
      // match on meaning/topic, not exact text
      expect(lower).toMatch(/topic|meaning|semantic/);
      // update existing vs create new
      expect(lower).toContain("update");
      expect(lower).toContain("create");
    });

    it("requires embedding concrete sources into every event", () => {
      expect(lower).toContain("source");
      // mail links + attachments + whatsapp message text
      expect(lower).toMatch(/link/);
      expect(lower).toContain("attachment");
      expect(lower).toContain("whatsapp");
      // sources are preserved on update
      expect(lower).toMatch(/preserve|keep|append/);
    });
  });

  // AC#3 — write only to the AI calendar; escalate when uncertain.
  describe("AC#3: AI-calendar-only boundary + escalation on uncertainty", () => {
    it("instructs writing exclusively to the AI calendar and reading others only", () => {
      expect(lower).toContain("ai calendar");
      expect(lower).toMatch(/only|exclusiv|read-only/);
      // explicitly note the boundary is NOT enforced by OAuth
      expect(lower).toContain("oauth");
    });

    it("instructs escalation when uncertain (and waiting for the decision)", () => {
      expect(lower).toContain("escalat");
      expect(lower).toMatch(/uncertain|not sure|unsure|doubt|confiden/);
      expect(lower).toMatch(/approval queue|approval|wait/);
    });
  });
});
