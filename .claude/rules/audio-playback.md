---
description: Audio playback architecture — Rust audio commands, gapless prefetch, PosTracker, race guard
paths:
  - "src-tauri/**"
  - "src/store/player.ts"
  - "src/hooks/useTrackEndedListener.ts"
---

# Audio Playback

## Rust Stays Thin

Only use `#[tauri::command]` for: audio control, file reads/writes via sidecar, OS keychain access. No business logic, data transformation, or API calls in Rust. `lib.rs` is the only Rust file with logic; `main.rs` is a 6-line stub.

## AudioState

`AudioState` in `lib.rs` holds:
- `rodio::Sink` — the active playback sink
- `play_id: AtomicU64` — race guard: bumped as the **very first thing** in `audio_play`, before stopping the old sink. This prevents spurious `track-ended` events from a previous decode thread completing late.
- `PosTracker` — wall-clock elapsed (rodio 0.19 doesn't expose `get_pos` accurately; we use a manual timer)
- `prefetch_cache: HashMap<url, bytes>` — next track bytes downloaded in background

## Gapless (near-gapless)

Current implementation: bytes for the next track are fetched at 80% elapsed (`player.ts`). After `track-ended` fires, the cached bytes are available for immediate decode. There is still a decoder-startup gap (~10–30ms); true sample-accurate gapless via `Sink::append` pre-queue is a v2 goal.

## Commands

| Command | Purpose |
|---|---|
| `audio_play(url)` | Fetch (or use prefetch cache) → decode → append to new Sink. Fire-and-forget; returns immediately. |
| `audio_pause` / `audio_resume` | Sink pause/resume |
| `audio_stop` | Drain sink |
| `audio_seek(secs)` | `Sink::try_seek()` + reset PosTracker |
| `audio_volume(vol)` | Square-law: UI value `v` → Rust as `v²` |
| `audio_get_pos` | Returns PosTracker wall-clock elapsed |
| `audio_prefetch(url)` | Background HTTP fetch into `prefetch_cache` |

## TS-Side Playback Flow

1. Component calls `playerStore.play(track, streamUrlFor)`
2. `player.ts` invokes `audio_play(url)` — returns immediately
3. JS polls `audio_get_pos` every 200ms for elapsed; updates `elapsed` in store
4. At 80% elapsed: invoke `audio_prefetch(nextUrl)`
5. `useTrackEndedListener` listens for Tauri `track-ended` event → calls `playerStore.next()`

## Known Limitations

- **Full file buffered before playback** (`lib.rs`): `reqwest::blocking::get().bytes()` pulls entire file into RAM. Streaming `Read+Seek` wrapper is a known improvement (see HANDOFF).
- **`elapsed` has ~200ms startup gap**: `PosTracker.play_start` set at `sink.append` time, not when audio begins.
- **`OutputStream` must stay alive**: `audio_output` thread parked for the app lifetime to keep the stream handle valid.
