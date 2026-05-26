"""Hook scénářové integrační testy — fixture-driven.

Ověřuje, že state_report.main() generuje správná POST data pro každý
fixture scénář, aniž by záviselo na /proc, wmctrl nebo běžícím Claude.
"""
import io
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

import state_report

FIXTURES = Path(__file__).parent.parent.parent / "test-fixtures" / "scenarios"


def load_fixture(scenario: str, rel_path: str) -> dict:
    return json.loads((FIXTURES / scenario / rel_path).read_text())


# ---------------------------------------------------------------------------
# Mock HTTP server — zachycuje POST /agent
# ---------------------------------------------------------------------------

class CapturingHandler(BaseHTTPRequestHandler):
    received: list = []

    def do_POST(self):
        length = int(self.headers["Content-Length"])
        body = self.rfile.read(length)
        self.__class__.received.append(json.loads(body))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_):
        pass


@pytest.fixture
def mock_server(monkeypatch):
    """Spustí lokální HTTP server, přesměruje SERVER_URL v state_report na něj."""
    CapturingHandler.received = []
    srv = HTTPServer(("127.0.0.1", 0), CapturingHandler)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    monkeypatch.setattr(state_report, "SERVER_URL", f"http://127.0.0.1:{port}/agent")
    yield CapturingHandler
    srv.shutdown()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_stdin(fixture: dict) -> io.StringIO:
    """Vytvoří StringIO simulující stdin hooku z fixture dat."""
    hook_event = {
        "hook_event_name": fixture["hook_event"],
        "session_id": fixture["session_id"],
        "tool_name": fixture.get("tool_name", ""),
    }
    return io.StringIO(json.dumps(hook_event))


def invoke_hook(monkeypatch, fixture: dict, tmp_path: Path):
    """Zavolá state_report.main() s fixture daty.

    - Vytvoří dočasný projekt s .git adresářem (basename z fixture project_root).
    - Mockuje find_claude_pid, get_tty, get_window_id_for_pid, get_terminal_type,
      set_terminal_title, aby testy nepotřebovaly /proc ani wmctrl.
    """
    import sys as _sys

    # Simulovaný projekt s .git
    project_name = Path(fixture["project_root"]).name
    proj_dir = tmp_path / project_name
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / ".git").mkdir(exist_ok=True)

    monkeypatch.setattr(_sys, "stdin", _make_stdin(fixture))
    monkeypatch.chdir(proj_dir)

    # Isolace od systémových závislostí
    monkeypatch.setattr(state_report, "find_claude_pid", lambda: 99999)
    monkeypatch.setattr(state_report, "get_tty", lambda pid: fixture["tty"])
    monkeypatch.setattr(state_report, "get_window_id_for_pid", lambda pid, **kw: fixture["window_id"])
    monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: fixture["terminal_type"])
    monkeypatch.setattr(state_report, "set_terminal_title", lambda pid, title: None)

    state_report.main()


# ---------------------------------------------------------------------------
# SC1 — dva IDEA agenti se stejným názvem projektu
# ---------------------------------------------------------------------------

def test_sc1_agent_a_project_root(mock_server, monkeypatch, tmp_path):
    """SC1 agent-a: project_root basename musí odpovídat fixture (proj1)."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)

    assert len(mock_server.received) == 1
    actual = mock_server.received[0]
    assert Path(actual["project_root"]).name == Path(fx["project_root"]).name


def test_sc1_agent_b_project_root(mock_server, monkeypatch, tmp_path):
    """SC1 agent-b: project_root basename musí odpovídat fixture (proj1 ve subfolder)."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-b.json")
    invoke_hook(monkeypatch, fx, tmp_path)

    assert len(mock_server.received) == 1
    actual = mock_server.received[0]
    assert Path(actual["project_root"]).name == Path(fx["project_root"]).name


def test_sc1_agent_a_terminal_type(mock_server, monkeypatch, tmp_path):
    """SC1 agent-a: terminal_type == idea."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    assert mock_server.received[0]["terminal_type"] == "idea"


def test_sc1_agent_b_terminal_type(mock_server, monkeypatch, tmp_path):
    """SC1 agent-b: terminal_type == idea."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-b.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    assert mock_server.received[0]["terminal_type"] == "idea"


# ---------------------------------------------------------------------------
# SC2 — IDEA + Ghostty
# ---------------------------------------------------------------------------

def test_sc2_idea_terminal_type(mock_server, monkeypatch, tmp_path):
    """SC2 agent-a: terminal_type == idea."""
    fx = load_fixture("sc2-idea-and-ghostty", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    assert mock_server.received[0]["terminal_type"] == "idea"


def test_sc2_ghostty_terminal_type(mock_server, monkeypatch, tmp_path):
    """SC2 agent-b: terminal_type == ghostty."""
    fx = load_fixture("sc2-idea-and-ghostty", "hook-payloads/agent-b.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    assert mock_server.received[0]["terminal_type"] == "ghostty"


# ---------------------------------------------------------------------------
# Formátové testy — tab_name, tty
# ---------------------------------------------------------------------------

def test_tab_name_format(mock_server, monkeypatch, tmp_path):
    """tab_name musí být ve formátu cc-XXXXXXXX (8 hex znaků)."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    tab = mock_server.received[0]["tab_name"]
    assert re.match(r"^cc-[0-9a-f]{8}$", tab), f"tab_name neodpovídá formátu: {tab!r}"


def test_tty_format(mock_server, monkeypatch, tmp_path):
    """tty musí začínat /dev/pts/ (hodnota z fixture)."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    tty = mock_server.received[0]["tty"]
    assert tty.startswith("/dev/pts/"), f"tty neodpovídá formátu: {tty!r}"


# ---------------------------------------------------------------------------
# Kontraktní test — povinná pole
# ---------------------------------------------------------------------------

def test_payload_required_fields(mock_server, monkeypatch, tmp_path):
    """Payload musí obsahovat všechna povinná pole (SessionStart → plný payload)."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    actual = mock_server.received[0]
    required = {
        "pid", "session_id", "state", "hook_event", "tool_name",
        "cwd", "project_root", "tty", "window_id", "tab_name", "terminal_type",
    }
    missing = required - set(actual.keys())
    assert not missing, f"Chybí pole: {missing}"


# ---------------------------------------------------------------------------
# State mapping
# ---------------------------------------------------------------------------

def test_session_start_maps_to_initialized(mock_server, monkeypatch, tmp_path):
    """SessionStart → state == initialized."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    assert fx["hook_event"] == "SessionStart"
    invoke_hook(monkeypatch, fx, tmp_path)
    assert mock_server.received[0]["state"] == "initialized"


def test_hook_sends_exactly_one_post(mock_server, monkeypatch, tmp_path):
    """main() odešle právě jeden POST na /agent."""
    fx = load_fixture("sc1-idea-same-name", "hook-payloads/agent-a.json")
    invoke_hook(monkeypatch, fx, tmp_path)
    assert len(mock_server.received) == 1
