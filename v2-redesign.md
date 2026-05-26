# Canon — UI/UX Redesign + Tag Automation

## Context

Canon (v1.0.2) ships every planned feature, but the surface area has outpaced the value. The user (the project owner) prefers Feishin and Supersonic over Canon for daily listening because Canon feels convoluted, ugly, and slow. Concrete pain:

- **Surface bloat.** Five tag-related destinations (Inbox, Vocabulary, Health, Pending, Issues) for what should be invisible automation. Radio is a top-level sidebar item when every other player puts it on right-click. Genres, Years, Playlists, Tags, Issues, Pending, Radio all compete for the same sidebar.
- **Workflow friction.** Sidecar is never explained. No edit-server flow exists. Scrobbling is invisible. Manual tag editing requires four clicks before any feedback. Tag normalization is hand-cranked album-by-album.
- **Visual.** One 3,872-LOC `App.css`. Dense BEM scoping. No motion system. Sidebar is unlabeled icons. Album/artist views are utilitarian, not polished.
- **Perf.** No QueryClient defaults. No virtualization on album/artist grids. PlayerBar and QueuePanel destructure the entire Zustand store and re-render every 200ms. Hot SQLite queries miss indexes.

Intended outcome: Canon stops feeling like a tag-management tool with a player attached, and starts feeling like a music player with tag normalization happening invisibly in the background. Apple Music / Spotify-grade polish on the surfaces that matter (Library, Album, Artist, Now Playing). Setup and tag automation become things a non-technical user can succeed at on first run.

---

## Design principles

1. **Player first, tags invisible.** Tag work happens in the background; user only ever sees normalized tags rendered in album/artist views.
2. **One destination per concept.** Library / Artists / Playlists / Settings. Nothing else in the sidebar.
3. **Discovery via context, not menus.** Right-click, hover affordances, contextual drawers — not new top-level views.
4. **Display-only normalization.** The DB stores normalized tags. Files on disk are not auto-written. Sidecar remains opt-in for users who explicitly edit a tag.

---

## New IA

### Sidebar — 4 items

```
Library    Artists    Playlists    Settings
```

- **Library** absorbs genre + year filtering as header chips. The current `genres` and `years` views are deleted.
- **Tags** destination deleted entirely (all five subviews gone from the nav).
- **Radio** removed from sidebar. Replaced by right-click + player chip (below).
- **Pending / Issues / Inbox / Vocabulary / Health** all deleted as destinations.

### Library header

Chips row above the album grid: `Sort ▾`, `Genre ▾` (multi-select from canon tree), `Decade ▾`, `Loved`, `Search`. Rescan moves into Settings → Library.

### Album view

Three-column tag display under the album hero:

```
Genres                Descriptors            Scenes & Movements
Post-Punk             Atmospheric            Bristol Sound
Coldwave              Brooding
Gothic Rock           Reverb-Heavy
```

Each chip is clickable → filters Library by that tag. Right-click any chip → "Why is this tag here?" → opens a side drawer showing source (file tag / Last.fm popular tag / inferred from canon tree ancestors), confidence, and a `Remove` button. This is the only surface where tag plumbing is visible, and only on user request.

### Track row

No tag chips per track by default — too visually noisy. Right-click a track → `Show tags` opens the same drawer scoped to the track.

### Radio

- **Right-click any track / album / artist** → `Start radio from this`.
- **PlayerBar chip:** small `Radio ●` pill appears next to track title while radio is active. Click → small popover with `Change seed` / `Stop radio` / `What's playing this`. No full-screen Radio view.
- Existing `RadioView.tsx` and sidebar entry deleted.

### Scrobble visibility

PlayerBar adds a small dot next to the track title once a play is scrobbled. Click → tooltip with last-scrobble status and queue depth. Settings → Account exposes scrobble toggle + queued count.

---

## Tag automation — display-only

### Storage model

New column on `albums`: `normalized_tags_json` containing:

```jsonc
{
  "genres": [{ "id": "post-punk", "name": "Post-Punk", "source": "file|lastfm|canon-ancestor", "confidence": 0.9 }],
  "descriptors": [...],
  "scenes": [...],
  "computed_at": 1716700000
}
```

