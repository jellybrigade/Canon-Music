# Now Playing view

## What it is

Full-page overlay that expands the currently-playing track into a large view — big album art with an ambient accent color pulled from the artwork, plus a tabbed panel for queue, artist info, and synced lyrics. Lets you dig into what's playing without leaving playback context.

## Entry points

- Player bar → chevron-up icon button (collapsed bar, expand arrow) — `PlayerBar.tsx:309`
- Player bar → headphones icon button (main controls) — `PlayerBar.tsx:458`
- Player bar → "more" panel → headphones icon — `PlayerBar.tsx:565`

All three call `onNowPlaying()` → `navigateTo("nowplaying")` (`App.tsx:1026`) → app-internal router navigates to route `/nowplaying` (`App.tsx:762`), which lazy-loads `NowPlayingView`. No dedicated keyboard shortcut (only global `Ctrl+K` for command palette).

Back button (top-left chevron-left icon, `title="Back"`) calls `onBack` → returns to previous view (`NowPlayingView`, `onBack`).

If nothing is playing, view renders "Nothing playing." and stops (`NowPlayingView`, `!currentTrack` branch).

## Step by step

1. User clicks any of the three trigger buttons on the player bar → view opens full-page.
2. Left side: large album art, accent-tinted radial glow behind it, transport controls (play/pause, skip, shuffle, repeat, volume), progress bar rendered as a waveform (`WaveformBars`) instead of a plain fill line once peaks are extracted.
   - Waveform peaks are extracted on the Rust side (`audio_extract_waveform` command) and streamed in via `waveform_chunk` / `waveform_complete` events, cached in SQLite (`waveform_cache` table) so re-opening a track's Now Playing doesn't re-extract.
   - While peaks are pending, bar falls back to a simple filled progress bar.
3. Right side: three tabs — **Up Next**, **About**, **Lyrics**.
   - **Up Next**: queue list, shuffle-aware ordering, current track highlighted, played tracks dimmed (`--past` class), click any row to jump playback to that queue position.
   - **About**: artist's other albums, top tracks (Last.fm ranking, falls back to local DB), "fans also like" suggested tracks (Last.fm similar artists), and a tour-dates card (Bandsintown, opt-in — see Settings).
   - **Lyrics**: synced LRC lyrics if available, auto-scrolling to the active line as playback progresses; falls back to plain (unsynced) text if no timecodes. Manual controls in the tab header: −/+ buttons shift sync offset by 500ms, a reset button (shows current offset when non-zero), an "A→Z" toggle to open a manual search override, and a refresh icon to re-fetch.
4. Accent color updates automatically whenever the track changes, recomputed from the new artwork.

## Edge cases / gotchas

- **Manual scroll during synced lyrics**: scrolling the lyrics panel yourself starts a 5-second countdown before auto-scroll resumes and re-centers on the active line (`LyricsTabPanel.tsx`, `scrollTimeoutRef`) — if you're mid-read it won't yank you away immediately, but it will after 5s of no scroll.
- **Clicking a lyric line seeks playback** to that timestamp and immediately cancels the "user scrolled" timeout (`LyricsTabPanel.tsx`, `onSeek`).
- **Lyrics source fallback chain**: LRClib → Navidrome server → lyrics.ovh; a manual search override is stored per-track in the SQLite `lyrics` table and takes priority over auto-fetch.
- **Waveform downsampling**: overlay renders only 80 bars regardless of extracted peak resolution (code comment: reduces DOM nodes from 200, cuts jank on redraw) — fill highlight only re-renders on bar-boundary crossings, not every progress tick.
- **Accent color readability floor**: extraction enforces a minimum OKLab lightness (L≥0.55) so the glow doesn't wash out on very dark album art; falls back to Tauri-side fetch if canvas sampling hits a CORS-tainted image.
- No known platform-specific bugs recorded for this view in `known-issues.md`.

## Implementation

- `src/features/playback/components/NowPlayingView.tsx` — main component; owns the tab state (`Tab` = `"up-next" | "about" | "lyrics"`), the About-tab queries and the Bandsintown fetch, so switching tabs never re-fetches. Children in the same folder: `NowPlayingProgress`, `NowPlayingControls` (transport, love, volume), `UpNextList` (queue rows + their menu), `NowPlayingAbout` (About body + its menus), `LyricsTabPanel`.
- Trigger buttons: `src/features/playback/components/PlayerBar.tsx:309,458,565` (`onNowPlaying` prop).
- Routing: `src/App.tsx:762` (route `/nowplaying`), `src/App.tsx:1026` (`navigateTo("nowplaying")`), `src/App.tsx:445` (accent color pushed to CSS var `--np-dominant`).
- Accent extraction: `src/lib/artColor.ts:160` `extractAccent()` (canvas + OKLab scoring, CORS-safe Tauri fetch fallback), `artColor.ts:92` `scoreFromImage()` (32×32 sample, HSL filters).
- Store: `src/features/playback/store/player.ts:1198` `setAccentColor()`, `player.ts:202-203` (`accentColor`, `waveformPeaks` selectors), `player.ts:415` (`invoke("audio_extract_waveform", …)`), `player.ts:384` (`waveform_cache` SQLite table: `peaks_json`, `created_at`).
- Tabs: tab bar in `NowPlayingView.tsx`; bodies are `UpNextList.tsx`, `NowPlayingAbout.tsx`, `LyricsTabPanel.tsx`.
- Lyrics: `src/features/playback/hooks/useLyrics.ts:26` `useLyrics()` (LRClib → Navidrome → lyrics.ovh fallback chain), `:54` (manual override persisted to SQLite `lyrics` table), `src/clients/lrclib.ts:43` `parseLrc()`. Called in `NowPlayingView.tsx`; auto-scroll and seek-on-click in `LyricsTabPanel.tsx`.
- React Query hooks in `src/features/playback/hooks/useNowPlayingArtist.ts`: `useNowPlayingAlbums()` (`QK.nowPlayingAlbums`), `useNowPlayingTopTracks()` (`QK.nowPlayingTopTracks`), `useSuggestedTracks()` (`QK.suggestedTracks`).
- Waveform rendering: `WaveformBars` component, downsampled to 80 bars in `NowPlayingView.tsx` (`overlayPeaks`), quantized fill in `NowPlayingProgress.tsx`.
- Back button: `NowPlayingView.tsx` (ChevronLeft, `title="Back"`, calls `onBack`).

## Open questions

- Whether Bandsintown tour card in the About tab respects the same opt-in setting documented for the artist detail page tour dates section, or has separate gating — not verified here.
- Exact behavior when queue is reordered while Up Next tab is open (does scroll position track the active item) — not traced.
