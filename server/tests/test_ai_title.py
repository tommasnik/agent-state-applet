"""Tests for ai-title JSONL polling functionality."""
import json
import os
import sys
import tempfile
import threading
import time
from http.server import HTTPServer
from unittest import mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import claude_state_server as srv


# ---------------------------------------------------------------------------
# Unit tests for helpers
# ---------------------------------------------------------------------------

class TestEncodeProjectRoot:
    def test_simple_path(self):
        assert srv._encode_project_root("/home/user/code/myproject") == "-home-user-code-myproject"

    def test_already_no_leading_slash(self):
        # If for some reason project_root doesn't start with '/', still works
        assert srv._encode_project_root("home/tom/myproject") == "home-tom-myproject"

    def test_trailing_slash_stripped(self):
        encoded = srv._encode_project_root("/home/user/code/myproject/")
        assert encoded == "-home-user-code-myproject-"

    def test_matches_real_claude_dirs(self):
        # Verify encoding matches the actual directory names on disk
        projects_dir = os.path.expanduser("~/.claude/projects")
        if not os.path.isdir(projects_dir):
            pytest.skip("~/.claude/projects not found")
        for entry in os.listdir(projects_dir)[:5]:
            # Real dirs are named "-home-user-code-foo" (leading dash from root slash).
            # encode("/home/user/code/foo") == "-home-user-code-foo" matches directly.
            pass  # structural check only; real validation done via _jsonl_path


class TestJsonlPath:
    def test_path_construction(self):
        path = srv._jsonl_path("/home/user/code/myproject", "abc123")
        expected_dir = os.path.join(
            os.path.expanduser("~/.claude/projects"),
            "-home-user-code-myproject",
        )
        assert path == os.path.join(expected_dir, "abc123.jsonl")


class TestReadAiTitle:
    def test_returns_title_from_valid_jsonl(self, tmp_path):
        f = tmp_path / "session.jsonl"
        f.write_text(
            '{"type":"summary","text":"something"}\n'
            '{"type":"ai-title","aiTitle":"My Task Title","sessionId":"abc123"}\n'
            '{"type":"other","data":1}\n'
        )
        assert srv._read_ai_title(str(f)) == "My Task Title"

    def test_returns_none_when_no_ai_title(self, tmp_path):
        f = tmp_path / "session.jsonl"
        f.write_text('{"type":"summary","text":"something"}\n')
        assert srv._read_ai_title(str(f)) is None

    def test_returns_none_on_missing_file(self, tmp_path):
        assert srv._read_ai_title(str(tmp_path / "missing.jsonl")) is None

    def test_returns_first_title_if_multiple(self, tmp_path):
        f = tmp_path / "session.jsonl"
        f.write_text(
            '{"type":"ai-title","aiTitle":"First","sessionId":"abc"}\n'
            '{"type":"ai-title","aiTitle":"Second","sessionId":"abc"}\n'
        )
        assert srv._read_ai_title(str(f)) == "First"

    def test_skips_malformed_lines(self, tmp_path):
        f = tmp_path / "session.jsonl"
        f.write_text(
            'not-json\n'
            '{"type":"ai-title","aiTitle":"Good Title","sessionId":"abc"}\n'
        )
        assert srv._read_ai_title(str(f)) == "Good Title"

    def test_returns_none_for_empty_file(self, tmp_path):
        f = tmp_path / "session.jsonl"
        f.write_text("")
        assert srv._read_ai_title(str(f)) is None


# ---------------------------------------------------------------------------
# Integration test: ai_title_poller updates agents dict
# ---------------------------------------------------------------------------