Original file tags remain untouched. The album UI renders from `normalized_tags_json`. The existing `track_tags` table stays as the raw input store; normalization writes the derived snapshot.

### Pipeline

1. **Pull**: fetch Last.fm top tags for the album (and artist as fallback) via `getalbuminfo` / `artist.getInfo`. Cap at top 20 per source.
2. **Merge**: union of file tags + Last.fm tags, deduped by `canonical_key`.
3. **Map**: each input tag → canon-tree node via the existing exact-match + Levenshtein-≤2 logic in `src/lib/genre-unify.ts` (reuse). Unmapped tags retained as raw with `id: null`.
4. **Bucket**: every mapped node placed into `genres` / `descriptors` / `scenes` based on its top-level RYM section ancestor (see Canon tree change below).
5. **Cap**: 6 genres, 6 descriptors, 4 scenes — ranked by Last.fm popularity then file-tag presence.
6. **Persist**: write `normalized_tags_json` + `computed_at`.

### When it runs

Three trigger modes, all enabled by default:

- **On-view**: when an album view opens and `computed_at` is older than 30 days (or null), fire pipeline in background, render existing snapshot meanwhile. Swap in when done.
- **On-demand**: button in Settings → Tags labeled `Refresh tag data now`. Iterates entire library with progress bar, non-blocking.
- **Background pass**: every app launch schedules a low-priority queue (1 album / 2 seconds) for any album stale by >30 days. Cancellable.

Setting: `Settings → Tags → Auto-refresh tags` (default on). When off, only the on-demand button runs the pipeline.

### Canon tree change

`scripts/parse-rym.mjs` modified to preserve the three depth-0 RYM section headers as a `section` field on each node:

```js
section: "genres" | "descriptors" | "scenes-and-movements"
```

The RYM hierarchy file has exactly three top-level sections: **Genres**, **Descriptors**, **Scenes & Movements**. Every child node inherits the section it was parsed under. `canon-tree.json` regenerated after. Existing `type` field (`"genre" | "mood" | "category"`) stays.

### Removed surfaces (deleted code)

- `src/components/TagsView.tsx`
- `src/components/tags/InboxCard.tsx`
- `src/components/tags/VocabularyPanel.tsx`
- `src/components/tags/HealthPanel.tsx`
- `src/components/TagIssuesView.tsx`
- `src/components/PendingChangesView.tsx`
- `src/components/RadioView.tsx`
- `src/components/GenreList.tsx`
- `src/components/YearView.tsx`
- `src/hooks/useTagPull.ts`, `src/hooks/useTagIssues.ts`
- Sidebar entries for tags, pending, issues, radio, genres, years

`pending_edits` and `edit_history` tables stay — used only by the manual override path via the tag drawer.

### Tag editing policy (revised)

`.claude/rules/tag-editing.md` rewritten. New policy:

- Normalization is display-only. Never writes files automatically.
- Manual edits (right-click chip → `Override this tag`) still go through `pending_edits` → sidecar → confirm dialog. This is the only path that writes files.
- "Never skip the diff" holds **for the manual override path only**.

---

## Setup — 3-step wizard with auto-detect

Replaces `AddServerModal.tsx`.

**Step 1 — Welcome**
What Canon does in plain English. `Continue` button.

**Step 2 — Connect your server**
Server type (Navidrome for now; Jellyfin / Plex visible but disabled with "coming soon"). URL, username, password. Inline `Test connection`. `Continue` enabled only on success.

**Step 3 — Enable tag editing (optional)**

> Canon can also clean up tags directly on your music files. To do this it needs a small helper service ("sidecar") running next to your music server. If you skip this, Canon still works as a player and shows normalized tags inside the app — your files stay untouched.

- `Auto-detect sidecar` — probes `http://<server-host>:8765/health` and a small list of common ports. If found, fills URL + prompts for shared secret.
- `Set up manually` — expands fields + shows copy-paste `docker run` command.
- `Skip for now` — proceeds without sidecar. Settings → Servers exposes sidecar setup later.

**Step 4 — Done.** "Library syncing in background — start listening." `Open Canon`.

### Settings additions

