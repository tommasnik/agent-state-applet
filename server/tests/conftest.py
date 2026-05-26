"""Pytest configuration for server/tests.

Loads state-report.py (which has a hyphen in its name) as a module
named ``state_report`` so tests can import it normally.
"""
import importlib.util
import sys
from pathlib import Path

_HOOK_PATH = Path(__file__).parent.parent.parent / "hook" / "state-report.py"

spec = importlib.util.spec_from_file_location("state_report", _HOOK_PATH)
state_report = importlib.util.module_from_spec(spec)
sys.modules["state_report"] = state_report
spec.loader.exec_module(state_report)
