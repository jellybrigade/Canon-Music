# Radio (Auto-DJ)

## What it is

Radio keeps music playing after your queue runs out by auto-picking related tracks — you seed it from a track, album, artist, or genre, and it endlessly appends similar tracks in the background. No need to build a playlist by hand.

## Entry points

Radio can be started from a "Start radio" submenu (`StartRadioSubmenu.tsx`) on right-click context menus in:
- Track rows in Album Detail, Artist Detail, Queue Panel, Search Results
- Album cards in Album Grid, Search Results, Now Playing's album chip
- Artist cards in Artist Grid, Search Results
- Genre cards on the Home view

Each submenu opens a list of 8 modes; clicking one starts radio in that mode, seeded from the clicked item.

Once active, a **Radio chip** appears in the player bar (`RadioChip.tsx`) reading `Radio: {mode label} ●`. Clicking it opens a dropdown: the same 8 modes (to switch mid-session) plus a **"Stop radio"** button at the bottom.

## Step by step

1. Right-click a track/album/artist/genre → "Start radio" → pick a mode (e.g. "Curated", "Same Genre", "Similar Artists"...).
2. The seed item plays (or queues), and the Radio chip appears showing the active mode.
3. As you near the end of the queue (fewer than 10 tracks remaining), Radio silently fetches and appends a new batch of candidate tracks — no visible interruption.
4. To change taste mid-session, click the Radio chip → pick a different mode. Next fill uses the new mode with the same seed.
5. Hovering the chip shows a tooltip: `Genre: {label} · Seeded from: {track title}` (when applicable).
6. Click "Stop radio" to end the session — the chip disappears and the queue reverts to normal (non-radio) playback once existing queued tracks finish.

### The 8 modes (as labeled in the UI)

| Label | Behavior |
|---|---|
| Curated | Blends genre-tree closeness + Last.fm artist similarity + track co-occurrence weighting |
| Same Genre | Genre-tree ancestor weighting only |
| Similar Artists | Random track from Last.fm's similar-artists list for the seed artist |
| Same Artist | Random track by the exact seed artist |
| Same Album | Tracks from the seed album in order; falls back to Curated once the album is exhausted |
| Same Era | Tracks from a similar release year (±4.5 years), scored by proximity |
| Loved Tracks | Random pick from your loved-tracks list |
| Random | Random track from anywhere in the library |

A **Similarity** slider (Settings → Playback tab, steps: Narrow / Tight / Balanced / Wide) controls how tightly candidates must match — narrower pulls fewer, closer matches; wider casts further.

## Edge cases / gotchas

- **Same Album mode runs out**: once every track on the seed album has played, it silently falls back to Curated instead of stopping.
- **Curated / Same Genre with an untagged seed**: if the seed track has no genre tags, candidates come back essentially random (low score ~0.1) rather than failing.
- **Same Era with no release year on the seed**: falls back to random-from-server.
- **Similar Artists with no Last.fm data**: candidate list can come back empty — if "auto-continue on queue end" is off, playback can simply stop rather than erroring.
- **Repeat-track fatigue**: Radio applies a decaying penalty to artists/albums it already picked recently in the session, so it won't loop the same artist back-to-back — the penalty recovers over time (session-scoped, not reset per fill).
- **Mode switch is non-destructive**: switching modes mid-session doesn't clear the current queue, only affects the *next* batch appended.
- **Auto-continue setting**: a `radioOnQueueEnd` setting can auto-start Radio automatically once a normal (non-radio) queue plays its last track.

## Implementation

- **Types & state**: `src/store/player.ts:29-37` (`RadioMode` union), `:39-48` (`RADIO_MODES` — mode/label pairs, single source of truth for all UI strings), `:154-158` (`radioActive`, `radioSeed`, `radioMode`, `radioLabel`, `radioSimilarityScale` state).
- **Actions**: `setRadioActive()` (`player.ts:1146`), `startRadio(track, mode, label?)` (`:1151`), `setRadioMode()` (`:1156`), `setRadioSimilarityScale()` (`:1161`) — similarity is a 0–1 float mapped from the Narrow→Wide steps in `PlaybackTab.tsx:8-14`.
- **Candidate scoring**: `src/lib/radio.ts`
  - `MOOD_WEIGHT = 0.4` (:16) — mood tags weighted lower than regular genre tags
  - `scaleWeights()` (:19-26) — derives tag/track-CF/artist-CF weight ratios from the similarity scale
  - `buildAncestorWeights()` (:73-97) — genre DAG ancestor scoring, max depth 4, weight halves per level up the tree
  - `getCuratedCandidates()` (:99-192) — combines canon-tree ancestor weights with Last.fm artist similarity, dampened by `sqrt(tag_count)`
  - `getRadioCandidates()` (:194-330) — dispatches by mode; `CANDIDATE_LIMIT = 200`
- **Queue-filling hook**: `src/hooks/useRadio.ts`
  - `LOOKAHEAD_THRESHOLD = 10` (:8) — refill trigger when fewer than 10 tracks remain queued
  - `ARTIST_DECAY_TRACKS` / `ARTIST_DECAY_TRACKS_NARROW` (:14-15) — half-life for the repeat-artist penalty
  - `MODE_WINDOW_MULTIPLIER` (:19-23) — per-mode tight/broad top-pick sampling window
  - `pickFromTop()` (:47-56) — uniform-random pick among the top-N scored candidates (avoids always picking the single best match)
  - `useRadio()` (:58-226) — the hook itself: polls queue length, fetches candidates on threshold, applies decay, appends to queue
- **UI**: `src/components/RadioChip.tsx` + `RadioChip.css` (persistent chip + dropdown), `src/components/StartRadioSubmenu.tsx` (shared context-menu submenu component)
- **Callers wiring seed → `startRadio()`**: `App.tsx:503-522` (`handleStartRadioFromAlbum`, picks a random track from the album's top half), `:524-548` (`handlePlayGenre`, queues the whole genre then starts Same Genre), `:550-571` (`handleStartRadioFromArtist`, random track by artist) — plus direct calls from `AlbumDetail.tsx`, `ArtistDetail.tsx`, `QueuePanel.tsx:331-336`.

## Open questions

- Exact wording/location of the `radioOnQueueEnd` setting toggle in Settings UI not independently verified — flagged by investigator agent from `player.ts` line 932, not re-checked directly.
- Whether "Similarity" slider is visible/labeled elsewhere besides Playback tab (e.g. inline on the Radio chip) not confirmed.
