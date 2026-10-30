# Publishing SPS experience files

This directory is the repository source for the public SPS experience archive. User authorization to publish specific files is required; never harvest unrelated local files or infer personal experiences.

- Put files directly under `experience/<届次>/<部门>/<主题>/`. Use the real administration year, and preserve existing material. `.gitkeep` keeps an empty folder; it is not shown as a file.
- Optional helper: `npm run experience:add -- /absolute/path/to/file.pdf "2026-2027届/学术部"`. It copies without overwriting. Review the copied content before committing.
- Each file must be nonempty and at most 10 MB. Allowed extensions are defined in `shared/experience.js`; HTML, SVG, executables, symlinks and hidden paths are not published.
- Run `npm run build` and the relevant tests. Commit and push the authorized archive files to `main` using normal repository access, or open a PR if you do not have write access. The existing Pages workflow validates, indexes and publishes them automatically. Do not put GitHub credentials in the frontend.
- `AGENTS.md` is instructions for agents and is excluded from the public archive listing. Other Markdown files are normal published documents.
- Website uploads are separate durable storage, shown in the same folder tree. They are **not automatically mirrored into GitHub**. Read their public index at `https://sps-schedule.folderrewind.top/experience`; download an active file at `/experience/files/<id>`. No account token is needed for reads. Each file includes its SHA-256 digest for verification. Repository files are indexed at `https://sps-club-schedule.github.io/sps-club-schedule/experience-index.json`.
- Do not overwrite or silently duplicate website uploads when organizing repository content. Repository renames are made by git commits; website uploaders can organize their own files in the app.
