# Template default duration — 2026-10-30

- 83 unit/domain/UI tests, 24 Worker/SQLite integration tests and 3 gateway tests pass (110 total); build and whitespace checks pass.
- Templates save an optional positive integer duration in minutes, exposed as hours/minutes in the editor. Save, edit, copy, incremental sync and SQLite restart preserve it. Explicit `null` clears it; edits from older clients retain it when omitted. Invalid values roll back.
- Applying a template enables the main-task time range, calculates the end from the start, and updates it when the start changes. Cross-year and leap-day boundaries are tested. A manual deadline stays independent; manually changing the end stops automatic updates until restored. Applying a deadline-only template clears inherited duration settings.
- Published tasks retain concrete start/end times. Later template edits do not alter them. Subtasks remain deadline-only and relative deadlines still use the main deadline.
- Local browser QA: copied a template, saved 2 hours 30 minutes, observed its label in the library, used it, chose 14 November at 23:00 and saw 15 November at 01:30. Manually changed the end, moved the start, verified the manual end stayed fixed, restored automatic calculation and published. The resulting parent and child dates matched the preview.
- Verified the 375 × 812 mobile layout. Screenshot `qa/template-duration-mobile.png` is an ignored local artifact. Test writes used only the isolated local club.
