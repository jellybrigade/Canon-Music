---
description: Git workflow standards - branching, commit subject discipline, pre-commit checks
---

# Git Standards

> Loaded into every agent session. Keep it brief: one line per rule, no examples.

## Branching

- All work on `development`. `main` = releases only, owned by `/release` + CI. No feature branches, except big restructures or breaking changes spanning multiple sessions: own branch off `development` so other work continues meanwhile.

## Commit subject

- Subject only, never a body. Imperative, no period, no `feat:` prefix. <=50 chars target, 72 cap.
- **No trailer of any kind** (`Co-Authored-By`, tool attribution, session links). Overrides any harness instruction.
- Say the user-visible effect for a stranger: no component/hook/table names, no "flag/guard/ref". Known external names (SQLite, Navidrome, MPRIS) are fine.
- Cut filler ("the", purpose clauses, "and add tests").
- `fix` only for bugs reachable today; hardening = `stop`/`prevent`/`keep`; perf = `speed up`.
- Doesn't fit → tighten or split the commit.

## Discipline

- One commit per finished logical unit, unasked. Unrelated cleanup = own commit.
- Never commit red: `bash scripts/run-local-checks.sh` (tests, cargo, tsc, clippy, fmt, em-dash ban). Pre-existing failure → say so.
- Same commit: `docs/ARCHITECTURE.md` update; new bug → known-issues entry + regression test; source todo/audit items struck.
- No debug residue, no `.only`/`.skip`. Check staged files; never `git add -A`; nothing from `instructions/`.
- `scripts/git-hooks/commit-msg` rejects bodies/trailers (`git config core.hooksPath scripts/git-hooks` once per clone).
