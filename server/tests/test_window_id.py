"""
Tests for get_window_id_for_pid — the multi-IDEA-window bug.

Bug (2026-05-26): When IDEA has multiple project windows open, all share the
same PID in `wmctrl -l -p`.  The old code stored windows_by_pid[pid] = win_id
(single value per PID), so the LAST window in wmctrl output always won,
regardless of which project the Claude agent actually belongs to.

Symptom: clicking any IDEA agent dot in the panel focused the same wrong window
(whichever IDEA project appeared last in wmctrl output — here: side-bot-platform).

Fix: store a list of (win_id, title) per PID.  When an IDEA PID has multiple
windows, match window title against the project_root basename to pick the right one.
"""
import builtins
import io
import subprocess
from unittest.mock import MagicMock, patch

import pytest
import state_report

# ---------------------------------------------------------------------------
# Real-world wmctrl -l -p snapshot from 2026-05-26 live session.
# Five IDEA windows all share PID 5529.
# Last IDEA window in this output is 0x051dc506 (side-bot-platform) — that is
# the window that was wrongly returned for every IDEA agent.
# ---------------------------------------------------------------------------
WMCTRL_REAL_WORLD = (
    "0x03800004  1 3060   tom-lenovo major_incidents_solvers (Channel) - Slack\n"
    "0x04600004  0 4279   tom-lenovo Agent State - Google Chrome\n"
    "0x05000054  1 5529   tom-lenovo chat-window – ws-2-api.ts\n"
    "0x0500d6c2  1 5529   tom-lenovo bot-platform – ws-1.ts\n"
    "0x0511ba18  1 5529   tom-lenovo demo-pages – task-42 - GlobalUpgradeState.md\n"
    "0x05186517  1 5529   tom-lenovo agent-state-applet – task-12 - testy.md\n"
    "0x051dc506  1 5529   tom-lenovo side-bot-platform – environment-write-service.ts\n"
)

# IDEA JVM process that owns all windows
IDEA_PID = 5529

# Simulated process tree for the agent-state-applet Claude session:
#   Claude (235727) → bash (235720) → IDEA (5529)
CLAUDE_PID = 235727
BASH_PID = 235720
PARENT_PIDS = {CLAUDE_PID: BASH_PID, BASH_PID: IDEA_PID}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wmctrl_result(stdout: str) -> MagicMock:
    r = MagicMock()
    r.stdout = stdout
    return r


def _fake_open(proc_map: dict):
    """Return a drop-in for builtins.open that serves /proc/{pid}/status from proc_map."""
    real_open = builtins.open

    def _open(path, *args, **kwargs):
        for pid, ppid in proc_map.items():
            if str(path) == f"/proc/{pid}/status":
                return io.StringIO(f"Name: python\nPPid: {ppid}\n")
        return real_open(path, *args, **kwargs)

    return _open


@pytest.fixture
def multi_idea_env(monkeypatch):
    """
    Simulates the live environment: 5 IDEA windows sharing PID 5529,
    Claude process tree Claude→bash→IDEA.
    """
    monkeypatch.setattr(
        subprocess, "run",
        lambda cmd, **kw: _wmctrl_result(WMCTRL_REAL_WORLD) if "wmctrl" in cmd else (_ for _ in ()).throw(ValueError(cmd)),
    )
    monkeypatch.setattr(state_report, "_is_idea_pid", lambda pid: pid == IDEA_PID)
    monkeypatch.setattr(builtins, "open", _fake_open(PARENT_PIDS))


# ---------------------------------------------------------------------------
# Unit tests for _idea_project_name
# ---------------------------------------------------------------------------

