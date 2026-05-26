---
id: TASK-12.4
title: 'TASK-12d: Hook integrační testy — fixture-driven'
status: Done
assignee: []
created_date: '2026-05-26 08:10'
updated_date: '2026-05-26 08:30'
labels:
  - testing
  - hook
  - python
dependencies:
  - TASK-12.1
parent_task_id: TASK-12
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ověření, že hook generuje přesně ta data která jsou v fixtures. Mock HTTP server zachytí POST a porovná s fixture.

## Závislosti

Vyžaduje TASK-12a (fixtures).

## Implementace

```python
# server/tests/test_hook_scenarios.py
import pytest, json, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

FIXTURES = Path(__file__).parent.parent.parent / "test-fixtures/scenarios"

def load_fixture(scenario, filename):
    return json.loads((FIXTURES / scenario / filename).read_text())

class CapturingHandler(BaseHTTPRequestHandler):
    received = []
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.received.append(json.loads(body))
        self.send_response(200)
        self.end_headers()
    def log_message(self, *_): pass

@pytest.fixture
def mock_server(monkeypatch):
    CapturingHandler.received = []
    srv = HTTPServer(("127.0.0.1", 0), CapturingHandler)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever)
    t.daemon = True
    t.start()
    monkeypatch.setattr("state_report.SERVER_URL", f"http://127.0.0.1:{port}/agent")
    yield CapturingHandler
    srv.shutdown()

# SC1: hook pro ~/work/proj1 pošle správný payload
def test_sc1_agent_a_payload(mock_server, tmp_path, monkeypatch):
    expected = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    # Simulace hook invokace pro daný cwd + env
    monkeypatch.chdir(expected["cwd"])
    # ... invoke main() s fixture SessionStart eventem ...
    assert len(mock_server.received) == 1
    actual = mock_server.received[0]
    assert actual["project_root"] == expected["project_root"]
    assert actual["terminal_type"] == expected["terminal_type"]
    assert actual["tty"] == expected["tty"]
    # window_id a PID se netestují (závisí na runtime)

# SC2: ghostty agent má terminal_type=ghostty
def test_sc2_ghostty_terminal_type(mock_server, monkeypatch):
    monkeypatch.setenv("TERM_PROGRAM", "ghostty")
    expected = load_fixture("sc2-idea-and-ghostty", "hook-payloads/agent-ghostty.json")
    # ...
    assert mock_server.received[0]["terminal_type"] == "ghostty"
```

## Co se testuje

- `project_root` správně odvozeno pro každý scénář
- `terminal_type` správně detekován
- `tab_name` ve formátu `cc-<8 chars>`
- `tty` ve formátu `/dev/pts/N`
- payload obsahuje všechna povinná pole ze schématu
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SC1 agent-a: project_root == /home/tom/work/proj1
- [x] #2 SC1 agent-b: project_root == /home/tom/work/subfolder/proj1
- [x] #3 SC2 IDEA agent: terminal_type == idea
- [x] #4 SC2 Ghostty agent: terminal_type == ghostty
- [x] #5 Oba agenti SC2 mají stejný project_root
- [x] #6 tab_name má správný formát cc-XXXXXXXX
- [x] #7 Testy nezávisí na běžícím procesu Claude ani wmctrl
<!-- AC:END -->