- `Servers` panel: list configured servers, edit URL / credentials / sidecar, remove. Closes the "no edit-server" gap.
- `Tags` panel: auto-refresh toggle, `Refresh now`, last-run timestamp.
- `Diagnostics` panel: sync status, scrobble queue depth, sidecar reachability — absorbs old HealthPanel.

---

## Visual redesign — Apple Music / Spotify direction

### Layout shifts

- Sidebar: labeled items (not icon-only). `192px` expanded (default), `48px` collapsed. Section label `LIBRARY` above the four items.
- Library album grid: cards `~140px → 180px`, softer shadows, hover lift, title + artist below.
- Album view: full-bleed blurred cover behind hero. 240px cover thumbnail. Artist as clickable subtitle. Track list with playing-indicator animation. Tags in three-column band, not inline editor.
- Artist view: hero with artist image (Last.fm), top-tracks rail, albums rail.
- Now Playing overlay: raise typography contrast, increase art size. Drop the tab switcher — one always-visible "Up Next" column.

### Theme + motion

Replace the single 3,872-LOC `App.css` with a token-based system:

- `src/styles/tokens.css` — CSS variables only: `--surface-0/1/2/3`, `--text-1/2/3`, `--accent`, `--accent-on`, `--radius-sm/md/lg`, `--motion-fast/med/slow`, `--shadow-1/2`.
- `src/styles/base.css` — resets + scrollbars only.
- Per-component CSS modules co-located with each component file. Migration is incremental during Phase 6.

Motion: 120ms ease-out on hover, 200ms on view changes, 240ms cubic on overlay open. `transform` and `opacity` only — no layout thrash.

Typography: keep Inter, 4 weights (400/500/600/700), tabular-numerics on track durations.

Album-art-derived `--accent`: extract dominant color from current track cover art → set on Now Playing overlay only. Subtle, not garish.

---

## Performance pass

Quick wins in order of impact:

1. `QueryClient` defaults: `staleTime: 60_000`, `refetchOnWindowFocus: false`. (`src/main.tsx`)
2. SQLite indexes: `tracks(album_id)`, `tracks(artist)`, `albums(artist)`, `tracks(genre)`. (`src/db/migrations.ts`)
3. Zustand selectors in `PlayerBar.tsx`, `QueuePanel.tsx` — no more full-store destructure; isolate `elapsed` to its own sub-component.
4. `useMemo` the `Set` constructions in `useLoved.ts`, `useTrackTags.ts`.
5. Virtualize `AlbumGrid` and `ArtistGrid` with `@tanstack/react-virtual`.
6. Gate `NowPlayingOverlay` queries on `isNowPlayingOpen` being true.
7. `React.lazy` for `SettingsView` and non-default views.
8. Stagger sync-finished query invalidations to avoid SQLite pile-up.

---

## Implementation phases

Each phase is a shippable unit tested by the user before moving on.

### Phase 1 — Sidebar cull and routing simplification

**Goal:** sidebar drops to 4 items; all deleted views removed; nothing orphaned.

- `App.tsx` view enum: keep only `library | artists | playlists | settings`. Remove all other branches.
- Delete sidebar entries for tags / pending / issues / radio / genres / years.
- Delete `GenreList.tsx`, `YearView.tsx`, `RadioView.tsx`, `TagsView.tsx`, `tags/*.tsx`, `TagIssuesView.tsx`, `PendingChangesView.tsx` and all references.
- Move genre + decade filtering into the Library header as chip dropdowns. `useAlbums` already supports genre filter — wire from header state instead of a dedicated view.
- `Ctrl+,` opens Settings (kept).
- Update `ARCHITECTURE.md`.

**Verify:** launch app, sidebar shows 4 labeled items, genre chip in library header filters correctly, no dead imports.

### Phase 2 — Radio context-menu + player chip

- New `src/components/ContextMenu.tsx` — lightweight right-click portal, no dependency.
- Wire into track row, album card, artist tile with `Start radio from this`.
- `usePlayerStore` gets `radioActive`, `radioSeed`. `useRadio` hook stays; its mount point moves to App-level (already partially there at `App.tsx:56`).
- New `src/components/RadioChip.tsx` in PlayerBar. Click → popover with seed info, `Change seed`, `Stop`.
- `radioActive` + `radioSeed` persisted in settings (survives restart).