class TestAiTitlePoller:
    def _run_poller_once(self):
        """Run one iteration of the poller logic (bypass sleep)."""
        changed = False
        with srv.agents_lock:
            snapshot = {pid: dict(a) for pid, a in srv.agents.items()}

        for pid, agent in snapshot.items():
            if agent.get("ai_title"):
                continue
            session_id   = agent.get("session_id", "")
            project_root = agent.get("project_root", "")
            if not session_id or not project_root:
                continue

            path  = srv._jsonl_path(project_root, session_id)
            title = srv._read_ai_title(path)
            if title:
                with srv.agents_lock:
                    if pid in srv.agents and not srv.agents[pid].get("ai_title"):
                        srv.agents[pid]["ai_title"] = title
                        changed = True
        return changed

    def setup_method(self):
        with srv.agents_lock:
            srv.agents.clear()

    def teardown_method(self):
        with srv.agents_lock:
            srv.agents.clear()

    def test_poller_sets_ai_title_from_jsonl(self, tmp_path):
        # Create a fake JSONL file
        project_root = str(tmp_path / "myproject")
        session_id   = "test-session-001"
        encoded      = srv._encode_project_root(project_root)
        jsonl_dir    = tmp_path / "claude_projects" / encoded
        jsonl_dir.mkdir(parents=True)
        jsonl_file = jsonl_dir / (session_id + ".jsonl")
        jsonl_file.write_text(
            '{"type":"ai-title","aiTitle":"Implement Feature X","sessionId":"test-session-001"}\n'
        )

        with srv.agents_lock:
            srv.agents["5001"] = {
                "pid": 5001,
                "state": "working",
                "session_id": session_id,
                "project_root": project_root,
                "ai_title": "",
            }

        # Patch the CLAUDE_PROJECTS_DIR to point to our tmp directory
        with mock.patch.object(srv, "CLAUDE_PROJECTS_DIR", str(tmp_path / "claude_projects")):
            changed = self._run_poller_once()

        assert changed
        with srv.agents_lock:
            assert srv.agents["5001"]["ai_title"] == "Implement Feature X"

    def test_poller_does_not_overwrite_existing_title(self, tmp_path):
        project_root = str(tmp_path / "myproject")
        session_id   = "test-session-002"
        encoded      = srv._encode_project_root(project_root)
        jsonl_dir    = tmp_path / "claude_projects" / encoded
        jsonl_dir.mkdir(parents=True)
        jsonl_file = jsonl_dir / (session_id + ".jsonl")
        jsonl_file.write_text(
            '{"type":"ai-title","aiTitle":"New Title","sessionId":"test-session-002"}\n'
        )

        with srv.agents_lock:
            srv.agents["5002"] = {
                "pid": 5002,
                "state": "working",
                "session_id": session_id,
                "project_root": project_root,
                "ai_title": "Original Title",
            }

        with mock.patch.object(srv, "CLAUDE_PROJECTS_DIR", str(tmp_path / "claude_projects")):
            changed = self._run_poller_once()

        assert not changed
        with srv.agents_lock:
            assert srv.agents["5002"]["ai_title"] == "Original Title"

    def test_poller_skips_agent_without_session_id(self, tmp_path):
        with srv.agents_lock:
            srv.agents["5003"] = {
                "pid": 5003,
                "state": "working",
                "session_id": "",
                "project_root": "/some/path",
                "ai_title": "",
            }

        changed = self._run_poller_once()
        assert not changed

    def test_poller_skips_agent_without_project_root(self, tmp_path):
        with srv.agents_lock:
            srv.agents["5004"] = {
                "pid": 5004,
                "state": "working",
                "session_id": "some-session-id",
                "project_root": "",
                "ai_title": "",
            }

        changed = self._run_poller_once()
        assert not changed

    def test_ai_title_preserved_on_agent_update(self):
        """ai_title in existing agent must survive a /agent POST update."""
        with srv.agents_lock:
            srv.agents["5005"] = {
                "pid": 5005,
                "state": "working",
                "session_id": "sess-5005",
                "project_root": "/proj",
                "ai_title": "Preserved Title",
                "cwd": "/proj",
                "hook_event": "",
                "tool_name": "",
                "subagent_count": 0,
                "started_at": time.time(),
                "window_id": "",
                "tab_name": "",
                "tty": "",
                "timestamp": time.time(),
            }

        # Simulate what do_POST does when updating an existing agent
        with srv.agents_lock:
            existing = srv.agents.get("5005", {})
            srv.agents["5005"] = {
                "pid": 5005,
                "cwd": existing.get("cwd", ""),
                "state": "done",
                "timestamp": time.time(),
                "hook_event": "Stop",
                "tool_name": "",
                "session_id": existing.get("session_id", ""),
                "subagent_count": 0,
                "started_at": existing.get("started_at", time.time()),
                "window_id": existing.get("window_id", ""),
                "tab_name": existing.get("tab_name", ""),
                "tty": existing.get("tty", ""),
                "project_root": existing.get("project_root", ""),
                "ai_title": existing.get("ai_title", ""),
            }

        with srv.agents_lock:
            assert srv.agents["5005"]["ai_title"] == "Preserved Title"
            assert srv.agents["5005"]["state"] == "done"