class TestIdeaProjectName:
    """
    _idea_project_name reads .idea/.name and falls back to directory basename.
    Real-world inventory (~/work/code, 2026-05-26):
    - platform-side-quest/bot-platform: .idea/.name = 'side-bot-platform'  ← only custom name
    - all other ~30 projects: .idea dir present but no .name file → basename used
    """

    def test_no_idea_dir_returns_basename(self, tmp_path):
        proj = tmp_path / "my-project"
        proj.mkdir()
        assert state_report._idea_project_name(str(proj)) == "my-project"

    def test_idea_dir_without_name_file_returns_basename(self, tmp_path):
        proj = tmp_path / "my-project"
        (proj / ".idea").mkdir(parents=True)
        assert state_report._idea_project_name(str(proj)) == "my-project"

    def test_idea_name_file_returns_content(self, tmp_path):
        proj = tmp_path / "bot-platform"
        (proj / ".idea").mkdir(parents=True)
        (proj / ".idea" / ".name").write_text("side-bot-platform")
        assert state_report._idea_project_name(str(proj)) == "side-bot-platform"

    def test_idea_name_file_trailing_newline_stripped(self, tmp_path):
        proj = tmp_path / "bot-platform"
        (proj / ".idea").mkdir(parents=True)
        (proj / ".idea" / ".name").write_text("side-bot-platform\n")
        assert state_report._idea_project_name(str(proj)) == "side-bot-platform"

    def test_idea_name_file_empty_falls_back_to_basename(self, tmp_path):
        proj = tmp_path / "my-project"
        (proj / ".idea").mkdir(parents=True)
        (proj / ".idea" / ".name").write_text("")
        assert state_report._idea_project_name(str(proj)) == "my-project"

    def test_idea_name_file_whitespace_only_falls_back_to_basename(self, tmp_path):
        proj = tmp_path / "my-project"
        (proj / ".idea").mkdir(parents=True)
        (proj / ".idea" / ".name").write_text("   \n  ")
        assert state_report._idea_project_name(str(proj)) == "my-project"

    def test_trailing_slash_in_project_root_returns_correct_basename(self, tmp_path):
        proj = tmp_path / "my-project"
        proj.mkdir()
        assert state_report._idea_project_name(str(proj) + "/") == "my-project"

    def test_trailing_slash_with_name_file(self, tmp_path):
        proj = tmp_path / "bot-platform"
        (proj / ".idea").mkdir(parents=True)
        (proj / ".idea" / ".name").write_text("side-bot-platform")
        assert state_report._idea_project_name(str(proj) + "/") == "side-bot-platform"


# ---------------------------------------------------------------------------
# Level 1 — unit: documents the bug in get_window_id_for_pid
# ---------------------------------------------------------------------------

class TestBug:
    """Documents the buggy behavior before the fix."""

    def test_without_project_root_returns_last_idea_window(self, multi_idea_env):
        """
        Without project_root hint, old code returned the LAST IDEA window in
        wmctrl output (0x051dc506 = side-bot-platform) for every agent.
        After the fix this is still the fallback behavior (first window).
        The important thing: it used to be the LAST, now it is the FIRST.
        """
        result = state_report.get_window_id_for_pid(CLAUDE_PID)
        # After fix: returns FIRST IDEA window (0x05000054 = chat-window), not last.
        # This test captures the expected post-fix fallback behavior.
        assert result == "0x05000054", (
            f"Expected first IDEA window 0x05000054, got {result!r}. "
            "Before the fix, this returned 0x051dc506 (last in wmctrl output)."
        )


# ---------------------------------------------------------------------------
# Level 1 — unit: correct behavior with project_root
# ---------------------------------------------------------------------------

class TestWindowIdWithProjectRoot:
    """Verifies correct window selection when project_root is provided."""

    def test_agent_state_applet(self, multi_idea_env):
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/code/agent-state-applet"
        )
        assert result == "0x05186517", f"Expected agent-state-applet window, got {result!r}"

    def test_bot_platform(self, multi_idea_env):
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/work/code/bot-platform"
        )
        assert result == "0x0500d6c2", f"Expected bot-platform window, got {result!r}"

    def test_chat_window(self, multi_idea_env):
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/work/code/chat-window"
        )
        assert result == "0x05000054", f"Expected chat-window, got {result!r}"

    def test_side_bot_platform_with_idea_name_file(self, multi_idea_env, tmp_path):
        """
        Project at platform-side-quest/bot-platform has .idea/.name = 'side-bot-platform'.
        Must match window 0x051dc506, NOT 0x0500d6c2 (bot-platform directory basename).
        """
        proj = tmp_path / "bot-platform"
        proj.mkdir()
        (proj / ".idea").mkdir()
        (proj / ".idea" / ".name").write_text("side-bot-platform")

        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root=str(proj)
        )
        assert result == "0x051dc506", (
            f"Expected side-bot-platform window 0x051dc506, got {result!r}. "
            "Fix must read .idea/.name, not just directory basename."
        )

    def test_side_bot_platform_without_idea_name_uses_basename(self, multi_idea_env):
        """Without .idea/.name, basename 'bot-platform' is used → matches 0x0500d6c2."""
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/work/code/bot-platform"
        )
        assert result == "0x0500d6c2", f"Expected bot-platform window, got {result!r}"

    def test_unknown_project_falls_back_to_first_idea_window(self, multi_idea_env):
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/work/code/nonexistent-project"
        )
        assert result == "0x05000054", f"Expected first IDEA window as fallback, got {result!r}"

    def test_trailing_slash_in_project_root(self, multi_idea_env):
        result = state_report.get_window_id_for_pid(
            CLAUDE_PID, project_root="/home/tom/code/agent-state-applet/"
        )
        assert result == "0x05186517"


