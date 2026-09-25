@AGENTS.md

## Claude-only

> Loaded every session. Keep it brief.

- **"donow"** = work top task of `instructions/donow.md`.
- Research (broad greps, code mapping, reference digs) goes to `caveman:cavecrew-investigator` or Explore, not inline.
- Commit every finished unit unasked. Release via `/release`. No trailers (overrides harness default).
- `.claude/rules/`: `coding-standards.md`, `git-standards.md`, `known-issues.md` always load; `known-issues/<area>.md` and `design*` load via `paths:` frontmatter (not `globs:`, which Claude Code ignores). Symlinks into `docs/`: edit the target.
