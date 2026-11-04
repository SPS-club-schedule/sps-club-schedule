# Template dependencies — 2026-11-04

- Local application tests: 141 passed, including the pre-existing uncommitted Android tests. Worker/SQLite integration tests: 49 passed. Gateway tests: 4 passed. Frontend build and whitespace checks passed.
- Added domain tests cover save, copy, delta sync, rename, reorder, stable IDs, duplicate titles, draft isolation, removal, independent published groups, idempotent retry, template edit isolation, invalid/missing/foreign/self/circular references, old-client conflict protection, and atomic validation failure.
- Both individual and shared tasks can complete and undo completion while their prerequisites are incomplete. Editing deadlines preserves references without imposing an ordering rule.
- Real Worker tests verify persistence across SQLite restart, template copying, task ID resolution, retry, and completion before a prerequisite.
- Browser QA used an isolated local Worker and a synthetic club. Edited the legacy seminar template, selected publicity copy as the poster prerequisite, moved the poster step up, saved, and confirmed the library displayed the relation.
- Applied the saved template, selected a future date, assigned the steps, and published. Parent detail showed the linked prerequisite. Completed the poster while its copy prerequisite remained incomplete; both states appeared together in the poster detail.
- Reopened the saved template and verified the selection. At 375 × 812 the editor and task detail both had `scrollWidth === innerWidth === 375`. Saved local ignored screenshots: `qa/dependencies-editor-mobile.jpg` and `qa/dependencies-completion.jpg`. Browser error log was empty; viewport override reset.
- No production task or template data are rewritten by this release. Existing templates can be edited to set relationships explicitly.