**Verify:** right-click track → start radio → chip appears in PlayerBar → popover controls work → Stop clears chip.

### Phase 3 — Canon tree section field + bucket renderer

- Modify `scripts/parse-rym.mjs`: track current depth-0 header (Genres / Descriptors / Scenes & Movements), attach `section` to every emitted node.
- Run parser, regenerate `canon-tree.json`.
- Update `.claude/rules/genre-tree.md` to document `section`.
- New `src/lib/tag-buckets.ts`: pure function `bucketize(tagIds: string[]): { genres, descriptors, scenes }` using the canon tree.
- Migration v11: add `normalized_tags_json TEXT` + `computed_at INTEGER` to `albums`. Empty by default.

**Verify:** `node scripts/parse-rym.mjs` succeeds; spot-check 5 known genre nodes for correct `section`; `pnpm tsc --noEmit` clean.

### Phase 4 — Normalization pipeline (display-only)

- New `src/lib/tag-normalize.ts`: implements pull → merge → map → bucket → cap. Reuses `src/lib/genre-unify.ts` for fuzzy mapping and `src/lib/lastfm.ts` for fetch.
- New `src/hooks/useNormalizeAlbum.ts`: returns snapshot from DB; triggers background pipeline if `computed_at` stale/missing.
- New `src/hooks/useBackgroundNormalizer.ts`: fires on app launch, scans for stale albums, queues 1-per-2-seconds worker. Cancellable via setting.
- Settings → Tags panel: auto-refresh toggle (default on), `Refresh now` with progress bar, last-run timestamp.

**Verify:** open album → Last.fm calls fire (network tab) → `normalized_tags_json` written to DB → second open within 30 days makes no Last.fm calls. Toggle off auto-refresh → background worker stops.

### Phase 5 — Album / artist view rebuild

- `AlbumDetail.tsx` rewritten:
  - Hero with full-bleed blurred cover + 240px thumbnail.
  - Three-column tag band reading from `normalized_tags_json` via `useNormalizeAlbum`.
  - Tracklist without inline tag editor. Right-click track → `Show tags` opens drawer.
  - New `src/components/TagDrawer.tsx`: shows all three buckets with per-tag source/confidence. `Override` action → `pending_edits` → sidecar → confirm dialog (the only remaining file-write path).
- `ArtistDetail.tsx`: hero with Last.fm artist image, top-tracks rail, albums rail (existing hooks, new layout).
- Delete inline tracklist tag editor and all related state.

**Verify:** open a popular album (e.g., Radiohead — In Rainbows), three tag columns populate within 2s. Right-click chip → drawer shows source. Override → confirm dialog → sidecar writes → verify with `mutagen-inspect`.

### Phase 6 — Visual system migration

- Create `src/styles/tokens.css` and `src/styles/base.css`. Import in `main.tsx`, remove duplicates from `App.css`.
- Migrate components one by one to co-located CSS modules: `PlayerBar` → `QueuePanel` → `NowPlayingOverlay` → `AlbumGrid` → `AlbumDetail` → `ArtistDetail` → `SettingsView` → Library shell → Sidebar.
- Shrink `App.css` as components peel off. Target: <300 LOC (shell + global resets only) by end of phase.
- Apply motion: hover lifts on cards (120ms), view transition (200ms), overlay open (240ms cubic).
- Add album-art `--accent` on Now Playing: 30-line canvas pixel sampler, no external dep.

**Verify:** smoke test all views — hover lifts work, Now Playing accent changes per track, no layout jank on view switch.

### Phase 7 — Setup wizard + Settings → Servers

- New `src/components/setup/Wizard.tsx`: 4-step wizard as described, replaces `AddServerModal.tsx`.
- `probeSidecar(host: string)`: tries `http://host:8765/health` and 2–3 fallback ports. Uses existing Tauri fetch.
- Settings → Servers panel: list + edit + remove servers (uses existing `useServer` hooks, new UI only).
- Settings → Diagnostics panel: sync status, scrobble queue depth, sidecar ping (absorbs old HealthPanel content).
- Rewrite `.claude/rules/tag-editing.md` to reflect display-only normalization + manual-only override path.

