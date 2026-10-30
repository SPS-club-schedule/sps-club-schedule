# Department assignment and following template steps — 2026-10-30

- `npm test`: 68 passing; `npm run test:worker`: 22 passing; `npm run test:gateway`: 3 passing.
- Local build and whitespace checks pass. Worker tests use actual SQLite persistence and verify the new template rules across runtime restart.
- Department selection replaces the previous roster, including the default all-members selection. Individual changes switch to an explicit list. Following steps resolve every selected main-task member and update as that selection changes; disabling following freezes the current selection.
- The server resolves department membership inside the publication transaction, excludes other clubs and rejects empty/oversized departments, invalid settings and conflicting follow/department rules. Published tasks retain concrete member IDs. Subtask reassignment retains existing permissions, revision checks and completion protection.
- Browser QA against local Worker: created a template with department assignment and a following step, switched main department and observed the step update, saved/reopened through the template library, applied to a task, changed department again, disabled/re-enabled following, and published. Parent and child both show exactly the two current publicity members, with separate deadlines.
- Checked 375 × 812 mobile layout and saved `qa/assignment-mobile.png` (ignored local screenshot). Department chips and the following control fit without horizontal overflow. All QA writes used the isolated local test club.
- Existing templates require no migration; missing fields retain manual assignment behavior. No production roster, task or template is rewritten by deployment.
