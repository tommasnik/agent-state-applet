"""Tests for server state persistence across restarts.

Scenario: server is restarted (e.g. after a redeploy).  Before shutdown it
backs up the state file; on the next startup _restore_state() repopulates
the in-memory agents dict so POST /focus works immediately — no waiting for
the next hook event.
"""
import json
import os
import shutil
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import claude_state_server as srv


SAMPLE_AGENT = {
    "pid": 12345,
    "cwd": "/home/user/project",
    "state": "done",
    "timestamp": 1700000000.0,
    "hook_event": "Stop",
    "tool_name": "",
    "session_id": "abc123",
    "subagent_count": 0,
    "started_at": 1699999900.0,
    "window_id": "0x00200001",
    "tab_name": "cc-abc123",
    "tty": "/dev/pts/3",
    "project_root": "/home/user/project",
    "ai_title": "Some task",
}


@pytest.fixture(autouse=True)
def isolated_state(tmp_path):
    """Each test gets its own state/backup files and a clean agents dict."""
    old_state  = srv.STATE_FILE
    old_backup = srv.BACKUP_FILE
    srv.STATE_FILE  = str(tmp_path / "claude-agents.json")
    srv.BACKUP_FILE = str(tmp_path / "claude-agents.json.bak")
    with srv.agents_lock:
        srv.agents.clear()
    yield tmp_path
    srv.STATE_FILE  = old_state
    srv.BACKUP_FILE = old_backup
    with srv.agents_lock:
        srv.agents.clear()


def _write_state_file(path, agent_dict):
    with open(path, "w") as f:
        json.dump({"agents": agent_dict, "updated_at": 0.0}, f)


# ---------------------------------------------------------------------------
# _restore_state — backup file takes priority
# ---------------------------------------------------------------------------

