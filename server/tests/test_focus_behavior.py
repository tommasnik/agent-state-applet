"""RED/GREEN tests for the single-agent focus feature.

Scenario: user clicks the project label in the applet when there is exactly
one agent in that group.  The applet calls POST /focus {pid: <that agent's pid>}.
We verify that the server correctly calls wmctrl to raise the right window.

These tests mock subprocess so they work without a real X11/wmctrl.
"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest.mock as mock
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import claude_state_server as srv

TEST_PORT = 17858
BASE = f"http://127.0.0.1:{TEST_PORT}"

WMCTRL_ONE_WINDOW = (
    "0x00200001  0 myhost  idea-project – Main.kt\n"
)
WMCTRL_MULTI = (
    "0x00200001  0 myhost  idea-project – Main.kt\n"
    "0x00200002  0 myhost  other-project – README.md\n"
    "0x00200003  0 myhost  another-app\n"
)


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
# Helpers
# ---------------------------------------------------------------------------

def _wmctrl_popen_args(mock_popen):
    """Return the args list passed to the wmctrl -i -a Popen call, or None."""
    for call in mock_popen.call_args_list:
        args = call[0][0] if call[0] else call[1].get("args", [])
        if "-a" in args:
            return args
    return None


# ---------------------------------------------------------------------------
# Single-agent focus — primary user story
# ---------------------------------------------------------------------------

class TestSingleAgentFocusWithWindowId:
    """Agent has a stored window_id — simplest case."""

    def test_wmctrl_focus_called(self, server):
        """Clicking focus on a single agent must invoke wmctrl -i -a."""
        _post("/agent", {
            "pid": 7001, "state": "working",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout="", returncode=0)
            code, _ = _post("/focus", {"pid": 7001})

        assert code == 200
        args = _wmctrl_popen_args(popen_mock)
        assert args is not None, "wmctrl -i -a must be called"

    def test_correct_window_id_passed_to_wmctrl(self, server):
        """The exact stored window_id must be forwarded to wmctrl."""
        _post("/agent", {
            "pid": 7002, "state": "working",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout="", returncode=0)
            _post("/focus", {"pid": 7002})

        args = _wmctrl_popen_args(popen_mock)
        assert args == ["wmctrl", "-i", "-a", "0x00200001"], \
            f"Expected wmctrl -i -a 0x00200001, got {args}"

    def test_focus_works_for_done_agent(self, server):
        """Focus must work even when the agent state is 'done'."""
        _post("/agent", {
            "pid": 7003, "state": "done",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout="", returncode=0)
            code, _ = _post("/focus", {"pid": 7003})

        assert code == 200
        args = _wmctrl_popen_args(popen_mock)
        assert args is not None, "focus must be attempted even for a done agent"

    def test_focus_works_for_waiting_for_approval_agent(self, server):
        """Focus must work when the agent is waiting_for_approval."""
        _post("/agent", {
            "pid": 7004, "state": "waiting_for_approval",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout="", returncode=0)
            code, _ = _post("/focus", {"pid": 7004})

        assert code == 200
        args = _wmctrl_popen_args(popen_mock)
        assert args is not None


class TestSingleAgentFocusViaProjectRoot:
    """Agent has no window_id — must fall back to project_root name match."""

    def test_project_name_matched_against_wmctrl_output(self, server):
        """With no window_id, the IDEA window is found by project_root name."""
        _post("/agent", {
            "pid": 7010, "state": "working",
            "window_id": "", "project_root": "/home/user/idea-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=WMCTRL_ONE_WINDOW, returncode=0)
            code, _ = _post("/focus", {"pid": 7010})

        assert code == 200
        args = _wmctrl_popen_args(popen_mock)
        assert args is not None, "wmctrl must be called when project name matches"
        assert "0x00200001" in args, \
            f"The matched window xid must be used, got {args}"

    def test_no_focus_when_no_window_id_and_no_project_match(self, server):
        """When neither window_id nor project name matches, wmctrl must NOT be called."""
        _post("/agent", {
            "pid": 7011, "state": "working",
            "window_id": "", "project_root": "/home/user/no-such-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            code, _ = _post("/focus", {"pid": 7011})

        assert code == 200
        args = _wmctrl_popen_args(popen_mock)
        assert args is None, "wmctrl -i -a must NOT be called when window cannot be found"

    def test_project_name_title_with_space_en_dash_matched(self, server):
        """IDEA title 'project – file.ext' (space + en-dash) must match."""
        _post("/agent", {
            "pid": 7012, "state": "working",
            "window_id": "", "project_root": "/home/user/myproject",
        })
        wmctrl_out = "0x00200005  0 myhost  myproject – SomeFile.java\n"
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=wmctrl_out, returncode=0)
            _post("/focus", {"pid": 7012})

        args = _wmctrl_popen_args(popen_mock)
        assert args is not None and "0x00200005" in args, \
            f"en-dash title must match, got {args}"

    def test_project_name_exact_match(self, server):
        """A window whose title IS exactly the project name must match."""
        _post("/agent", {
            "pid": 7013, "state": "working",
            "window_id": "", "project_root": "/home/user/clean-project",
        })
        wmctrl_out = "0x00200006  0 myhost  clean-project\n"
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=wmctrl_out, returncode=0)
            _post("/focus", {"pid": 7013})

        args = _wmctrl_popen_args(popen_mock)
        assert args is not None and "0x00200006" in args


class TestFocusFallback:
    """Stored window_id + project_root — what wins?"""

    def test_project_name_overrides_stored_window_id_when_match_found(self, server):
        """If project name matches a window, its xid is used (not the stored window_id)."""
        _post("/agent", {
            "pid": 7020, "state": "working",
            "window_id": "0x00200099",  # stale / different xid
            "project_root": "/home/user/idea-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            _post("/focus", {"pid": 7020})

        args = _wmctrl_popen_args(popen_mock)
        assert args is not None
        assert "0x00200001" in args, \
            f"Project name match (0x00200001) must override stored id 0x00200099, got {args}"

    def test_stored_window_id_used_as_fallback_when_no_project_match(self, server):
        """If project name doesn't match any window, fall back to stored window_id."""
        _post("/agent", {
            "pid": 7021, "state": "working",
            "window_id": "0x00200099",
            "project_root": "/home/user/no-match-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            _post("/focus", {"pid": 7021})

        args = _wmctrl_popen_args(popen_mock)
        assert args is not None
        assert "0x00200099" in args, \
            f"Stored window_id must be used as fallback, got {args}"


class TestDesktopSwitch:
    """Server must switch to the correct desktop before focusing."""

    def test_wmctrl_switch_desktop_called_before_focus(self, server):
        """wmctrl -s <desktop> must be called before wmctrl -i -a."""
        _post("/agent", {
            "pid": 7030, "state": "working",
            "window_id": "0x00200001", "project_root": "",
        })
        # Window is on desktop 2
        wmctrl_out = "0x00200001  2 myhost  idea-project – Main.kt\n"
        call_order = []
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen") as popen_mock:
            run_mock.side_effect = lambda args, **kw: (
                call_order.append(("run", args)),
                mock.Mock(stdout=wmctrl_out, returncode=0)
            )[-1]
            popen_mock.side_effect = lambda args, **kw: (
                call_order.append(("popen", args)),
                mock.Mock()
            )[-1]
            _post("/focus", {"pid": 7030})

        switch_calls = [args for (kind, args) in call_order if kind == "run" and "-s" in args]
        focus_calls  = [args for (kind, args) in call_order if kind == "popen" and "-a" in args]

        assert switch_calls, "wmctrl -s must be called to switch desktop"
        assert "2" in switch_calls[0], f"Must switch to desktop 2, got {switch_calls[0]}"
        assert focus_calls, "wmctrl -i -a must be called after switching desktop"


# ---------------------------------------------------------------------------
# /focus must atomically reset done/waiting agents to initialized
# ---------------------------------------------------------------------------

class TestFocusResetsState:
    """Clicking a single-agent group should focus the window AND reset state in
    one atomic step.  The applet calls only POST /focus; the server is responsible
    for updating agent state so the applet dot turns grey immediately — no
    separate POST /agent race condition."""

    def test_focus_resets_done_to_initialized(self, server):
        """Focusing a done agent must change its state to 'initialized'."""
        _post("/agent", {
            "pid": 8001, "state": "done",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen"):
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            code, _ = _post("/focus", {"pid": 8001})

        assert code == 200
        with srv.agents_lock:
            state = srv.agents.get("8001", {}).get("state")
        assert state == "initialized", \
            f"State must be 'initialized' after focus, got '{state}'"

    def test_focus_resets_waiting_for_approval_to_initialized(self, server):
        """Focusing a waiting_for_approval agent must change its state to 'initialized'."""
        _post("/agent", {
            "pid": 8002, "state": "waiting_for_approval",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen"):
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            _post("/focus", {"pid": 8002})

        with srv.agents_lock:
            state = srv.agents.get("8002", {}).get("state")
        assert state == "initialized", \
            f"State must be 'initialized' after focus, got '{state}'"

    def test_focus_does_not_change_working_state(self, server):
        """Focusing a working agent must NOT change its state."""
        _post("/agent", {
            "pid": 8003, "state": "working",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen"):
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            _post("/focus", {"pid": 8003})

        with srv.agents_lock:
            state = srv.agents.get("8003", {}).get("state")
        assert state == "working", \
            f"Working state must be preserved after focus, got '{state}'"

    def test_focus_does_not_change_initialized_state(self, server):
        """Focusing an initialized agent must leave state unchanged."""
        _post("/agent", {
            "pid": 8004, "state": "initialized",
            "window_id": "0x00200001", "project_root": "",
        })
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen"):
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            _post("/focus", {"pid": 8004})

        with srv.agents_lock:
            state = srv.agents.get("8004", {}).get("state")
        assert state == "initialized", \
            f"Initialized state must be preserved after focus, got '{state}'"

    def test_second_click_still_focuses_after_state_already_initialized(self, server):
        """Sequence: done → focus (resets to initialized) → focus again.
        The second focus must still call wmctrl even though state is already initialized."""
        _post("/agent", {
            "pid": 8005, "state": "done",
            "window_id": "0x00200001", "project_root": "",
        })
        # First click: focus resets done → initialized
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen"):
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            _post("/focus", {"pid": 8005})

        # Second click: focus on now-initialized agent
        with mock.patch("subprocess.run") as m_run, mock.patch("subprocess.Popen") as m_pop:
            m_run.return_value = mock.Mock(stdout="", returncode=0)
            code, _ = _post("/focus", {"pid": 8005})

        assert code == 200
        args = _wmctrl_popen_args(m_pop)
        assert args is not None, \
            "wmctrl must be called on second focus after state reset to initialized"


# ---------------------------------------------------------------------------
# /focus must return the resolved window_id so the applet can flash correctly
# ---------------------------------------------------------------------------

class TestFocusResponseIncludesResolvedWindowId:
    """The /focus response must include the window_id that was actually used.

    The applet captures window_id from its local cache *before* the focus HTTP
    call.  When the server resolves a different (more current) window via
    project-name matching, the applet has no way to know unless the server
    sends it back in the response.  Without this, _flashWindow fires on the
    wrong window.
    """

    def test_response_includes_stored_window_id_when_no_project_match(self, server):
        """When no project-name match, the stored window_id must appear in the response."""
        _post("/agent", {
            "pid": 9001, "state": "working",
            "window_id": "0x00200099",
            "project_root": "/home/user/no-match-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen"):
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            code, body = _post("/focus", {"pid": 9001})

        assert code == 200
        assert body.get("window_id") == "0x00200099", \
            f"Response must echo stored window_id when no project match, got {body}"

    def test_response_includes_project_matched_window_id_when_match_found(self, server):
        """When project name matches a live window, that window's xid must be in the response."""
        _post("/agent", {
            "pid": 9002, "state": "working",
            "window_id": "0x00200099",  # stale
            "project_root": "/home/user/idea-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen"):
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            code, body = _post("/focus", {"pid": 9002})

        assert code == 200
        assert body.get("window_id") == "0x00200001", \
            f"Response must include project-matched window_id 0x00200001, got {body}"

    def test_resolved_window_id_persisted_in_agent_state(self, server):
        """After a project-name match, the resolved window_id must be saved in agents[pid].

        This ensures subsequent focus calls and state reads use the fresh window_id.
        """
        _post("/agent", {
            "pid": 9003, "state": "working",
            "window_id": "0x00200099",  # stale
            "project_root": "/home/user/idea-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen"):
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            _post("/focus", {"pid": 9003})

        with srv.agents_lock:
            saved_wid = srv.agents.get("9003", {}).get("window_id")
        assert saved_wid == "0x00200001", \
            f"Resolved window_id must be persisted in agents dict, got {saved_wid}"

    def test_response_window_id_empty_when_no_window_found(self, server):
        """When neither stored id nor project match yields a window, response window_id is empty."""
        _post("/agent", {
            "pid": 9004, "state": "working",
            "window_id": "",
            "project_root": "/home/user/no-match-project",
        })
        with mock.patch("subprocess.run") as run_mock, \
             mock.patch("subprocess.Popen"):
            run_mock.return_value = mock.Mock(stdout=WMCTRL_MULTI, returncode=0)
            code, body = _post("/focus", {"pid": 9004})

        assert code == 200
        assert body.get("window_id", "") == "", \
            f"Response window_id must be empty when no window found, got {body}"
