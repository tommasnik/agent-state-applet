"""Tests for SCHEDULE_ID env var → schedule_id payload field (TASK-21)."""
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

import state_report


# ---------------------------------------------------------------------------
# Mock HTTP server
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

def _invoke(monkeypatch, tmp_path, env_vars: dict | None = None):
    """Call state_report.main() with a minimal SessionStart hook input."""
    import sys as _sys

    proj_dir = tmp_path / "myproject"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / ".git").mkdir(exist_ok=True)

    hook_input = json.dumps({
        "hook_event_name": "SessionStart",
        "session_id": "abcdef1234567890",
        "tool_name": "",
    })
    monkeypatch.setattr(_sys, "stdin", io.StringIO(hook_input))
    monkeypatch.chdir(proj_dir)

    monkeypatch.setattr(state_report, "find_claude_pid", lambda: 99999)
    monkeypatch.setattr(state_report, "get_tty", lambda pid: "/dev/pts/5")
    monkeypatch.setattr(state_report, "get_window_id_for_pid", lambda pid, **kw: "0x1234")
    monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: "ghostty")
    monkeypatch.setattr(state_report, "set_terminal_title", lambda pid, title: None)
    monkeypatch.setattr(state_report, "find_parent_claude_session", lambda pid: None)

    # Apply env overrides
    if env_vars:
        for key, value in env_vars.items():
            monkeypatch.setenv(key, value)
    else:
        monkeypatch.delenv("SCHEDULE_ID", raising=False)

    state_report.main()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_schedule_id_present_when_env_set(mock_server, monkeypatch, tmp_path):
    """AC#1 + AC#3: schedule_id field present in payload when SCHEDULE_ID is set."""
    _invoke(monkeypatch, tmp_path, env_vars={"SCHEDULE_ID": "sched-abc-123"})
    payload = mock_server.received[0]
    assert "schedule_id" in payload


def test_schedule_id_absent_when_env_not_set(mock_server, monkeypatch, tmp_path):
    """AC#2 + AC#4: schedule_id field absent (not null) when SCHEDULE_ID is not set."""
    _invoke(monkeypatch, tmp_path, env_vars=None)
    payload = mock_server.received[0]
    assert "schedule_id" not in payload


def test_schedule_id_value_matches_env(mock_server, monkeypatch, tmp_path):
    """AC#5: schedule_id value matches the SCHEDULE_ID env var."""
    _invoke(monkeypatch, tmp_path, env_vars={"SCHEDULE_ID": "my-schedule-42"})
    payload = mock_server.received[0]
    assert payload["schedule_id"] == "my-schedule-42"
