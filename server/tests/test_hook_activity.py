"""Tests for hook describe_activity() helper and new payload fields."""
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
import state_report


# ---------------------------------------------------------------------------
# describe_activity
# ---------------------------------------------------------------------------

class TestDescribeActivity:
    def test_bash_with_command(self):
        assert state_report.describe_activity("Bash", {"command": "git status"}) == "Bash: git status"

    def test_bash_truncates_long_command(self):
        long_cmd = "x" * 60
        result = state_report.describe_activity("Bash", {"command": long_cmd})
        assert result.startswith("Bash: ")
        assert len(result) <= len("Bash: ") + 50

    def test_bash_strips_newlines(self):
        result = state_report.describe_activity("Bash", {"command": "echo hello\necho world"})
        assert "\n" not in result

    def test_bash_no_command(self):
        assert state_report.describe_activity("Bash", {}) == "Bash"

    def test_edit_returns_basename(self):
        assert state_report.describe_activity("Edit", {"file_path": "/home/tom/src/foo.ts"}) == "Edit: foo.ts"

    def test_edit_no_file_path(self):
        assert state_report.describe_activity("Edit", {}) == "Edit"

    def test_write_returns_basename(self):
        assert state_report.describe_activity("Write", {"file_path": "/home/tom/src/bar.py"}) == "Write: bar.py"

    def test_read_returns_basename(self):
        assert state_report.describe_activity("Read", {"file_path": "/proj/README.md"}) == "Read: README.md"

    def test_agent_with_name(self):
        assert state_report.describe_activity("Agent", {"agent_name": "Explore"}) == "Agent: Explore"

    def test_agent_fallback_description(self):
        assert state_report.describe_activity("Agent", {"description": "Search files"}) == "Agent: Search files"

    def test_agent_no_name(self):
        assert state_report.describe_activity("Agent", {}) == "Agent"

    def test_todo_write(self):
        assert state_report.describe_activity("TodoWrite", {}) == "TodoWrite"

    def test_unknown_tool(self):
        assert state_report.describe_activity("WebSearch", {"query": "python docs"}) == "WebSearch"

    def test_none_tool_input(self):
        result = state_report.describe_activity("Bash", None)
        assert result == "Bash"


# ---------------------------------------------------------------------------
# Hook payload — new fields sent to server
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


def run_hook(hook_payload, monkeypatch, mock_server):
    monkeypatch.setattr("os.getcwd", lambda: "/home/tom/project")
    monkeypatch.setattr(state_report, "find_claude_pid", lambda: 9999)
    monkeypatch.setattr(state_report, "get_tty", lambda pid: "/dev/pts/5")
    monkeypatch.setattr(state_report, "find_project_root", lambda cwd: "/home/tom/project")
    monkeypatch.setattr(state_report, "get_window_id_for_pid", lambda *a, **kw: "0xABCD")
    monkeypatch.setattr(state_report, "get_terminal_type", lambda pid: "generic")
    monkeypatch.setattr(state_report, "set_terminal_title", lambda *a: None)
    stdin_data = json.dumps(hook_payload)
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin_data))
    state_report.main()
    return mock_server.received


def test_prompt_sent_on_user_prompt_submit(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "UserPromptSubmit",
        "session_id": "abc123",
        "prompt": "fix the auth bug",
    }, monkeypatch, mock_server)
    assert len(payloads) == 1
    assert payloads[0]["prompt"] == "fix the auth bug"


def test_prompt_truncated_to_500_chars(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "UserPromptSubmit",
        "session_id": "abc123",
        "prompt": "x" * 600,
    }, monkeypatch, mock_server)
    assert len(payloads[0]["prompt"]) == 500


def test_prompt_not_sent_on_other_events(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
    }, monkeypatch, mock_server)
    assert "prompt" not in payloads[0]


def test_activity_item_sent_on_pre_tool_use(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "Bash",
        "tool_input": {"command": "git diff"},
    }, monkeypatch, mock_server)
    assert payloads[0]["activity_item"] == "Bash: git diff"


def test_activity_item_not_sent_on_stop(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "Stop",
        "session_id": "abc123",
    }, monkeypatch, mock_server)
    assert "activity_item" not in payloads[0]


def test_todos_sent_on_pre_tool_use_todo_write(monkeypatch, mock_server):
    todos = [{"id": "1", "content": "Fix bug", "status": "pending", "priority": "high"}]
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "TodoWrite",
        "tool_input": {"todos": todos},
    }, monkeypatch, mock_server)
    assert payloads[0]["todos"] == todos


def test_todos_not_sent_for_non_todo_tool(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
    }, monkeypatch, mock_server)
    assert "todos" not in payloads[0]


def test_agent_id_and_type_sent_when_present(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
        "agent_id": "sub-abc",
        "agent_type": "Explore",
    }, monkeypatch, mock_server)
    assert payloads[0]["agent_id"] == "sub-abc"
    assert payloads[0]["agent_type"] == "Explore"


def test_agent_id_not_sent_when_absent(monkeypatch, mock_server):
    payloads = run_hook({
        "hook_event_name": "PreToolUse",
        "session_id": "abc123",
        "tool_name": "Bash",
        "tool_input": {"command": "ls"},
    }, monkeypatch, mock_server)
    assert "agent_id" not in payloads[0]
    assert "agent_type" not in payloads[0]
