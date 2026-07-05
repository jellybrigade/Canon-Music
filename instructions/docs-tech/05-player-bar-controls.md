# Player Bar Controls

## What it is

The persistent playback bar at the bottom of the window lets you control the currently playing track — play/pause, skip, shuffle, repeat, volume, rating, love, sleep timer, and casting — without leaving whatever view you're browsing.

## Entry points

The bar is always docked at the bottom of the main window whenever a track is loaded (`src/components/PlayerBar.tsx:283` — the whole bar renders `null` when there's no `currentTrack`, i.e. before anything has ever been played this session).

- Left section: album art thumbnail (click → jump to that album; small chevron above it → open Now Playing full view), track title, artist (click → artist page), and the Radio chip if radio is active.
- Center section: shuffle / previous / play-pause / next / repeat buttons, plus the seek/progress bar (`PlayerProgress`).
- Right section: love (heart), 5-star rating, sleep timer, cast, "Now playing" (headphones), queue toggle, volume slider, and a "More controls" chevron that opens an overflow panel with the same shuffle/repeat/love/timer/cast/volume controls for narrow window widths.

## Step by step

1. **Play/Pause** — click the center circular button, or press `Space` (ignored while typing in a text field). Shows a spinning loader icon while a track is buffering.
2. **Skip forward** — click the next (⏭) button, or press `Shift+→`. Disabled when `repeat` is off and you're on the last queue item.
3. **Skip back / restart** — click the previous (⏮) button, or press `Shift+←`. If more than 3 seconds have elapsed in the current track, this restarts the current track instead of going to the previous one (standard "double-tap to go back" behavior). **Press-and-hold** the previous button for 400ms to force-restart the current track regardless of elapsed time.
4. **Seek ±5s** — `←` / `→` (without Shift).
5. **Volume** — drag the slider, scroll/wheel over the volume control, or `↑`/`↓` (±5% per press). Click the speaker icon to mute/unmute (remembers your pre-mute level).
6. **Shuffle** — click the shuffle icon to toggle. Turning it on reshuffles the remaining queue from your current position; turning it off restores true queue order and re-syncs your position to where you actually are.
7. **Repeat** — click the repeat icon to cycle: **off → repeat all → repeat one → off**. Icon changes to a "1" badge in repeat-one mode.
8. **Love** — heart icon toggles loved status on the current track (writes through to Navidrome).
9. **Star rating** — hover the 5-dot row to preview, click a star to set 1–5; clicking the currently-set star clears it back to 0. Debounced 200ms before writing to the server.
10. **Sleep timer** — clock icon opens a popover with 15/30/45/60-minute presets or "End of track"; shows a live countdown once armed, replacing the icon with `M:SS` text.
11. **Cast** — cast icon opens a popover listing "This computer" plus any discovered DLNA/UPnP renderers (triggers a scan on open).
12. **Queue panel** — list icon toggles the `QueuePanel` sidebar.
13. **Now Playing** — headphones icon (or the chevron over the album art) opens the full Now Playing view.

## Edge cases / gotchas

- **Next-button disabled state**: only disabled when `repeat === "off"` AND you're at the last queue index — with repeat-all or repeat-one, Next is always enabled since it wraps.
- **Consume mode**: if consume-on-skip is enabled, skipping or reaching natural end removes the just-played track from the queue. Explicitly **not supported combined with shuffle** — shuffled queue indices aren't remapped, so consume-mode removal is skipped while shuffled (`src/store/player.ts:899`).
- **Repeat-all + shuffle**: looping back to the start reshuffles the queue again so each pass plays a different order, rather than repeating the same shuffled sequence (`src/store/player.ts:923-930`).
- **Radio-on-queue-end**: if the queue naturally runs out with repeat off and `radioOnQueueEnd` is set, playback doesn't stop — it seeds a new Radio session from the last track instead.
- **Sleep timer "end of track"**: on natural track end, the timer fires before the normal auto-advance logic — it stops playback and clears the timer rather than moving to the next track (`src/store/player.ts:882-888`).
- **Global shortcuts are suppressed** while focus is in an `<input>`, `<textarea>`, or any `contenteditable`, and whenever Ctrl/Cmd/Alt is held (`src/hooks/useGlobalShortcuts.ts:6-21`) — so browser/OS shortcuts using those modifiers aren't hijacked.
- **OS media keys** (play/pause/prev/next/seek via `navigator.mediaSession`, which also exposes MPRIS controls on Linux) are wired separately from the in-app keyboard shortcuts — see Implementation below.

## Implementation

- **Component**: `src/components/PlayerBar.tsx` — all buttons, popovers (sleep timer, cast, art), rating, love, more-panel.
- **Styles**: `src/components/PlayerBar.css`.
- **Store**: `src/store/player.ts` (Zustand) — key actions: `pause`/`resume` (:960,:967), `next` (:871), `prev` (:948), `seek`, `setVolume`/`toggleMute` (:988,:1006), `toggleRepeat` (:1106), `toggleShuffle` (:1122). `RepeatMode` persisted to SQLite `settings` table (`repeat`, `volume` keys). Shuffle order tracked as `shuffleOrder: number[]` resolved via `resolveTrack()` (:108); `PREV_RESTART_THRESHOLD_S = 3` (:50) gates restart-vs-previous behavior.
- **In-app keyboard shortcuts**: `src/hooks/useGlobalShortcuts.ts` — Space, arrows, Shift+arrows, L (love).
- **OS media session**: `src/hooks/useMediaSession.ts` — sets `MediaMetadata`, `playbackState`, and action handlers for play/pause/previoustrack/nexttrack/seekbackward/seekforward.
- **Rating**: `setRating`/`fetchTrackRating` in `src/lib/navidrome.ts`, cached via React Query key `QK.trackRating`.
- **Love**: `useLoved()` hook (`src/hooks/useLoved.ts`).
- **Cast/DLNA**: renderer discovery/state lives in the player store (`castDevice`, `availableRenderers`, `scanRenderers`, `setCastDevice`); per `CLAUDE.md`, SSDP discovery itself is the one deliberate Rust exception (`src-tauri/src/upnp.rs`), all SOAP control stays in `src/lib/dlna.ts` / `src/store/playbackTarget.ts`.
- **Progress/seek UI**: `src/components/PlayerProgress.tsx:15` (click-to-seek).
- **Rust audio commands** (`src-tauri/src/lib.rs`) — thin per CLAUDE.md's "Rust stays thin" rule, just `rodio`/`symphonia` control:
  - `audio_play` (:264) — load + decode, emits `audio-format` event.
  - `audio_pause` / `audio_resume` (:631, :667) — optional ~30ms fade ramp (the "pause/resume fade" setting).
  - `audio_stop` (:703) — bumps an internal `play_id`, clears state.
  - `audio_seek` (:511) — mutes then ramps back in over ~80ms via a background thread (click-pop prevention).
  - `audio_get_pos` (:478) — polled every 200ms by `startElapsedTimer` (`player.ts:286`) for elapsed time / progress bar / natural-end fallback detection.
  - `audio_volume` (:484) — linear scale; the `Math.sqrt(replayGainLinear)` multiplier is applied TS-side before calling this.
  - `audio_set_speed` (:494) — 0.5x–2.0x clamp, backs the Playback-speed setting.
  - `audio_enqueue_next` (:554) — prefetches the next track for gapless playback; `player.ts` enqueues it once the current track crosses ~80% duration.
- **Gapless**: `track-advanced` Rust event (listened at `player.ts:244`) fires the seamless transition once the prefetched next track actually starts, keeping TS state in sync without an audible gap.

## Open questions

- ReplayGain computation (`computeReplayGainLinear`, `replayGainMode`/`replayGainPreAmp`/`replayGainFallbackGain`) appears wired into every volume-affecting call but isn't itself documented anywhere in `docs.md`'s outline — may warrant its own item.
- `.claude/rules/audio-playback.md` is referenced by `CLAUDE.md` but doesn't exist in the repo yet — couldn't cross-check for additional documented gotchas.