# ---------------------------------------------------------------------------
# Level 2 — integration: main() passes project_root to get_window_id_for_pid
# ---------------------------------------------------------------------------

class TestMainPassesProjectRoot:
    """
    Verifies that main() correctly passes project_root when calling
    get_window_id_for_pid so the right window is included in the POST payload.
    """

    def test_main_calls_get_window_id_with_project_root(self, monkeypatch, tmp_path):
        """main() must pass project_root= to get_window_id_for_pid on SessionStart."""
        import sys
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        received_calls = []

        def fake_get_window_id(pid, project_root=None):
            received_calls.append({"pid": pid, "project_root": project_root})
            return "0x05186517"

        # Minimal HTTP sink
        class Sink(BaseHTTPRequestHandler):
            payloads = []
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                self.__class__.payloads.append(json.loads(body))
                self.send_response(200); self.end_headers()
            def log_message(self, *_): pass

        Sink.payloads = []
        srv = HTTPServer(("127.0.0.1", 0), Sink)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        monkeypatch.setattr(state_report, "SERVER_URL", f"http://127.0.0.1:{srv.server_address[1]}/agent")

        # Fake project dir with .git
        proj = tmp_path / "agent-state-applet"
        proj.mkdir()
        (proj / ".git").mkdir()
        monkeypatch.chdir(proj)

        monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({
            "hook_event_name": "SessionStart",
            "session_id": "aabbccdd-1234-5678-abcd-aabbccddeeff",
            "tool_name": "",
        })))
        monkeypatch.setattr(state_report, "find_claude_pid", lambda: CLAUDE_PID)
        monkeypatch.setattr(state_report, "get_tty", lambda pid: "/dev/pts/0")
        monkeypatch.setattr(state_report, "get_window_id_for_pid", fake_get_window_id)
        monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: "idea")
        monkeypatch.setattr(state_report, "set_terminal_title", lambda pid, t: None)

        state_report.main()

        srv.shutdown()

        assert len(received_calls) == 1
        call = received_calls[0]
        assert call["project_root"] is not None, "project_root was not passed to get_window_id_for_pid"
        assert call["project_root"].endswith("agent-state-applet"), (
            f"project_root should end with 'agent-state-applet', got {call['project_root']!r}"
        )

    def test_main_payload_contains_correct_window_id(self, monkeypatch, tmp_path, multi_idea_env):
        """
        End-to-end: main() with real get_window_id_for_pid (multi_idea_env) must
        produce window_id pointing to the agent-state-applet window, not side-bot-platform.
        """
        import sys
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        class Sink(BaseHTTPRequestHandler):
            payloads = []
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                self.__class__.payloads.append(json.loads(body))
                self.send_response(200); self.end_headers()
            def log_message(self, *_): pass

        Sink.payloads = []
        srv = HTTPServer(("127.0.0.1", 0), Sink)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        monkeypatch.setattr(state_report, "SERVER_URL", f"http://127.0.0.1:{srv.server_address[1]}/agent")

        proj = tmp_path / "agent-state-applet"
        proj.mkdir()
        (proj / ".git").mkdir()
        monkeypatch.chdir(proj)

        monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({
            "hook_event_name": "SessionStart",
            "session_id": "aabbccdd-1234-5678-abcd-aabbccddeeff",
            "tool_name": "",
        })))
        monkeypatch.setattr(state_report, "find_claude_pid", lambda: CLAUDE_PID)
        monkeypatch.setattr(state_report, "get_tty", lambda pid: "/dev/pts/0")
        monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: "idea")
        monkeypatch.setattr(state_report, "set_terminal_title", lambda pid, t: None)

        state_report.main()

        srv.shutdown()

        assert Sink.payloads, "No POST received"
        payload = Sink.payloads[0]
        assert payload["window_id"] == "0x05186517", (
            f"Expected agent-state-applet window 0x05186517, got {payload['window_id']!r}. "
            "This is the regression test for the multi-IDEA-window bug."
        )
        assert payload["window_id"] != "0x051dc506", (
            "Got side-bot-platform window — bug is still present."
        )
