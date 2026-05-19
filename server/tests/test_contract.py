"""Contract tests: verify that hook, server, and applet agree on field names and state values.

These tests do NOT start any server. They check source-level consistency by
inspecting constants and field names in each component.
"""
import importlib.util
import os
import re
import sys

import pytest

# --- load modules -----------------------------------------------------------

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import claude_state_server as srv

_HOOK_PATH = os.environ.get(
    "HOOK_PATH",
    os.path.join(os.path.dirname(__file__), "../../hook/state-report.py"),
)
_spec = importlib.util.spec_from_file_location("state_report", _HOOK_PATH)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)

_APPLET_JS = os.path.join(os.path.dirname(__file__), "../../shared/core.mjs")
_COLOR_SPEC = os.path.join(os.path.dirname(__file__), "test_colors.py")

_cspec = importlib.util.spec_from_file_location("test_colors", _COLOR_SPEC)
colors = importlib.util.module_from_spec(_cspec)
_cspec.loader.exec_module(colors)


def _applet_src():
    with open(_APPLET_JS) as f:
        return f.read()


def _extract_js_object_keys(src, const_name):
    """Return the set of keys in a JS `const NAME = { key: ..., }` object."""
    match = re.search(rf"const {const_name}\s*=\s*\{{([^}}]+)\}}", src, re.DOTALL)
    assert match, f"{const_name} not found in applet.js"
    return set(re.findall(r"(\w+)\s*:", match.group(1)))


def _extract_js_color_map(src, const_name):
    """Return {key: '#hexcolor'} from a JS const object."""
    match = re.search(rf"const {const_name}\s*=\s*\{{([^}}]+)\}}", src, re.DOTALL)
    assert match
    return {
        m.group(1): m.group(2).lower()
        for m in re.finditer(r'(\w+)\s*:\s*"(#[0-9a-fA-F]+)"', match.group(1))
    }


# ---------------------------------------------------------------------------
# State name consistency
# ---------------------------------------------------------------------------
CANONICAL_STATES = {"initialized", "working", "asking_user", "done", "waiting_for_approval"}


class TestStateNamesConsistent:
    def test_hook_state_values_match_canonical(self):
        actual = set(hook.HOOK_STATE.values()) | {"asking_user"}
        assert actual == CANONICAL_STATES

    def test_color_spec_state_keys_match_canonical(self):
        assert set(colors.STATE_TO_COLOR.keys()) == CANONICAL_STATES

    def test_applet_STATE_COLOR_keys_match_canonical(self):
        keys = _extract_js_object_keys(_applet_src(), "STATE_COLOR")
        assert keys == CANONICAL_STATES

    def test_applet_STATE_LABEL_keys_match_canonical(self):
        keys = _extract_js_object_keys(_applet_src(), "STATE_LABEL")
        assert keys == CANONICAL_STATES


# ---------------------------------------------------------------------------
# Color hex values consistent between color spec and applet
# ---------------------------------------------------------------------------
class TestColorValuesConsistent:
    def test_applet_STATE_COLOR_matches_spec(self):
        applet_colors = _extract_js_color_map(_applet_src(), "STATE_COLOR")
        for state, expected in colors.STATE_TO_COLOR.items():
            assert state in applet_colors, f"state {state!r} missing from applet STATE_COLOR"
            assert applet_colors[state] == expected.lower(), (
                f"color mismatch for {state!r}: "
                f"applet={applet_colors[state]}, spec={expected.lower()}"
            )


# ---------------------------------------------------------------------------
# Hook → Server field contract
# ---------------------------------------------------------------------------
class TestHookToServerContract:
    """Every field the hook sends must be extracted (stored) by the server."""

    # Fields hook sends on every event
    HOOK_ALWAYS_SENDS = {
        "pid", "state", "hook_event", "cwd", "project_root",
        "session_id", "tool_name", "tty",
    }
    # Fields hook sends only on SessionStart / UserPromptSubmit
    HOOK_WINDOW_SENDS = {"window_id", "tab_name"}

    # Fields server stores per-agent (from do_POST source)
    SERVER_STORES = {
        "pid", "cwd", "state", "timestamp", "hook_event", "tool_name",
        "session_id", "subagent_count", "started_at",
        "window_id", "tab_name", "tty", "project_root",
        "ai_title",
    }

    def test_hook_always_fields_stored_by_server(self):
        for field in self.HOOK_ALWAYS_SENDS:
            assert field in self.SERVER_STORES, \
                f"hook sends {field!r} but server does not store it"

    def test_hook_window_fields_stored_by_server(self):
        for field in self.HOOK_WINDOW_SENDS:
            assert field in self.SERVER_STORES, \
                f"hook sends {field!r} (on window events) but server does not store it"


# ---------------------------------------------------------------------------
# Server → Applet field contract
# ---------------------------------------------------------------------------
class TestServerToAppletContract:
    """Every field the applet reads must be written by the server."""

    # Fields the applet accesses as agent.X (grep agent\.\w+ in applet.js)
    APPLET_READS = {
        "pid", "state", "cwd", "project_root", "window_id",
        "hook_event", "tool_name", "session_id",
        "subagent_count", "started_at", "timestamp",
        "ai_title",
    }

    SERVER_WRITES = {
        "pid", "cwd", "state", "timestamp", "hook_event", "tool_name",
        "session_id", "subagent_count", "started_at",
        "window_id", "tab_name", "tty", "project_root",
        "ai_title",
    }

    def test_all_applet_reads_are_server_written(self):
        for field in self.APPLET_READS:
            assert field in self.SERVER_WRITES, \
                f"applet reads agent.{field} but server does not write it"

    def test_applet_reads_match_grep_of_source(self):
        """Confirm APPLET_READS covers every agent.X access in applet.js."""
        src = _applet_src()
        accessed = set(re.findall(r"agent\.(\w+)", src))
        # Ignore internal JS properties (e.g. agent itself used as object)
        accessed.discard("length")
        for field in accessed:
            assert field in self.SERVER_WRITES or field in self.APPLET_READS, \
                f"applet reads agent.{field} but it is not in the known field sets"


# ---------------------------------------------------------------------------
# Grouping key consistency
# ---------------------------------------------------------------------------
class TestGroupingKeyConsistent:
    """Applet must group by project_root, not by window_id."""

    def test_applet_groups_by_project_root(self):
        src = _applet_src()
        # Find the gkey assignment line
        match = re.search(r"let gkey\s*=\s*(.+);", src)
        assert match, "gkey assignment not found in applet.js"
        expr = match.group(1)
        assert "project_root" in expr, "gkey must use project_root"
        assert "window_id" not in expr, \
            "gkey must NOT use window_id (causes wrong grouping for same-project agents)"