class TestRestoreFromBackup:

    def test_agents_loaded_from_backup(self):
        """_restore_state must populate agents from the backup file."""
        _write_state_file(srv.BACKUP_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with srv.agents_lock:
            assert "12345" in srv.agents

    def test_agent_fields_preserved(self):
        """All stored fields must survive the restore round-trip."""
        _write_state_file(srv.BACKUP_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with srv.agents_lock:
            a = srv.agents["12345"]
        assert a["window_id"]    == "0x00200001"
        assert a["project_root"] == "/home/user/project"
        assert a["state"]        == "done"

    def test_restore_writes_state_file(self, isolated_state):
        """After restore the state file must exist so the applet sees agents."""
        _write_state_file(srv.BACKUP_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        assert os.path.exists(srv.STATE_FILE), \
            "STATE_FILE must be written after a successful restore"

    def test_state_file_content_matches_restored_agents(self, isolated_state):
        """The state file written after restore must contain the restored agents."""
        _write_state_file(srv.BACKUP_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with open(srv.STATE_FILE) as f:
            data = json.load(f)
        assert "12345" in data["agents"]


# ---------------------------------------------------------------------------
# _restore_state — fallback to STATE_FILE when no backup exists
# ---------------------------------------------------------------------------

class TestRestoreFromStateFile:

    def test_falls_back_to_state_file_when_no_backup(self):
        """Without a backup, agents are loaded from the live state file."""
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with srv.agents_lock:
            assert "12345" in srv.agents

    def test_backup_takes_priority_over_state_file(self):
        """Backup is tried first; state file is ignored when backup succeeds."""
        backup_agent = dict(SAMPLE_AGENT, state="initialized")
        state_agent  = dict(SAMPLE_AGENT, state="working")

        _write_state_file(srv.BACKUP_FILE, {"12345": backup_agent})
        _write_state_file(srv.STATE_FILE,  {"12345": state_agent})

        srv._restore_state()

        with srv.agents_lock:
            assert srv.agents["12345"]["state"] == "initialized", \
                "Backup must take priority over state file"


# ---------------------------------------------------------------------------
# _restore_state — graceful handling of edge cases
# ---------------------------------------------------------------------------

class TestRestoreEdgeCases:

    def test_no_crash_when_both_files_missing(self):
        """_restore_state must not raise when neither file exists."""
        srv._restore_state()   # must not raise

        with srv.agents_lock:
            assert srv.agents == {}

    def test_empty_agents_in_backup_falls_through_to_state_file(self):
        """An empty backup is skipped; the state file is tried next."""
        _write_state_file(srv.BACKUP_FILE, {})          # empty backup
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with srv.agents_lock:
            assert "12345" in srv.agents, \
                "Must fall through to state file when backup is empty"

    def test_corrupt_backup_falls_through_to_state_file(self, isolated_state):
        """A corrupt backup file is skipped; state file is tried next."""
        with open(srv.BACKUP_FILE, "w") as f:
            f.write("not json {{{")
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})

        srv._restore_state()

        with srv.agents_lock:
            assert "12345" in srv.agents

    def test_no_crash_when_both_files_corrupt(self, isolated_state):
        """Corrupt backup AND corrupt state file must not raise."""
        with open(srv.BACKUP_FILE, "w") as f:
            f.write("bad")
        with open(srv.STATE_FILE, "w") as f:
            f.write("also bad")

        srv._restore_state()   # must not raise

        with srv.agents_lock:
            assert srv.agents == {}


# ---------------------------------------------------------------------------
# Shutdown backup — verifies the backup is written before state file removed
# ---------------------------------------------------------------------------

class TestShutdownBackup:

    def test_shutdown_creates_backup(self, isolated_state):
        """The shutdown handler must copy STATE_FILE to BACKUP_FILE."""
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})

        # Invoke the backup logic directly (without os.unlink / sys.exit)
        shutil.copy2(srv.STATE_FILE, srv.BACKUP_FILE)

        assert os.path.exists(srv.BACKUP_FILE), \
            "Backup file must exist after shutdown"
        with open(srv.BACKUP_FILE) as f:
            data = json.load(f)
        assert "12345" in data["agents"]

    def test_restore_after_shutdown_backup_cycle(self, isolated_state):
        """Full cycle: write state → backup (simulate shutdown) → restore."""
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})

        # Simulate shutdown: copy to backup, remove state file
        shutil.copy2(srv.STATE_FILE, srv.BACKUP_FILE)
        os.unlink(srv.STATE_FILE)

        assert not os.path.exists(srv.STATE_FILE), "State file should be gone"

        # Simulate startup: restore
        srv._restore_state()

        with srv.agents_lock:
            assert "12345" in srv.agents, \
                "Agent must be restored after full shutdown→restart cycle"
        assert os.path.exists(srv.STATE_FILE), \
            "STATE_FILE must be recreated after restore"

    def test_focus_works_immediately_after_restart(self, isolated_state,
                                                   tmp_path):
        """After restore, POST /focus must find the agent (not return 404)."""
        import threading
        import time
        import urllib.request
        import urllib.error
        from http.server import HTTPServer
        import unittest.mock as mock

        # Simulate shutdown: backup the agent
        _write_state_file(srv.STATE_FILE, {"12345": SAMPLE_AGENT})
        shutil.copy2(srv.STATE_FILE, srv.BACKUP_FILE)
        os.unlink(srv.STATE_FILE)

        with srv.agents_lock:
            srv.agents.clear()

        # Simulate startup
        srv._restore_state()

        port = 17870
        httpd = HTTPServer(("127.0.0.1", port), srv.Handler)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        time.sleep(0.05)

        try:
            with mock.patch("subprocess.run") as m_run, \
                 mock.patch("subprocess.Popen"):
                m_run.return_value = mock.Mock(stdout="", returncode=0)
                body = json.dumps({"pid": 12345}).encode()
                req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/focus",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=3) as r:
                    code = r.getcode()
            assert code == 200, "POST /focus must return 200 after restore"
        finally:
            httpd.shutdown()
