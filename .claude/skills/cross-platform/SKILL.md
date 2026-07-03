---
name: cross-platform
description: Pick one item from instructions/possible-cross-platform-problems.md, research how competitor apps handled it, compare to Canon's current implementation, and port a correct fix if Canon has a real problem. Use when user says "cross platform", "check cross-platform problems", or invokes /cross-platform.
---

You are invoked in plan mode. Work through these phases in order.

**Path note:** `instructions/` and `reference-projects/` live at the repo root (`/home/mschachner/Projects/Canon/`), not inside this skill's own directory (`.claude/skills/cross-platform/`). Don't `find`/`ls` under the skill dir looking for them.

## Phase 1 — Read the list

Read `instructions/possible-cross-platform-problems.md` (repo-root path, e.g. `/home/mschachner/Projects/Canon/instructions/possible-cross-platform-problems.md` — NOT relative to this skill's own directory). Pick the **highest-worry item still listed** (top of "High worry", then "Medium worry"). If the user named a specific item in their invocation, use that one instead.

## Phase 2 — Research competitor handling

Spawn a `caveman:cavecrew-investigator` agent (or do it directly if scope is small) to search `reference-projects/` (repo-root path, sibling to `instructions/` — NOT under this skill's directory) for how other cross-platform Navidrome/Subsonic/media-player clients (Feishin, Supersonic, aonsoku, sonixd, Nocturne, etc.) handle this exact concern. The doc already has partial competitor notes inline for each item — use those as a starting pointer, but verify by reading the actual referenced files (don't trust the summary alone). Return: which project, file:line, the actual pattern/code used, and any caveats they hit.

## Phase 3 — Audit Canon's current implementation

Read Canon's current code for this concern (file paths are usually named in the doc — `src-tauri/src/*.rs`, `keychain.ts`, `upnp.rs`, `lib.rs`'s `CoverState`, audio backend, CI workflow, etc.). Determine concretely:

- Does Canon do the risky thing described, or has it already been mitigated?
- Is this a real bug (will misbehave/crash/silently no-op on Mac or Windows) or just an untested-but-probably-fine assumption?

State your verdict in one or two sentences before proceeding.

## Phase 4 — Decide: port or skip

- **If Canon has a real, fixable problem** and a competitor's approach is directly portable (e.g. an availability check, a fallback path, an error handler, a bind-error log) → proceed to Phase 5.
- **If the risk can't be resolved without actually running on Mac/Windows** (e.g. WKWebView rendering quirks, notarization, real hardware firewall prompts) → don't fake a fix. Say so, and if there's a cheap defensive change available (e.g. wrap a risky call in a try/catch with graceful degradation, add a `prefers-reduced-motion`-style fallback) do only that. Otherwise stop here and report why no code change is possible yet.

## Phase 5 — Implement

Exit plan mode and port the fix into Canon, adapted to Canon's actual code (Rust idioms in `src-tauri/`, TypeScript patterns in `src/`) — not a verbatim copy of the competitor's language/framework. Follow CLAUDE.md and relevant `.claude/rules/` files for touched paths. Typecheck (`pnpm tsc --noEmit`) and/or `cargo check` after.

## Phase 6 — Update the tracking doc

In `instructions/possible-cross-platform-problems.md`:
- If fully resolved: remove the item's section entirely (renumber remaining items if numbered).
- If partially mitigated (defensive fallback added but the underlying untested-platform risk remains): keep the item but add a line noting what was done and what's still unverified without real Mac/Windows hardware.

## Phase 7 — Commit

Invoke the `/commit` skill.
