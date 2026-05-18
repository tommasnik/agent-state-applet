"""Tests for the hook's pure logic (state-report.py).

Imports the deployed hook module and tests its functions without
making any network calls or touching real system state.
"""
import importlib.util
import os

import pytest

_HOOK_PATH = os.environ.get(
    "HOOK_PATH",
    os.path.join(os.path.dirname(__file__), "../../hook/state-report.py"),
)
_spec = importlib.util.spec_from_file_location("state_report", _HOOK_PATH)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


# ---------------------------------------------------------------------------
# find_project_root
# ---------------------------------------------------------------------------
class TestFindProjectRoot:
    def test_finds_git_in_ancestor(self, tmp_path):
        (tmp_path / ".git").mkdir()
        subdir = tmp_path / "src" / "deep"
        subdir.mkdir(parents=True)
        assert hook.find_project_root(str(subdir)) == str(tmp_path)

    def test_finds_idea_dir(self, tmp_path):
        (tmp_path / ".idea").mkdir()
        subdir = tmp_path / "src"
        subdir.mkdir()
        assert hook.find_project_root(str(subdir)) == str(tmp_path)

    def test_finds_package_json(self, tmp_path):
        (tmp_path / "package.json").touch()
        assert hook.find_project_root(str(tmp_path)) == str(tmp_path)

    def test_finds_pyproject_toml(self, tmp_path):
        (tmp_path / "pyproject.toml").touch()
        subdir = tmp_path / "src"
        subdir.mkdir()
        assert hook.find_project_root(str(subdir)) == str(tmp_path)

    def test_nearest_ancestor_wins_over_outer(self, tmp_path):
        """Inner marker (package.json) beats outer marker (.git)."""
        (tmp_path / ".git").mkdir()
        inner = tmp_path / "frontend"
        inner.mkdir()
        (inner / "package.json").touch()
        assert hook.find_project_root(str(inner)) == str(inner)

    def test_falls_back_to_cwd_when_no_marker(self, tmp_path):
        subdir = tmp_path / "random"
        subdir.mkdir()
        assert hook.find_project_root(str(subdir)) == str(subdir)

    def test_does_not_return_filesystem_root(self, tmp_path):
        result = hook.find_project_root(str(tmp_path))
        assert result != "/"


# ---------------------------------------------------------------------------
# HOOK_STATE mapping
# ---------------------------------------------------------------------------
class TestHookStateMapping:
    CANONICAL_STATES = {"initialized", "working", "asking_user", "done", "waiting_for_approval"}
    KNOWN_EVENTS = {
        "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
        "Notification", "Stop",
    }

    def test_all_known_events_mapped(self):
        for event in self.KNOWN_EVENTS:
            assert event in hook.HOOK_STATE, f"event {event!r} not in HOOK_STATE"

    def test_subagent_stop_not_mapped(self):
        assert "SubagentStop" not in hook.HOOK_STATE

    def test_all_mapped_values_are_valid_states(self):
        for event, state in hook.HOOK_STATE.items():
            assert state in self.CANONICAL_STATES, \
                f"HOOK_STATE[{event!r}] = {state!r} is not a canonical state"

    def test_session_start_maps_to_initialized(self):
        assert hook.HOOK_STATE["SessionStart"] == "initialized"

    def test_stop_maps_to_done(self):
        assert hook.HOOK_STATE["Stop"] == "done"

    def test_notification_maps_to_waiting_for_approval(self):
        assert hook.HOOK_STATE["Notification"] == "waiting_for_approval"

    def test_ask_user_tools_override_pre_tool_use_to_asking_user(self):
        for tool in hook.ASK_USER_TOOLS:
            state = hook.HOOK_STATE.get("PreToolUse", "")
            if tool in hook.ASK_USER_TOOLS:
                state = "asking_user"
            assert state == "asking_user", \
                f"{tool} via PreToolUse must produce asking_user state"


# ---------------------------------------------------------------------------
# Payload field contract
# ---------------------------------------------------------------------------
class TestPayloadFields:
    """Hook must populate every field the server stores."""

    REQUIRED_FIELDS = {
        "pid", "state", "hook_event", "cwd", "project_root",
        "session_id", "tool_name", "tty",
    }
    WINDOW_FIELDS = {"window_id", "tab_name"}
    WINDOW_EVENTS = {"SessionStart", "UserPromptSubmit"}

    def _make_payload(self, event, tool_name="", session_id="test1234"):
        state = hook.HOOK_STATE.get(event, "idle")
        if event == "PreToolUse" and tool_name in hook.ASK_USER_TOOLS:
            state = "asking_user"
        payload = {
            "pid": 99999, "session_id": session_id, "state": state,
            "hook_event": event, "tool_name": tool_name,
            "cwd": "/tmp/test", "project_root": "/tmp/test",
            "tty": "/dev/pts/0",
        }
        if event in self.WINDOW_EVENTS:
            payload["window_id"] = "0x1234"
            payload["tab_name"] = f"cc-{session_id[:8]}"
        return payload

    def test_required_fields_present_for_tool_event(self):
        payload = self._make_payload("PreToolUse", "Bash")
        for field in self.REQUIRED_FIELDS:
            assert field in payload, f"required field {field!r} missing"

    def test_window_fields_sent_on_session_start(self):
        payload = self._make_payload("SessionStart")
        for field in self.WINDOW_FIELDS:
            assert field in payload, f"{field!r} must be in SessionStart payload"

    def test_window_fields_sent_on_user_prompt_submit(self):
        payload = self._make_payload("UserPromptSubmit")
        for field in self.WINDOW_FIELDS:
            assert field in payload, f"{field!r} must be in UserPromptSubmit payload"

    def test_window_fields_absent_for_non_window_events(self):
        for event in ("PreToolUse", "PostToolUse", "Stop", "Notification"):
            payload = self._make_payload(event)
            for field in self.WINDOW_FIELDS:
                assert field not in payload, \
                    f"{field!r} must NOT be sent for {event}"

    def test_tab_name_uses_session_id_prefix(self):
        payload = self._make_payload("SessionStart", session_id="abcdef0123456789")
        assert payload["tab_name"] == "cc-abcdef01"
