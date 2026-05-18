"""HTTP API tests for claude_state_server.py.

Starts the real server on a test port (17855) and exercises every endpoint.
"""
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import claude_state_server as srv

TEST_PORT = 17855
BASE = f"http://127.0.0.1:{TEST_PORT}"


def _post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=3) as r:
            raw = r.read()
            return r.getcode(), (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else {})


@pytest.fixture(scope="module")
def server():
    tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    tmp.close()
    srv.STATE_FILE = tmp.name

    httpd = HTTPServer(("127.0.0.1", TEST_PORT), srv.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.05)
    yield httpd
    httpd.shutdown()
    try:
        os.unlink(tmp.name)
    except FileNotFoundError:
        pass


@pytest.fixture(autouse=True)
def clear_agents(server):
    with srv.agents_lock:
        srv.agents.clear()


# ---------------------------------------------------------------------------
# POST /agent
# ---------------------------------------------------------------------------
class TestAgentEndpoint:
    def test_valid_minimal_returns_ok(self):
        code, body = _post("/agent", {"pid": 1001, "state": "working"})
        assert code == 200
        assert body == {"ok": True}

    def test_missing_pid_returns_400(self):
        code, _ = _post("/agent", {"state": "working"})
        assert code == 400

    def test_non_numeric_pid_returns_400(self):
        code, _ = _post("/agent", {"pid": "abc", "state": "working"})
        assert code == 400

    def test_invalid_json_returns_400(self):
        req = urllib.request.Request(
            BASE + "/agent", data=b"not json",
            headers={"Content-Type": "application/json"},
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req, timeout=3)
        assert exc.value.code == 400

    def test_unknown_path_returns_404(self):
        code, _ = _get("/no-such-path")
        assert code == 404

    def test_all_fields_stored(self):
        _post("/agent", {
            "pid": 2001, "state": "working", "hook_event": "UserPromptSubmit",
            "cwd": "/tmp/proj", "project_root": "/tmp/proj",
            "session_id": "abc123def", "tool_name": "Bash",
            "window_id": "0xdeadbeef", "tab_name": "cc-abc123de",
            "tty": "/dev/pts/3", "subagent_count": 2,
        })
        with srv.agents_lock:
            a = dict(srv.agents.get("2001", {}))
        assert a, "agent 2001 not stored"
        assert a["project_root"] == "/tmp/proj"
        assert a["window_id"] == "0xdeadbeef"
        assert a["tty"] == "/dev/pts/3"
        assert a["subagent_count"] == 2
        assert a["session_id"] == "abc123def"

    def test_started_at_preserved_on_update(self):
        _post("/agent", {"pid": 2002, "state": "initialized"})
        with srv.agents_lock:
            t1 = srv.agents["2002"]["started_at"]
        time.sleep(0.02)
        _post("/agent", {"pid": 2002, "state": "working"})
        with srv.agents_lock:
            t2 = srv.agents["2002"]["started_at"]
        assert t1 == t2, "started_at must not change after first write"

    def test_window_id_preserved_when_absent_in_update(self):
        _post("/agent", {"pid": 2003, "state": "initialized", "window_id": "0xabcd"})
        _post("/agent", {"pid": 2003, "state": "working"})  # no window_id
        with srv.agents_lock:
            assert srv.agents["2003"]["window_id"] == "0xabcd"

    def test_session_end_removes_agent(self):
        _post("/agent", {"pid": 2004, "state": "working"})
        _post("/agent", {"pid": 2004, "state": "session_end"})
        with srv.agents_lock:
            assert "2004" not in srv.agents

    def test_new_session_on_same_tty_evicts_done_agent(self):
        _post("/agent", {"pid": 2010, "state": "done", "tty": "/dev/pts/9"})
        _post("/agent", {
            "pid": 2011, "state": "initialized",
            "hook_event": "SessionStart", "tty": "/dev/pts/9",
        })
        with srv.agents_lock:
            assert "2010" not in srv.agents, "done agent on same tty must be evicted"
            assert "2011" in srv.agents

    def test_new_session_does_not_evict_working_agent_on_same_tty(self):
        _post("/agent", {"pid": 2012, "state": "working", "tty": "/dev/pts/8"})
        _post("/agent", {
            "pid": 2013, "state": "initialized",
            "hook_event": "SessionStart", "tty": "/dev/pts/8",
        })
        with srv.agents_lock:
            assert "2012" in srv.agents, "working agent must survive /clear on same tty"

    def test_clear_same_pid_preserves_window_id_when_new_session_sends_empty(self):
        # First session establishes a working window_id
        _post("/agent", {
            "pid": 2020, "state": "initialized", "hook_event": "SessionStart",
            "window_id": "0xdeadbeef", "tab_name": "cc-aaaaaaaa",
            "tty": "/dev/pts/20", "session_id": "session-a",
            "project_root": "/home/user/code/myproject",
        })
        # /clear: Stop fires — same PID, state becomes done
        _post("/agent", {"pid": 2020, "state": "done", "hook_event": "Stop", "tty": "/dev/pts/20"})
        # SessionStart of new session — hook's get_window_id_for_pid transiently returns ""
        _post("/agent", {
            "pid": 2020, "state": "initialized", "hook_event": "SessionStart",
            "window_id": "",           # get_window_id_for_pid failed
            "tab_name": "cc-bbbbbbbb",
            "tty": "/dev/pts/20", "session_id": "session-b",
            "project_root": "/home/user/code/myproject",
        })
        with srv.agents_lock:
            a = srv.agents.get("2020", {})
        assert a, "agent must still exist after /clear"
        assert a["window_id"] == "0xdeadbeef", "window_id must survive when new SessionStart sends empty string"
        assert a["tab_name"] == "cc-bbbbbbbb", "tab_name must be updated to new session value"
        assert a["session_id"] == "session-b", "session_id must reflect new session"

    def test_clear_same_pid_updates_window_id_when_hook_provides_new_value(self):
        # First session
        _post("/agent", {
            "pid": 2021, "state": "initialized", "hook_event": "SessionStart",
            "window_id": "0x00001111", "tab_name": "cc-aaaaaaaa",
            "tty": "/dev/pts/21", "session_id": "session-a",
        })
        _post("/agent", {"pid": 2021, "state": "done", "hook_event": "Stop"})
        # New session — hook successfully returns a new window_id
        _post("/agent", {
            "pid": 2021, "state": "initialized", "hook_event": "SessionStart",
            "window_id": "0x00002222",  # hook returned a valid (possibly same) window
            "tab_name": "cc-bbbbbbbb",
            "tty": "/dev/pts/21", "session_id": "session-b",
        })
        with srv.agents_lock:
            a = srv.agents.get("2021", {})
        assert a["window_id"] == "0x00002222", "window_id must be updated when hook provides a non-empty value"

    def test_clear_different_pid_old_agent_evicted_new_has_window_id(self):
        # Old session on same TTY with a window_id
        _post("/agent", {
            "pid": 2022, "state": "done", "hook_event": "Stop",
            "window_id": "0xdeadbeef", "tty": "/dev/pts/22", "session_id": "session-a",
        })
        # New session, new PID (Claude re-spawned)
        _post("/agent", {
            "pid": 2023, "state": "initialized", "hook_event": "SessionStart",
            "window_id": "0xdeadbeef", "tab_name": "cc-cccccccc",
            "tty": "/dev/pts/22", "session_id": "session-b",
        })
        with srv.agents_lock:
            assert "2022" not in srv.agents, "old done agent on same tty must be evicted on new PID"
            a = srv.agents.get("2023", {})
        assert a["window_id"] == "0xdeadbeef"


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------
class TestStatusEndpoint:
    def test_returns_agents_and_timestamp(self):
        _post("/agent", {"pid": 3001, "state": "working", "cwd": "/tmp/x"})
        code, body = _get("/status")
        assert code == 200
        assert "agents" in body and "updated_at" in body
        assert "3001" in body["agents"]

    def test_empty_agents_when_none_registered(self):
        code, body = _get("/status")
        assert code == 200
        assert body["agents"] == {}


# ---------------------------------------------------------------------------
# POST /focus
# ---------------------------------------------------------------------------
class TestFocusEndpoint:
    def test_unknown_pid_returns_404(self):
        code, _ = _post("/focus", {"pid": 99999})
        assert code == 404

    def test_missing_pid_returns_400(self):
        code, _ = _post("/focus", {})
        assert code == 400

    def test_non_numeric_pid_returns_400(self):
        code, _ = _post("/focus", {"pid": "xyz"})
        assert code == 400

    def test_known_pid_returns_200(self):
        _post("/agent", {"pid": 4001, "state": "working"})
        code, body = _post("/focus", {"pid": 4001})
        assert code == 200
        assert body.get("ok") is True
        assert "window_id" in body
