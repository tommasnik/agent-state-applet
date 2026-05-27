---
id: TASK-23
title: 'Server: close run on all agent lifecycle end events'
status: In Progress
assignee: []
created_date: '2026-05-27 13:39'
updated_date: '2026-05-27 14:52'
labels:
  - backend
  - server
  - tdd
milestone: m-0
dependencies:
  - TASK-19
  - TASK-22
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the server's agent lifecycle handling to close the matching `runs` record in all termination scenarios.

## Termination scenarios and expected outcomes

| Scenario | Trigger | Status written | How |
|---|---|---|---|
| Normal session end | Stop hook event | `success` | Find run by `pid`, set `finished_at`, `status`, `ai_title` |
| `/clear` — new session same TTY | SessionStart on same TTY as open run | `cancelled` | Find open run by `tty`, close before creating new one |
| Process killed (SIGKILL/SIGTERM) | PID checker detects dead PID | `failed` | Existing pid_checker loop; add DB write |
| Subagent process killed, parent lives | PID checker: subagent PID dead, parent alive | No run change | Subagent PIDs are not run PIDs — skip |
| Multiple subagents running | Parent session has `subagent_count > 0` | No effect until parent ends | Parent PID is the run PID |
| Session never sent Stop (server crash, OOM) | Server restart (see TASK-22) | `failed` | Handled in server startup |
| Headless run normal exit | `proc.on('close')` in runner.ts | `success` | Already implemented — verify ai_title is written |
| Headless run non-zero exit | `proc.on('close')` with code != 0 | `failed` | Already implemented — verify |
| Manual trigger (Run Now) followed by kill | PID death | `failed` | Same as regular kill |

## ai_title propagation
When closing a run as `success` or `cancelled`, copy `ai_title` from the agent's in-memory AgentStore entry (if exists) into `runs.ai_title`.

## No double-close
If a run is already `success`/`failed`/`cancelled`, ignore subsequent close attempts for the same run_id.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Stop hook closes run with status=success and writes ai_title
- [x] #2 /clear (TTY recycle) closes previous run as cancelled before opening new one
- [x] #3 SIGKILL of main process closes run as failed (detected by pid_checker)
- [x] #4 Killing a subagent PID does not close the parent run
- [x] #5 Server restart closes all open runs with dead PIDs as failed (tested via TASK-22)
- [x] #6 Double-close is idempotent — second close is a no-op
- [x] #7 Headless success already closes as success — test that ai_title is written
- [x] #8 Tests: each scenario above has a dedicated test case
- [x] #9 Tests: ai_title present in DB after successful close
- [x] #10 Tests: timing — finished_at - started_at = realistic duration (not zero, not negative)
<!-- AC:END -->
