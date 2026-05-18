---
id: TASK-1
title: Show AI-generated session title in applet
status: Done
assignee: []
created_date: '2026-05-15 19:43'
updated_date: '2026-05-18 05:55'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude Code generates an ai-title entry in the session JSONL file shortly after the first assistant response.
The server should watch the JSONL file for each known agent and, when a {"type":"ai-title","aiTitle":"..."} entry appears, update the agent state with the title.
The applet should display this title as a tooltip (on hover over the dot or label).

Data flow:
- Hook already sends session_id and project_root to server on SessionStart
- JSONL path: ~/.claude/projects/<project_root_encoded>/<session_id>.jsonl
  where project_root_encoded = project_root with / replaced by -
- Server polls/watches JSONL for type=ai-title entries
- aiTitle is added to agent state and written to claude-agents.json
- applet.js reads aiTitle and shows it as tooltip
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Server reads aiTitle from JSONL file within a few seconds of it being written
- [x] #2 aiTitle is included in the agent state JSON served to the applet
- [x] #3 Applet shows aiTitle as tooltip when hovering over the agent dot or label
- [x] #4 aiTitle is not overwritten once set (only the first title counts)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented AI-generated session title display in the agent state applet.

**Server (`server/claude_state_server.py`)**:
- Added `_encode_project_root()` helper that converts `/home/tom/code/proj` → `home-tom-code-proj` (matching Claude's JSONL directory naming)
- Added `_jsonl_path(project_root, session_id)` to construct the JSONL file path under `~/.claude/projects/`
- Added `_read_ai_title(path)` to parse JSONL lines and extract the first `{"type":"ai-title","aiTitle":"..."}` entry
- Added `ai_title_poller()` background thread that polls every 3s, scanning agents that have `session_id` and `project_root` but no `ai_title` yet
- Added `ai_title` field to the agent dict in `do_POST` (preserved from `existing` so it survives hook updates)
- Started `ai_title_poller` thread in `main()`

**Applet (`applet/applet.js`)**:
- Updated `_tooltipText()` to prepend `agent.ai_title` as the first line of the tooltip when present

**Tests (`server/tests/test_ai_title.py`)**:
- 16 new tests covering `_encode_project_root`, `_jsonl_path`, `_read_ai_title`, and poller logic including: no-overwrite guarantee, skip-without-session_id, skip-without-project_root, ai_title preserved on agent update

**Contract test (`server/tests/test_contract.py`)**:
- Updated `SERVER_STORES`, `SERVER_WRITES`, and `APPLET_READS` sets to include `ai_title`
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Tests written and passing
- [ ] #2 Implementation complete and working
- [ ] #3 No regressions in existing functionality
<!-- DOD:END -->
