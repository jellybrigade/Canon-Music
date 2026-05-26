---
description: Code quality principles — philosophy, functions, files, error handling, security, naming, comments, version control
---

# Coding Standards

## Philosophy
- Simplicity first — YAGNI. Smallest design that covers current requirements.
- Explicit over implicit — make intent clear through structure and naming.
- Delete over comment — remove unused code, never comment it out.

## Functions
- 0–2 parameters preferred; 3+ → use an object.
- One responsibility, typically < 50 lines.
- Early returns to flatten nesting; max 3 levels.
- No magic numbers or strings — extract to named constants.

## Files & Modules
- One primary responsibility per file.
- No god files (> 500 lines) — split early.
- Separate concerns: domain logic / data access / presentation.
- High cohesion within modules, low coupling between.

## Error Handling
- Always handle errors — log with context or propagate explicitly.
- Fail fast — detect and report errors early.
- Meaningful error messages; no sensitive data in logs.

## Testing
- Write testable code from the start — no hidden dependencies, explicit side effects.
- Test behavior, not implementation.
- Tests pass before moving to the next goal.

## Security (always active)
- Credentials via OS keychain only — never SQLite, localStorage, or env vars in frontend.
- Parameterized queries for all SQLite access — no string interpolation.
- Validate all external input at system boundaries (server API responses, sidecar responses, user input).
- Never log tokens, passwords, or shared secrets.

## Naming
- Full words, problem-domain vocabulary.
- Abbreviations only when universally recognized (`id`, `url`, `api`).

## Comments
- Only write a comment when the WHY is non-obvious.
- Never describe what the code does — the code does that.
- Delete commented-out code immediately.

## Version Control
- Atomic, focused commits — one logical change per commit.
- Clear commit messages: what changed and why.
- Only commit working code that passes tests.

## Things to Avoid
- No business logic in Rust — keep it in TypeScript.
- No writing credentials or tokens to SQLite or localStorage — keychain only.
- No blocking startup — library loads from SQLite cache immediately; sync runs in background.
- No telemetry, analytics, or external calls except: music server APIs, Last.fm, ListenBrainz, MusicBrainz (AcoustID is v2).
- No backwards-compatibility shims — no renamed `_vars`, no `// removed` comments, no zombie re-exports. Delete cleanly.
