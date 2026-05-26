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

function makeMockSys(): jest.Mocked<SystemCalls> {
  return {
    wmctrlList: jest.fn(),
    wmctrlFocus: jest.fn(),
    wmctrlSwitchDesktop: jest.fn(),
    httpGet: jest.fn(),
  };
}

function makeApp(scenario: string, mockSys: jest.Mocked<SystemCalls>) {
  const store = new AgentStore();
  const pendingReviews = new Map<string, ReviewMeta>();
  const wmctrl = fs.readFileSync(path.join(FIXTURES, scenario, "wmctrl-output.txt"), "utf8");
  mockSys.wmctrlList.mockReturnValue(wmctrl);
  const app = buildApp(store, () => {}, pendingReviews, mockSys);
  return { store, app };
}

describe("SC1: 2x IDEA, stejne jmeno projektu, jina cesta", () => {
  const SC = "sc1-idea-same-name";
  let mockSys: jest.Mocked<SystemCalls>;
  let app: ReturnType<typeof buildApp>;
  let store: AgentStore;

  beforeEach(() => {
    mockSys = makeMockSys();
    ({ store, app } = makeApp(SC, mockSys));
  });

  test("POST /agent s obema payloady => store obsahuje 2 agenty s ruznymi project_root", async () => {
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a).expect(200);
    await request(app).post("/agent").send(b).expect(200);

    const { body } = await request(app).get("/status").expect(200);
    const agents = Object.values(body.agents) as any[];
    expect(agents).toHaveLength(2);
    const roots = agents.map((ag: any) => ag.project_root);
    expect(roots).toContain("/home/tom/work/proj1");
    expect(roots).toContain("/home/tom/work/subfolder/proj1");
  });

  test("GET /status odpovida fixture server-state (klicova pole)", async () => {
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a);
    await request(app).post("/agent").send(b);

    const expected = loadFixture(SC, "server-state/after-both-registered.json");
    const { body } = await request(app).get("/status");

    for (const [pid, exp] of Object.entries(expected) as [string, any][]) {
      const actual = body.agents[pid];
      expect(actual).toBeDefined();
      expect(actual.project_root).toBe(exp.project_root);
      expect(actual.terminal_type).toBe(exp.terminal_type);
      expect(actual.window_id).toBe(exp.window_id);
      expect(actual.tab_name).toBe(exp.tab_name);
    }
  });

  test("POST /focus pro agenta A => wmctrlFocus s XID agenta A", async () => {
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a);
    await request(app).post("/agent").send(b);

    const focusExp = loadFixture(SC, "focus-calls/click-a.json");
    await request(app).post("/focus").send({ pid: a.pid }).expect(200);

    expect(mockSys.wmctrlFocus).toHaveBeenCalledWith(focusExp.wmctrl_xid);
    expect(mockSys.httpGet).toHaveBeenCalledWith(
      expect.stringContaining(focusExp.idea_api_url_contains)
    );
  });

  test("POST /focus pro agenta B => wmctrlFocus s XID agenta B (ne agenta A)", async () => {
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a);
    await request(app).post("/agent").send(b);

    const focusExpA = loadFixture(SC, "focus-calls/click-a.json");
    const focusExpB = loadFixture(SC, "focus-calls/click-b.json");
    await request(app).post("/focus").send({ pid: b.pid }).expect(200);

    expect(mockSys.wmctrlFocus).toHaveBeenCalledWith(focusExpB.wmctrl_xid);
    expect(mockSys.wmctrlFocus).not.toHaveBeenCalledWith(focusExpA.wmctrl_xid);
  });
});

describe("SC2: IDEA + Ghostty", () => {
  const SC = "sc2-idea-and-ghostty";
  let mockSys: jest.Mocked<SystemCalls>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockSys = makeMockSys();
    ({ app } = makeApp(SC, mockSys));
  });

  async function registerBoth() {
    const a = loadFixture(SC, "hook-payloads/agent-a.json");
    const b = loadFixture(SC, "hook-payloads/agent-b.json");
    await request(app).post("/agent").send(a);
    await request(app).post("/agent").send(b);
    return { a, b };
  }

  test("IDEA agent focus => httpGet zavolan s IDEA plugin URL", async () => {
    const { a } = await registerBoth();
    const focusExp = loadFixture(SC, "focus-calls/click-a.json");
    await request(app).post("/focus").send({ pid: a.pid }).expect(200);

    expect(focusExp.idea_api_called).toBe(true);
    expect(mockSys.httpGet).toHaveBeenCalledWith(
      expect.stringContaining(focusExp.idea_api_url_contains)
    );
  });

  test("Ghostty agent focus => httpGet NEZAVOLAN", async () => {
    const { b } = await registerBoth();
    const focusExp = loadFixture(SC, "focus-calls/click-b.json");
    await request(app).post("/focus").send({ pid: b.pid }).expect(200);

    expect(focusExp.idea_api_called).toBe(false);
    expect(mockSys.httpGet).not.toHaveBeenCalled();
  });

  test("Oba agenti maji ruzny terminal_type ve store", async () => {
    await registerBoth();
    const { body } = await request(app).get("/status");
    const agents = Object.values(body.agents) as any[];
    const types = agents.map((ag: any) => ag.terminal_type).sort();
    expect(types).toEqual(["ghostty", "idea"]);
  });
});
