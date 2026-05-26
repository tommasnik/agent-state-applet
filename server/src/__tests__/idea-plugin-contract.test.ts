/**
 * IDEA plugin contract testy (TASK-12.7)
 *
 * Ověřuje, že server při POST /focus zavolá IDEA plugin REST API (httpGet)
 * se správnými URL parametry.
 *
 * Klíčový kontrakt:
 *   - `project` param = basename(project_root), ne celá cesta
 *   - `tabName` param = tab_name agenta (unikátní per session, formát cc-{session_id[:8]})
 *   - IDEA plugin rozlišuje konkrétní záložku výhradně přes `tabName`
 *   - Při SC1 oba agenti mají project=proj1 (stejný basename), ale různé tabName
 *   - Ghostty agent → httpGet se NEZAVOLÁ
 *
 * Celá cesta v `project` by byla breaking change IDEA pluginu — basename je správný kontrakt.
 */

import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { buildApp } from "../app";
import { AgentStore } from "../agents";
import type { SystemCalls } from "../system-calls";
import type { ReviewMeta } from "../stateFile";

const FIXTURES = path.resolve(__dirname, "../../../test-fixtures/scenarios");

function loadFixture(scenario: string, file: string): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, scenario, file), "utf8"));
}

function makeMockSys(wmctrlOutput: string): jest.Mocked<SystemCalls> {
  return {
    wmctrlList: jest.fn().mockReturnValue(wmctrlOutput),
    wmctrlFocus: jest.fn(),
    wmctrlSwitchDesktop: jest.fn(),
    httpGet: jest.fn(),
  };
}

function parseQueryParams(capturedUrl: string): URLSearchParams {
  return new URL(capturedUrl).searchParams;
}

describe("IDEA plugin contract — SC1: 2× IDEA, stejné jméno projektu", () => {
  const SC = "sc1-idea-same-name";
  const wmctrl = fs.readFileSync(path.join(FIXTURES, SC, "wmctrl-output.txt"), "utf8");

  function setupSC1() {
    const store = new AgentStore();
    const pendingReviews = new Map<string, ReviewMeta>();
    const mockSys = makeMockSys(wmctrl);
    const app = buildApp(store, () => {}, pendingReviews, mockSys);
    return { store, app, mockSys };
  }

  test("agent A focus → httpGet URL obsahuje tabName=cc-aaaa1111 a project=proj1", async () => {
    const { app, mockSys } = setupSC1();
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const focusExp = loadFixture(SC, "focus-calls/click-a.json");

    await request(app).post("/agent").send(a);
    await request(app).post("/focus").send({ pid: a.pid }).expect(200);

    expect(mockSys.httpGet).toHaveBeenCalledTimes(1);
    const capturedUrl: string = (mockSys.httpGet as jest.Mock).mock.calls[0][0];
    const params = parseQueryParams(capturedUrl);

    expect(params.get("tabName")).toBe("cc-aaaa1111");
    expect(params.get("project")).toBe("proj1");
    expect(capturedUrl).toContain(focusExp.idea_api_url_contains);
    expect(capturedUrl).toContain(focusExp.idea_api_url_contains_project);
  });

  test("agent B focus → httpGet URL obsahuje tabName=cc-bbbb2222, project=proj1 (stejný basename!)", async () => {
    const { app, mockSys } = setupSC1();
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    const focusExp = loadFixture(SC, "focus-calls/click-b.json");

    await request(app).post("/agent").send(b);
    await request(app).post("/focus").send({ pid: b.pid }).expect(200);

    expect(mockSys.httpGet).toHaveBeenCalledTimes(1);
    const capturedUrl: string = (mockSys.httpGet as jest.Mock).mock.calls[0][0];
    const params = parseQueryParams(capturedUrl);

    expect(params.get("tabName")).toBe("cc-bbbb2222");
    // Klíčový kontrakt: project=proj1 (basename), ne celá cesta /home/tom/work/subfolder/proj1
    // IDEA plugin rozlišuje agenty výhradně přes tabName.
    expect(params.get("project")).toBe("proj1");
    expect(capturedUrl).toContain(focusExp.idea_api_url_contains);
    expect(capturedUrl).toContain(focusExp.idea_api_url_contains_project);
  });

  test("oba agenti mají project=proj1 ale různé tabName — IDEA je rozlišuje přes tabName", async () => {
    const { app, mockSys } = setupSC1();
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");

    await request(app).post("/agent").send(a);
    await request(app).post("/focus").send({ pid: a.pid });
    const urlA: string = (mockSys.httpGet as jest.Mock).mock.calls[0][0];

    mockSys.httpGet.mockClear();

    await request(app).post("/agent").send(b);
    await request(app).post("/focus").send({ pid: b.pid });
    const urlB: string = (mockSys.httpGet as jest.Mock).mock.calls[0][0];

    const paramsA = parseQueryParams(urlA);
    const paramsB = parseQueryParams(urlB);

    // Stejný project basename — kontrakt je basename, ne celá cesta
    expect(paramsA.get("project")).toBe("proj1");
    expect(paramsB.get("project")).toBe("proj1");

    // Různé tabName — to je klíčový disambiguátor pro IDEA plugin
    expect(paramsA.get("tabName")).not.toBe(paramsB.get("tabName"));
    expect(paramsA.get("tabName")).toBe("cc-aaaa1111");
    expect(paramsB.get("tabName")).toBe("cc-bbbb2222");
  });
});

describe("IDEA plugin contract — SC2: Ghostty agent", () => {
  const SC = "sc2-idea-and-ghostty";
  const wmctrl = fs.readFileSync(path.join(FIXTURES, SC, "wmctrl-output.txt"), "utf8");

  test("Ghostty agent focus → httpGet se NEZAVOLÁ", async () => {
    const store = new AgentStore();
    const pendingReviews = new Map<string, ReviewMeta>();
    const mockSys = makeMockSys(wmctrl);
    const app = buildApp(store, () => {}, pendingReviews, mockSys);

    const b = loadFixture(SC, "hook-payloads/agent-b.json"); // ghostty agent
    const focusExp = loadFixture(SC, "focus-calls/click-b.json");

    await request(app).post("/agent").send(b);
    await request(app).post("/focus").send({ pid: b.pid }).expect(200);

    // Ghostty terminal → IDEA plugin API se nevolá
    expect(focusExp.idea_api_called).toBe(false);
    expect(mockSys.httpGet).not.toHaveBeenCalled();
  });
});
