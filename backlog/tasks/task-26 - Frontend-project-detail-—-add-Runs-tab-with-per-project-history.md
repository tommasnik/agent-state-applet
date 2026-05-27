---
id: TASK-26
title: 'Frontend: project detail — add Runs tab with per-project history'
status: To Do
assignee: []
created_date: '2026-05-27 13:40'
labels:
  - frontend
  - ui
  - tdd
milestone: m-0
dependencies:
  - TASK-24
  - TASK-25
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Runs" tab to the existing project detail view (wherever the current project page is).

## Tab layout

```
[ Overview ]  [ Runs ]  [ Schedules ]
```

Runs tab content is identical to the global `/runs` page but pre-filtered to this project and without the Project filter dropdown (it's implicit).

## Behaviour
- Default sort: started_at DESC
- Shows all run types (scheduled + manual) for this project
- Type filter still available (filter within project)
- Status filter available
- Clicking TYPE badge for scheduled → navigates to `/schedules/:id`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Runs tab appears in project detail navigation
- [ ] #2 Runs tab pre-filters by project_root of current project
- [ ] #3 Project filter dropdown absent (project is implicit)
- [ ] #4 All run types shown for this project
- [ ] #5 Type and status filters work within project scope
- [ ] #6 Clicking scheduled badge navigates to schedule detail
- [ ] #7 Tests: tab renders with correct project filter applied to API call
- [ ] #8 Tests: type/status filter interactions
- [ ] #9 Tests: empty state for project with no runs
<!-- AC:END -->