**Verify:** fresh Tauri config (clear `~/.local/share/canon` or equivalent). Wizard appears. Complete all steps. Library syncs. Visit Settings → Servers → edit server credentials. Save → reconnects.

### Phase 8 — Performance pass

Apply the 8 quick wins listed above. Profile with React DevTools before and after.

Targets:
- AlbumGrid scroll: 60fps at 2,000 albums.
- View switch: <100ms.
- PlayerBar CPU: <5% while playing.
- Cold start to first frame: <2s.

### Phase 9 — Cleanup + v2.0.0 release

- Delete dead hooks/types no longer referenced: inbox, vocab, genre_mappings, tag_issues, health.
- Migration v12: drop `tag_inbox`, `genre_mappings`, `tag_issues` tables. Export their contents to a one-time JSON dump in the config dir before dropping (recovery escape hatch).
- `ARCHITECTURE.md` final pass.
- Update `CLAUDE.md` status section.
- Release: merge to main as `Canon v2.0.0` (major — IA breaking, new DB columns, file-write policy changed).

**Verify:** `pnpm tsc --noEmit` clean, `cargo check` clean, all CLAUDE.md manual checks pass.

---

## Critical files to modify

| File | Change |
|---|---|
| `src/App.tsx` | View enum → 4 items, sidebar cull, wizard mount |
| `src/components/AddServerModal.tsx` | Replaced by `setup/Wizard.tsx` |
| `src/components/AlbumDetail.tsx` | Full rewrite — hero + tag band + drawer |
| `src/components/ArtistDetail.tsx` | Hero + rails layout |
| `src/components/PlayerBar.tsx` | Radio chip, scrobble dot, Zustand selectors |
| `src/components/NowPlayingOverlay.tsx` | Drop tab switcher, `--accent`, higher contrast |
| `src/db/migrations.ts` | v11: `normalized_tags_json` + indexes; v12: drop dead tables |
| `src/lib/sync.ts` | Drop `scanForIssues`, drop `DEV_ALBUM_LIMIT` |
| `src/store/player.ts` | `radioActive` + `radioSeed` with persistence |
| `src/main.tsx` | QueryClient defaults, import tokens/base |
| `src/App.css` | Shrunk progressively to <300 LOC |
| `scripts/parse-rym.mjs` | Attach `section` field to nodes |
| `src/assets/canon-tree.json` | Regenerated |
| `.claude/rules/tag-editing.md` | Rewritten — display-only policy |
| `.claude/rules/genre-tree.md` | Document `section` field |
| `ARCHITECTURE.md` | Updated each phase |
| `CLAUDE.md` | Status section updated |

### New files

| File | Purpose |
|---|---|
| `src/components/ContextMenu.tsx` | Right-click portal |
| `src/components/RadioChip.tsx` | PlayerBar radio indicator + popover |
| `src/components/TagDrawer.tsx` | Tag source/confidence drawer + override path |
| `src/components/setup/Wizard.tsx` | 4-step onboarding wizard |
| `src/lib/tag-buckets.ts` | `bucketize()` pure function |
| `src/lib/tag-normalize.ts` | Full normalization pipeline |
| `src/hooks/useNormalizeAlbum.ts` | Per-album snapshot hook |
| `src/hooks/useBackgroundNormalizer.ts` | App-launch background worker |
| `src/styles/tokens.css` | Design tokens |
| `src/styles/base.css` | Resets + scrollbars |
| `src/components/*.module.css` | Per-component CSS (one per component, Phase 6) |

---

## Open items

1. **Album-art accent** — `colorthief` vs. 30-line canvas sampler. Decide in Phase 6. Prefer no extra dep.
2. **Last.fm rate limit** — background normalizer at 1 album/2s = 0.5 req/s, well within limits. Monitor if Last.fm adds album + artist calls per album (then 1 req/s, still fine).
3. **Migration v12 safety** — dump dropped table contents to JSON in config dir before `DROP TABLE`.
4. **Jellyfin / Plex** — visible but disabled in wizard Step 2. Real support is v3.
5. **`DEV_ALBUM_LIMIT`** — currently `15` in `src/lib/sync.ts:8`. Drop in Phase 1 (new users see full library).
