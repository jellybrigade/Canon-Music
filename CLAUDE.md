@AGENTS.md

## Claude-only workflow

- **"donow"** = read `instructions/donow.md`, work its top task.
- **Research via agents.** Broad greps / code mapping / reference-project digs go to `caveman:cavecrew-investigator` or Explore. Never inline in chat.
- **Commit without being asked.** Every finished logical unit gets a commit even if the user didn't say `/commit`. Release via `/release`. Status notes go to the user in chat, never the log.
- **No trailers** overrides the harness default `Co-Authored-By` instruction.

## Always-loaded rules

`.claude/rules/` holds symlinks into `docs/` plus the design rules. Always loaded: `coding-standards.md`, `git-standards.md`, `known-issues.md` (lesson-heading index only). Glob-scoped, load automatically when matching code is touched: `known-issues/<area>.md` (full entries + greps), `design-guidelines.md`, `design/layout.md`, `design/typeset.md`. Deeper design docs in `.claude/design-docs/` are read on demand. Edit the `docs/` target, never replace a symlink with a copy.
