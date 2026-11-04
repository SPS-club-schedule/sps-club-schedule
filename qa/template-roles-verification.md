# Template roles — 2026-11-04

- `npm test`: 129 passed. `npm run test:worker`: 48 passed. `npm run test:gateway`: 4 passed. Frontend build and whitespace checks passed.
- Definitions use stable role IDs; names are unique after trimming/case folding, limited to 30 characters, and templates allow 0–20 roles. Each step can bind one role. Existing role-free templates retain their behavior.
- Domain checks cover save/copy/sync/reorder/rename, explicit removal, old-client conflict protection, duplicate/invalid IDs and names, role limits, assignment-mode conflicts, multi-person and overlapping roles, missing selections, departed/foreign members, latest department resolution, atomic validation failure and publication retry.
- Real Worker/SQLite tests verify persistence across runtime restart and copy, reject empty role assignments, and publish concrete member lists in the same transaction as the parent and all children. Published tasks contain no mutable role rules.
- Browser QA used an isolated local club with three synthetic members. Created three roles and four steps, saved and reopened the template, applied it, selected one/two people per role and confirmed both poster steps changed together.
- Switched one poster step to manual assignment, changed the role roster, and observed the manual step retain its two-person selection. Rebound it, published, and verified the actual parent detail showed the expected four child assignments and deadlines.
- Copied the template, renamed the poster role and removed the assistant role. The two poster bindings retained the renamed role; the former assistant step became manual. Saving the copy left the original template unchanged.
- At 375 × 812, both the role editor and role assignment forms had `scrollWidth === innerWidth === 375`, and controls remained readable. The viewport override was reset. Browser error log was empty.
- Local ignored screenshots: `qa/template-roles-mobile.png`, `qa/template-roles-editor.png`.
- No production member, task or template records are rewritten by the release. To use roles in an existing template, edit that template and bind its steps explicitly.
