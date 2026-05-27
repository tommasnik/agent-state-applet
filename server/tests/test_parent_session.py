"""Tests for parent claude session detection (find_parent_claude_session).

Covers:
- find_parent_claude_session() logic (proc tree walking)
- That parent_session_id lands in the POST payload when found
- That parent_session_id is absent when no parent claude found
"""
import builtins
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
import state_report


# ---------------------------------------------------------------------------
# /proc filesystem mocking helpers
# ---------------------------------------------------------------------------

def _make_proc_mock(status_map: dict, cmdline_map: dict, environ_map: dict):
    """Fake open() serving /proc/{pid}/{status,cmdline,environ} from dicts.

    status_map:  {pid: ppid}
    cmdline_map: {pid: bytes}   — bytes as /proc/.../cmdline (NUL-separated)
    environ_map: {pid: bytes}   — bytes as /proc/.../environ (NUL-separated)
    """
    real_open = builtins.open

    def _open(path, mode="r", *args, **kwargs):
        path_str = str(path)
        for pid, ppid in status_map.items():
            if path_str == f"/proc/{pid}/status":
                return io.StringIO(f"Name: node\nPPid: {ppid}\n")
        for pid, data in cmdline_map.items():
            if path_str == f"/proc/{pid}/cmdline":
                return io.BytesIO(data) if "b" in mode else io.StringIO(data.decode(errors="replace"))
        for pid, data in environ_map.items():
            if path_str == f"/proc/{pid}/environ":
                return io.BytesIO(data) if "b" in mode else io.StringIO(data.decode(errors="replace"))
        return real_open(path, mode, *args, **kwargs)

    return _open


def _cmdline(*parts: str) -> bytes:
    return b"\x00".join(p.encode() for p in parts) + b"\x00"


def _environ(**kwargs) -> bytes:
    return b"\x00".join(f"{k}={v}".encode() for k, v in kwargs.items()) + b"\x00"


# ---------------------------------------------------------------------------
# find_parent_claude_session unit tests
# ---------------------------------------------------------------------------

class TestFindParentClaudeSession:
    def test_returns_none_when_parent_is_not_claude(self, monkeypatch):
        """Přímý rodič je bash, ne claude → None."""
        mock = _make_proc_mock(
            status_map={100: 99},
            cmdline_map={99: _cmdline("/bin/bash")},
            environ_map={},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) is None

    def test_returns_session_id_when_direct_parent_is_claude(self, monkeypatch):
        """Přímý rodič je claude s CLAUDE_CODE_SESSION_ID → vrátí session_id."""
        mock = _make_proc_mock(
            status_map={100: 99},
            cmdline_map={99: _cmdline("node", "/home/tom/.local/share/claude/versions/2.1.152/claude")},
            environ_map={99: _environ(CLAUDE_CODE_SESSION_ID="parent-sess-abc", OTHER="x")},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) == "parent-sess-abc"

    def test_walks_through_shell_to_grandparent_claude(self, monkeypatch):
        """Přes mezivrstvu bash najde grandparent claude."""
        # claude_pid=100 → bash(99) → parent_claude(98)
        mock = _make_proc_mock(
            status_map={100: 99, 99: 98},
            cmdline_map={
                99: _cmdline("/bin/bash"),
                98: _cmdline("node", "/usr/local/bin/claude"),
            },
            environ_map={98: _environ(CLAUDE_CODE_SESSION_ID="grandparent-sess-xyz")},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) == "grandparent-sess-xyz"

    def test_returns_none_when_claude_parent_has_no_session_id(self, monkeypatch):
        """Parent je claude, ale v environu CLAUDE_CODE_SESSION_ID chybí → None."""
        mock = _make_proc_mock(
            status_map={100: 99},
            cmdline_map={99: _cmdline("node", "/usr/local/bin/claude")},
            environ_map={99: _environ(UNRELATED_VAR="value")},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) is None

    def test_returns_none_on_proc_read_error(self, monkeypatch):
        """Při OSError čtení /proc neháže výjimku, vrátí None."""
        def _bad_open(path, *args, **kwargs):
            raise OSError("Permission denied")
        monkeypatch.setattr(builtins, "open", _bad_open)
        assert state_report.find_parent_claude_session(100) is None

    def test_stops_at_pid_1(self, monkeypatch):
        """Nezacyklí se, zastaví se když PPid == 1."""
        mock = _make_proc_mock(
            status_map={100: 1},
            cmdline_map={1: _cmdline("systemd")},
            environ_map={},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) is None

    def test_stops_when_ppid_is_zero(self, monkeypatch):
        """Zastaví se když PPid == 0 (kernel thread)."""
        mock = _make_proc_mock(
            status_map={100: 0},
            cmdline_map={},
            environ_map={},
        )
        monkeypatch.setattr(builtins, "open", mock)
        assert state_report.find_parent_claude_session(100) is None


# ---------------------------------------------------------------------------
# Payload integration tests
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


def run_hook(hook_payload, monkeypatch, captured, *, parent_session_id=None):
    monkeypatch.setattr("os.getcwd", lambda: "/home/tom/project")
    monkeypatch.setattr(state_report, "find_claude_pid", lambda: 9999)
    monkeypatch.setattr(state_report, "get_tty", lambda pid: "/dev/pts/5")
    monkeypatch.setattr(state_report, "find_project_root", lambda cwd: "/home/tom/project")
    monkeypatch.setattr(state_report, "get_window_id_for_pid", lambda *a, **kw: "0xABCD")
    monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: "generic")
    monkeypatch.setattr(state_report, "set_terminal_title", lambda *a: None)
    monkeypatch.setattr(state_report, "find_parent_claude_session", lambda pid: parent_session_id)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(hook_payload)))
    state_report.main()
    return captured.received


def test_parent_session_id_included_in_payload_when_found(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "child-sess",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
    }, monkeypatch, mock_server, parent_session_id="parent-sess-abc")
    assert len(payloads) == 1
    assert payloads[0]["parent_session_id"] == "parent-sess-abc"


def test_parent_session_id_absent_when_not_found(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "child-sess",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
    }, monkeypatch, mock_server, parent_session_id=None)
    assert len(payloads) == 1
    assert "parent_session_id" not in payloads[0]


def test_parent_session_id_sent_on_session_start(monkeypatch, mock_server):
    """Detekce se provede i při SessionStart (první event subagenta)."""
    payloads = run_hook({
        "hook_event_name": "SessionStart",
        "session_id": "child-sess-new",
    }, monkeypatch, mock_server, parent_session_id="parent-sess-xyz")
    assert payloads[0]["parent_session_id"] == "parent-sess-xyz"
