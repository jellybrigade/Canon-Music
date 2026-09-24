# Known Issues

> Loaded into every agent session. Keep it brief: area pointers only, no entries here.

Bug classes that shipped once. Read the area file before touching matching code (Claude Code auto-loads it by `paths:`).

| Area | File |
|---|---|
| Linux / WebKitGTK / audio / HTTP stacks | `known-issues/platform.md` |
| Build / release / hooks | `known-issues/build.md` |
| Async / lifecycle / timers | `known-issues/async.md` |
| Tests / harness | `known-issues/testing.md` |
| Data / sync / SQL / caches | `known-issues/data.md` |
| UI / overlays / navigation / CSS | `known-issues/ui.md` |

Entry = bold lesson, 1-2 sentences cause + fix, class-wide grep. Backstory goes to `known-issues-history.md` (on demand).
