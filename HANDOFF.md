# Handoff: NowPlaying/Home blur freeze (fixed) + Artist->Year freeze (open)

## Goal

User reported UI freezes while navigating Canon (Tauri + WebKitGTK). Two separate freezes surfaced:

1. **Now Playing <-> Home transition freeze** — diagnosed and fixed this session.
2. **Artist view -> Year view transition freeze** (~6-7s) — still unconfirmed, needs a fresh diagnosis pass.

## Current Progress

### Freeze #1 (Now Playing <-> Home) — FIXED

Captured a WebKit Web Inspector Timelines recording (`src-tauri/localhost-recording.json`, ~15MB — do not read this file directly, it was already analyzed and is stale/irrelevant now). Sorted by Total Time, found full-viewport `Paint` records up to 586ms.

Root cause: `src/components/NowPlayingView.css:23` applies `filter: blur(var(--blur-xl)) saturate(1.8) brightness(0.45)` to a full-viewport `::before` pseudo-element (the blurred album-art "atmosphere" background). It was using the same 600px cover art image (`largeArtUrl`, `src/components/NowPlayingView.tsx`) as the sharp foreground art. Blurring destroys detail, so feeding it a 600px source made WebKit's (non-GPU-accelerated per `.claude/rules/known-issues.md`) software blur filter do far more work than necessary.

**Fix applied:**
- `src/components/NowPlayingView.tsx`: added a separate `blurArtUrl` that requests the cover art at **64px** instead of 600px (cache is keyed by `id:size` in `src-tauri/src/lib.rs`, so this is a cheap, separately-cached fetch). Wired `--art-bg` to use `blurArtUrl` instead of `largeArtUrl`.
- `src/App.css`: bumped `--blur-xl` from `90px` to `120px` per user request (only consumer of this var is the atmosphere layer above — confirmed via grep, safe to change). Blurring a smaller source image at a larger radius costs effectively nothing extra.
- `pnpm tsc --noEmit` passes.
- Not yet re-profiled to numerically confirm the improvement — user was about to test live when this session ended.

Two pre-existing `impeccable` design-hook findings surfaced during edits (`layout-transition` at `NowPlayingView.css:233` and `App.css:276`, both about animating width/height/padding/margin instead of transform/opacity). Both are **unrelated to this fix** and were explicitly left alone — not introduced by this work, out of scope.

### Freeze #2 (Artist -> Year view, ~6-7s) — NOT YET DIAGNOSED

Ruled out: `PlayerBar` (persistent bottom bar, mounted during this transition too) has no `blur`/`backdrop-filter` in its CSS — so this is **not** the same root cause as Freeze #1.

User has captured a **second** WebKit Timelines recording specifically for this transition (Artist view open -> click Year view), saved at `src-tauri/localhost-recording-2.json` (~15MB+). User reports sorting by Total Time shows a large number of records at 100ms+, up to 288.5ms — much broader/noisier than Freeze #1's single dominant Paint record.

**Do NOT read `src-tauri/localhost-recording-2.json` directly** — it's large and the user explicitly does not want it read wholesale. Same as last time: ask the user for **screenshots of the Timelines panel sorted by Total Time** (they know this workflow already from Freeze #1). If this handoff is picked up in a session with no screenshots provided yet, **ask for them first** before attempting anything else on this freeze.

## What Worked

- WebKit Web Inspector -> Timelines tab -> record -> reproduce the freeze -> stop -> sort the resulting table by Total Time. This surfaced the dominant cost immediately for Freeze #1 (one row obviously way bigger than the rest).
- Parsing the exported Timelines JSON with a small Python script (`json.load`, filter `rec['records']` by `type`/`eventType`, sort by `endTime - startTime`) to get exact numeric durations and correlate timestamps — faster and more precise than eyeballing the screenshot alone. Record shape: top-level `{version, recording, overview}`, `recording['records']` is a flat list of typed records (`timeline-record-type-layout` with `eventType` of `invalidate-styles`/`recalculate-styles`/`paint`/`layout`, `timeline-record-type-script`, `timeline-record-type-cpu`, `timeline-record-type-rendering-frame`, `timeline-record-type-network`). Layout/paint records use `startTime`/`endTime` (not a `duration` field) relative to `recording['startTime']`.
- Static code reading (grep for `blur`/`backdrop-filter`, tracing CSS var sources back to the JS/TSX that sets them) to find the actual root cause once the profiler pointed at "Paint" as the expensive phase.

## What Didn't Work / Avoid

- **Never `gdb -p <pid>` (or any ptrace-based attach: strace, gdb, etc.) on the live `canon` process while audio is playing.** Attaching sends SIGSTOP to the whole process (all threads), which froze playback — user heard it glitch then go silent. Confirmed via `ps -o pid,stat,cmd -p <pid>` showing state `T` (traced/stopped); recovered with `kill -CONT <pid>`. If profiling is needed again, prefer the WebKit Web Inspector's own Timelines/CPU tools (non-invasive) or `/proc/<pid>/stat` polling for coarse per-thread CPU deltas (also non-invasive) — see the thread-sampling script pattern used earlier in this conversation (read `/proc/<pid>/task/*/stat`, diff `utime+stime` over a sleep interval, no attach required).
- `perf record` also didn't work in this environment — blocked by `perf_event_paranoid=4`, would need root/sysctl change. Didn't pursue since it's a system-wide config change requiring explicit user sign-off.
- Reading the raw exported Timelines JSON file directly, unprompted, doesn't scale well (15MB+) — better to ask for screenshots first (top rows sorted by Total Time), and only reach for the JSON file with a targeted Python parse (not a full `Read`) if screenshots aren't enough.

## Next Steps

1. **First, ask the user for screenshots** of the `localhost-recording-2.json` Timelines panel (sorted by Total Time, same as they provided for Freeze #1) if none have been shared yet this session.
2. Once screenshots are in hand, identify the dominant record type (unlike Freeze #1's single 586ms Paint, this one has many 100-288ms entries — could be a burst of many small layout/script thrashes rather than one big blur, e.g. repeated forced synchronous layout ("layout thrashing") during the Artist -> Year route swap, or something in `ArtistDetail.tsx` unmount / `YearsView.tsx` mount doing per-item synchronous work).
3. If needed, parse `src-tauri/localhost-recording-2.json` with a targeted Python script (see pattern in "What Worked" above) rather than reading it wholesale, to get exact record types/timestamps/durations to correlate with the screenshots.
4. Candidates already ruled out: `PlayerBar` blur/backdrop-filter (no blur CSS present). Candidates not yet checked: `AlbumGrid`'s virtualizer re-measure cost on route change (`src/components/AlbumGrid.tsx`, `useVirtualizer`/`virtualizer.measure()`), `useEnrichArtist`/`useArtistIdentity` cleanup on `ArtistDetail` unmount, any synchronous `JSON.parse` of large blobs (`similar_json`/`top_tags_json`), or genre/canon-tree scoring work triggered by route change.
5. Once root cause is found, confirm the fix numerically by re-recording the same transition and comparing Total Time before/after (same method used for Freeze #1).
6. `pnpm tsc --noEmit`, then commit to `development` (never `main` directly) per Canon workflow.

## Unrelated pending work (pre-existing, not part of this investigation)

There is a separate, still-unimplemented task below this section in git history / prior handoff content — a Last.fm duplicate-playcount bug in `ArtistDetail.tsx`'s "Popular" tracks section. That work was not touched this session. If picked back up, see the previous version of this file (`git log -p -- HANDOFF.md`) for full details, or ask the user whether to restore that section here.
