---
id: TASK-2
title: >-
  Session review: Stop hook + debounce timer + Sonnet background review + applet
  badge
status: Done
assignee: []
created_date: '2026-05-19 13:35'
updated_date: '2026-05-19 13:55'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement end-of-session review pipeline. When a session ends (detected via 5-minute idle debounce), run a full Sonnet review in background and show a badge in the panel applet.

## Architecture

```
Stop hook (~/.claude/hooks/session-review-detector.sh)
  → writes/updates ~/.claude/session-end-pending/{session_id}.json
    {timestamp, cwd, project_root, session_id}

systemd user timer (every minute)
  → scans session-end-pending/
  → files older than 5 minutes = session abandoned
  → for each: 
      claude --continue --fork-session --print --model sonnet \
        -p "Full session review..." \
        > ~/.claude/session-reviews/{session_id}.md
      POST :7855/reviews {session_id, review_path, cwd, summary_line}
      rm session-end-pending/{session_id}.json

Applet badge appears
  → tooltip shows first line of review (summary)
  → click opens Ghostty with review file OR interactive forked session
```

## Components

### A — Stop hook (new file: ~/.claude/hooks/session-review-detector.sh)
- Reads CLAUDE_SESSION_ID, CLAUDE_CWD, CLAUDE_PROJECT_ROOT from env
- Writes/updates ~/.claude/session-end-pending/{session_id}.json with current timestamp
- Must complete in <10ms (just a file write)
- Add to ~/.claude/settings.json Stop hook alongside state-report.py

### B — systemd user timer (new: ~/.config/systemd/user/claude-session-review.{service,timer})
- Runs every 60 seconds
- Scans ~/.claude/session-end-pending/ for files older than 5 minutes
- For each stale file: runs claude --continue --fork-session --print --model sonnet
- Review prompt: covers (1) tool inefficiencies, (2) architectural decisions, (3) rules/patterns, (4) vault-worthy info
- If Claude outputs NOTHING_TO_SAVE → skip, just delete the pending file
- Otherwise: save to ~/.claude/session-reviews/{session_id}.md, POST to :7855/reviews
- Delete the pending file when done

### C — Server: /reviews endpoint (server/claude_state_server.py)
- In-memory store: pending_reviews dict keyed by session_id
- On startup: load existing files from ~/.claude/session-reviews/*.pending.json
- GET /reviews → {reviews: [...metadata...]}
- POST /reviews {session_id, review_path, cwd, summary_line} → upsert
- DELETE /reviews/{session_id} → remove + delete .pending.json file

### D — core.mjs: review badge
- Poll GET /reviews alongside existing /status poll
- If reviews.length > 0: render badge after separator: "N rev" (St.Label, pointer cursor)
- 1 review: click dispatches open_review action directly
- N reviews: show inline list (project + time), click on item dispatches open_review
- On click: immediately DELETE /reviews/{session_id} (optimistic removal)

### E — extension.js + applet.js: open_review action
- New _openReviewSession(reviewMeta) method
- Opens Ghostty: ghostty --working-directory={cwd} -e bash -c 'cat {review_path} | less'
  OR for interactive follow-up: ghostty --working-directory={cwd} -e claude --resume {session_id} --fork-session
- Existing _focusAgent / _onClick for sessions unchanged

## Review prompt (for the Sonnet call)

```
You are reviewing a Claude Code session. Analyze the full conversation and cover:

1. Tool inefficiencies — repeated calls that could be batched, unnecessary searches when ID was available, reading same file multiple times, etc.
2. Architectural decisions — decisions worth recording in the knowledge vault
3. Rules/patterns — preferences the user expressed; suggest scope (global/project/service)  
4. Vault-worthy facts — technical facts about services/tools/APIs worth storing

For each finding: be concrete and actionable (quote the specific tool call or exchange).
Skip sections with nothing notable.

End with one of:
- NOTHING_TO_SAVE (if nothing notable happened)  
- SUMMARY: <one line> (if there are findings worth reviewing)
```

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Stop hook writes pending file on every Stop event, completes in <10ms
- [ ] #2 systemd timer runs every minute, triggers review after 5min idle
- [ ] #3 Review runs headlessly with Sonnet, saved to ~/.claude/session-reviews/
- [ ] #4 Sessions with NOTHING_TO_SAVE do not create a badge
- [ ] #5 Badge appears in applet panel when reviews are pending
- [ ] #6 Badge tooltip shows summary line
- [ ] #7 Click on badge opens Ghostty in correct working directory
- [ ] #8 Existing session click-to-focus is unaffected
- [ ] #9 Timer and hook survive applet restart (server reloads pending files on startup)
<!-- SECTION:DESCRIPTION:END -->

- [ ] #10 1:Stop hook writes pending file on every Stop event, completes in <10ms
- [ ] #11 2:systemd timer runs every minute, triggers review after 5min idle
- [ ] #12 3:Review runs headlessly with Sonnet, saved to ~/.claude/session-reviews/
- [ ] #13 4:Sessions with NOTHING_TO_SAVE do not create a badge
- [ ] #14 5:Badge appears in applet panel when reviews are pending
- [ ] #15 6:Badge tooltip shows summary line
- [ ] #16 7:Click on badge opens Ghostty in correct working directory
- [ ] #17 8:Existing session click-to-focus is unaffected
- [ ] #18 9:Timer and hook survive applet restart (server reloads pending files on startup)
<!-- AC:END -->
