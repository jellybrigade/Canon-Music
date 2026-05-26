# Canon — Audit

Findings from a code + UX pass over `src/`, `src-tauri/`, `sidecar/`, and product docs. Severity tiers: **Critical** = data-loss or security risk, **Major** = visible UX or correctness defect, **Minor** = friction/polish, **Nit** = cosmetic.

---

## UI defects

### U1. Last.fm API key input looks broken — `src/components/SettingsView.css:47-52`
```css
.settings-field input {
  opacity: 0.55;
  cursor: not-allowed;
}
```
Selector matches **every** `input` in `.settings-field`, not just the disabled sidecar ones. Last.fm API key, staleness number field, and pull-mode radio buttons all render at 55% opacity with `not-allowed` cursor. They are not disabled — typing works — but every visual signal says the app is broken.
**Fix:** change to `.settings-field input:disabled`.

### U2. Z-index ladder has collisions — `App.css`
- NowPlayingOverlay: `z-index: 300` (`App.css:993`)
- PullModeModal / context menu / toast: `z-index: 200` (`App.css:1658, 3352`)
- Misc overlays: `z-index: 100` (`App.css:359, 784, 2979`)
- QueuePanel: `z-index: 50` (`App.css:1703`)

Three unrelated things share 200; order depends on mount order. No scale — just magic numbers.
**Fix:** define `--z-dropdown`, `--z-overlay`, `--z-modal`, `--z-toast` CSS vars on `:root`; replace all raw numbers.

### U3. Sidebar icons at 40% opacity, 18px, icon-only — `App.css:218-251`
Inactive nav items render at `opacity: 0.4`. Combined with 18px lucide glyphs and the nearly-identical `<Tag>` (Genres) vs `<Tags>` (Tags) icons, this is illegible at a glance. Ten destinations with no labels.
**Fix:** raise inactive opacity to ~0.65; add 12px text labels or widen sidebar to ~96px icon+label layout.

### U4. Disabled-input styling is inconsistent and duplicated
- Global: `button:disabled { opacity: 0.45; cursor: default; }` (`App.css:102`)
- Per-component: three more copies of the same rule (`App.css:1566, 3205, 3233, 3321`)
- Sidecar inputs: browser `:disabled` default, then U1 selector layers on top (double-dimmed)
- No global `input:disabled` rule at all

**Fix:** add one `input:disabled { opacity: 0.45; cursor: not-allowed; }` global rule; delete the duplicates.

### U5. No focus indicator on inputs — `App.css:91`
`outline: none` removed with nothing replacing it. Keyboard users get no visible focus ring.
**Fix:** `input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-subtle); }`

### U6. Input background transitions snap — `App.css:89`
`transition: border-color 0.15s, opacity 0.15s` but no `background-color`. Tag-editor input focus state changes snap.
**Fix:** add `background-color 0.15s` to the global input transition.

### U7. `padding-bottom` magic number tied to PlayerBar — `App.css:212`
`padding-bottom: 80px` on `.sidebar` is 8px off from the actual PlayerBar height of 72px (`App.css:259`). Also declared separately on `.library`, `.content-placeholder`. Three places encoding the same dimension.
**Fix:** `--player-bar-height: 72px` CSS var used by all three.

### U8. ~50 redundant `cursor: pointer` declarations on `<button>` selectors — `App.css`
Global `button { cursor: pointer; }` (`App.css:94`) already handles this. Every component re-declares it on button-targeting selectors.
**Fix:** remove `cursor: pointer` from any CSS rule whose selector targets a `button` element.

### U9. All transitions are 150ms — `App.css:178–194, 232, 260, 272`
Sidebar nav swaps, hover highlights, modal opens — all 150ms. Modal/overlay entrances have no `from` state (no transform/opacity start) so they don't actually animate; they just appear.
**Fix:** 80ms for hover states, 150ms for in-place updates, 200ms + transform for modal/overlay opens.

### U10. Mixed unicode characters vs lucide icons
- `✕` close in `PendingChangesView`, `QueuePanel`
- `▶` Play Album in `AlbumDetail`
- `⠿` drag handle in `QueuePanel`

These render in the OS emoji font and look wrong next to lucide strokes.
**Fix:** `<X size={14}/>`, `<Play/>`, `<GripVertical/>`.

### U11. Accessibility near-zero
30 aria/role/tabIndex usages total in the entire codebase. Album cards are clickable `<div>`s, not buttons. Context menus have no `role="menu"`. TagsView tabs are likely plain divs. No keyboard activation for drag-to-reorder.
**Fix:** at minimum: `role="button" tabIndex={0} onKeyDown={enter→click}` on album/track cards; `role="menu"` + `role="menuitem"` on context menus; ARIA roles on TagsView tabs.

### U12. `console.log` in production path — `src/lib/sync.ts:88`
```ts
console.log(`sync: skipped ${skippedAlbums} unchanged album(s)`);
```
**Fix:** delete.

---

## Critical

### C1. SQL injection in radio CTE — `src/lib/radio.ts:93-96`
`cteParts` builds `VALUES ('${id.replace(/'/g,"''")}', ...)` from canonical IDs that include `user_tree_nodes.id`. Manual single-quote escaping is not parameterization.
**Fix:** bind via `?` params (one row per weight), or validate id charset `^[a-z0-9_-]+$` before use.

### C2. Sync has no transactions — `src/lib/sync.ts:92-137`
`DELETE FROM artists` then rebuild, FTS rebuild, `loved_*` delete-then-reinsert — all outside any `BEGIN`/`COMMIT`. Crash mid-phase = partial data. No `withTx` helper exists anywhere.
**Fix:** wrap each phase in a transaction; add a `withTx(db, fn)` helper.

### C3. ID-prefix stripping fragile — `src/hooks/useRadio.ts:42`
`currentTrack.id.split(":")[0]` breaks if `server.id` contains `:`. `src/lib/ids.ts` exists for this.
**Fix:** use `stripServerPrefix` everywhere; audit for other `.split(":")` callsites.

### C4. Keychain JSON parse unguarded — `src/lib/sync.ts:9-10`
`JSON.parse(credJson)` with no null/error guard. Linux keychain fallback may return empty; sync silently aborts.
**Fix:** try/catch; surface as sync error.

---

## Major — UX

### M1. Dead Settings UI — `src/components/SettingsView.tsx:66-94`
Sidecar section: four `disabled` inputs that already exist (and work) in `AddServerModal`. Plus "Server management coming in Goal 7c" in a shipped release.
**Fix:** delete the dead Sidecar and Servers sections from SettingsView entirely.

### M2. Tag inbox is session-only — `src/store/tags.ts`
Inbox is in-memory Zustand. App restart mid-review → diff gone, re-pull from Last.fm. The diff-rule requires `pending_edits → confirm`; it doesn't require in-memory inbox to be separate.
**Fix:** persist inbox state to SQLite — add a `status` column to `pending_edits` (`inbox` / `staged` / `applied`). Keeps the mandated double-confirm, stops losing work to a restart.

### M3. Tag actions in four places — `src/components/AlbumDetail.tsx:213-231`
Last.fm pull + Canonize in: AlbumDetail header, AlbumDetail right-click menu, HealthPanel, TagsView. The two header buttons differ in pull mode (`pullModeDefault` vs hardcoded `"review"`) with no indication.
**Fix:** one entry point per surface — context menu for per-album, HealthPanel for batch. Merge or remove the header buttons.

### M4. PullModeModal is a modal for a setting — `src/components/tags/HealthPanel.tsx:13-31`
Modal asks for a binary that's already in Settings. "Remember for this session" checkbox is never read (`remember` value unused).
**Fix:** kill the modal. Honor Settings default; Shift-click for the other mode. Delete the dead checkbox.

### M5. 10-item sidebar, three items for one workflow — `src/App.tsx:156-167`
Tags / Issues / Pending are separate top-level destinations. TagsView already has three sub-tabs.
**Fix:** fold Pending and Issues into TagsView (4th and 5th tabs). Net sidebar: 7 items. Gains room for labels.

### M6. Navigating sidebar loses your place — `src/App.tsx:174-181`
`navigateTo` resets all selection state. Click sidebar mid-browse = start over. No back navigation.
**Fix:** persist per-view selection; at minimum don't reset state when re-entering the current view.

### M7. Startup looks frozen — `src/App.tsx:209-246`
`if (serversLoading) return null` = blank window during keychain load. Empty albums grid during first sync has a tiny "Syncing…" string in the header — looks like a bug.
**Fix:** splash screen during keychain load; skeleton grid + progress count ("Synced 143 / 800 albums") during first sync.

### M8. Undiscoverable affordances
- Track context menu is the **only** way to reach Play Next / Add to Queue / Edit tags (`AlbumDetail.tsx:339-393`). No hover buttons, no visible trigger.
- Sidecar config in `AddServerModal` is inside `<details>` collapsed by default. Users skip it → "Edit tags" silently disabled forever.
- `PendingChangesView` empty state tells the user to "Right-click a track in Album Detail" — right-click is invisible on touchpads.
**Fix:** hover kebab `⋯` on track rows; expand sidecar section by default; inline AlbumDetail banner when sidecar not configured.

### M9. RadioView is mostly empty — `src/components/RadioView.tsx:28-36`
One button ("Start from current track"), dead-end if nothing is playing.
**Fix:** fold into NowPlayingOverlay; or add seed-from-album/artist entry points here.

### M10. Destructive ops with no confirm
- "Remove mapping" in VocabularyPanel fires immediately (`VocabularyPanel.tsx:132-141`).
- "Reject All" in Pending loops sequential `await delete` with no confirm, no error handling. Mid-loop failure = half-rejected, no message (`PendingChangesView.tsx:188-194`).
**Fix:** confirm dialogs; batch "Reject All" as a single mutation.

---

## Major — Code / Correctness

### M11. Sync rebuilds artists on every run — `src/lib/sync.ts:92-99`
Full `DELETE FROM artists` + rebuild on every sync, regardless of incremental-skip. Negates the optimization.
**Fix:** delta rebuild — only update artists touched by changed albums.

### M12. `applyInboxItem` is N+1 — `src/hooks/useTagPull.ts:103-153`
200 individual `INSERT OR REPLACE` per album (20 tracks × 10 tags), no transaction.
**Fix:** batch inside a single transaction.

### M13. Canon tree kind-filter recomputed per call — `src/lib/canonicalize.ts:121,165`
`tree.nodes.filter(n => n.kind === kind)` runs on every `findCanonical` invocation. Inbox builds for one album call this ~50 times.
**Fix:** cache kind-partitioned arrays on `getCanonTree`.

### M14. Player polls at 5Hz, re-renders every tick — `src/store/player.ts:112-134`
`set({ elapsed })` on every 200ms interval. All Zustand subscribers re-render.
**Fix:** narrow elapsed subscription (selector), or throttle `elapsed` UI updates to 1Hz while keeping 200ms internal precision.

### M15. Stale `streamUrlFor` closure in useRadio — `src/hooks/useRadio.ts:35-90`
`streamUrlFor` read inside effect but not in deps. Effect also fires on every queue push (any add to queue).
**Fix:** ref for `streamUrlFor`; narrow deps to `[radioActive, queueDepth, currentTrackId]`.

### M16. Scrobble errors swallowed — `src/hooks/useScrobbleFlush.ts:33-35`
`catch {}` → `break` with no user signal.
**Fix:** distinguish network failure vs. permanent error; surface state.

### M17. Edit-to-blank check broken — `src/components/AlbumDetail.tsx:169-170`
`oldValue || null` converts empty string to null; `original[key]` may be empty string. Blanking a field may not register as a change.
**Fix:** `oldValue === "" ? null : oldValue` consistently, or compare both sides after normalization.

### M18. Canonical ID picked by lexical max — `src/hooks/useTagMappings.ts:128-129`
`MAX(tt.canonical_id)` is arbitrary. Picks the alphabetically last canonical when multiple exist.
**Fix:** `COUNT(*) DESC LIMIT 1` subquery to pick most-used.

### M19. Rust HTTP no timeout — `src-tauri/src/lib.rs:103,179`
`reqwest::blocking::get(&url)` no timeout. Hanging server stalls audio thread.
**Fix:** `Client::builder().timeout(Duration::from_secs(30)).build()`.

### M20. Sidecar path-remap no traversal check — `src/lib/sidecar.ts:23-29`
`startsWith` check only. `to = "../"` traverses out. Server-side guards exist, but client should validate.
**Fix:** normalize both paths; verify `remapped` still descends from an allowed root.

---

## Minor

- **AddServerModal two-step Save + Test** — auto-test on Save, block only on real error (`AddServerModal.tsx:73-85`).
- **Two test state machines for connection + sidecar** — one sequential "Test" button.
- **HealthPanel batch pull: no progress, no cancel** (`HealthPanel.tsx:43-58`).
- **VocabularyPanel CanonCombobox always `value=""`** (`VocabularyPanel.tsx:67-69`) — existing mapping not pre-filled.
- **No keyboard nav on VocabularyPanel virtual scroll** (`VocabularyPanel.tsx:154-168`).
- **GenreList sidebar duplicates Library header genre filter** — one or the other.
- **YearView duplicates `sort: "year"`** — add decade-timeline visual to justify separate view, or fold to sort option.
- **`useMediaSession` action handlers registered twice** — once in App, again in PlayerBar (`PlayerBar.tsx:34-44`).
- **NowPlayingOverlay dismisses on any backdrop click** (`NowPlayingOverlay.tsx:144`) — easy mis-dismiss reading lyrics.
- **Rescan button only on Library view** — move to global header or sidebar footer.
- **Library header overcrowded** (`App.tsx:405-475`) — title + server + sync + 4 sort + search + genre filter + loved filter + rescan in one bar.
- **Dynamic `await import(canonicalize)`** in `useTagMappings.ts:5-7,175` — no code-split boundary exists here; make static.
- **Dead `albums.album_artist` column** — declared in migrations, never written by sync.
- **`migrations.ts`: `genre_mappings` created then dropped in next migration** — squash.
- **`stageGenrePendingEdits` and `stageGenreEditsForRawValue` duplicate ~70% logic** (`useTagPull.ts`, `useTagMappings.ts`) — extract.
- **`findCanonical` and `findCanonicalSync` duplicate logic** (`canonicalize.ts:149-189`).

---

## Nits

- Font sizes 10–11px on labels/badges (`App.css` lines 312, 373, 418, 510, 643, 858, 938, 1205, 1363, 1407) — minimum 12px for legibility.
- Icon sizes 12–13px in several places — bump to 14–16px.
- Library view title is "Canon" (app name); all other views show the view name.
- `style={{ width: 80 }}` inline in SettingsView — use CSS.
- TagIssuesView empty state says "Run a rescan" but has no rescan button.
- `ARCHITECTURE.md` lists `tag_issues` table twice.
- `plan.md:23` "thin Rust layer (file I/O and audio only)" — Rust does no file I/O in v1; the sidecar handles that.

---

## Stray files

| File | What to do |
|---|---|
| `HANDOFF.md` | 2 lines pointing at other files — delete |
| `what-to-do.txt` | Scratch notes — file as issues or delete |
| `RateYourMusic Hierarchy.txt` | Keep for re-running parse-rym.mjs; move to `scripts/data/` |

---

## God files (>400 lines)

| File | Lines | Problem |
|---|---|---|
| `src/App.tsx` | 684 | Router + sidebar + header + sync trigger + global shortcuts all in one |
| `src/store/player.ts` | 488 | Extract `persistQueueState`, shuffle helpers, settings persistence |
| `src/components/NowPlayingOverlay.tsx` | 417 | Split tabs into subcomponents |
| `src/lib/navidrome.ts` | 404 | Extract `callSubsonicJson<T>` to collapse 8 near-identical fetch functions |
| `src/components/AlbumDetail.tsx` | 395 | Extract `<TrackEditor>` and `<TrackContextMenu>` |

---

## Suggested action order

1. **U1** — 2-line CSS fix; the Last.fm input is the first thing users touch and it's visually broken.
2. **C1–C4** — security + data safety, no UX change.
3. **C2 + M12** — transactions; correctness.
4. **M1** — delete dead Settings UI; trivial.
5. **M5** — collapse sidebar; reduces cognitive load for everything else.
6. **M2** — persist inbox; stops data loss on restart.
7. **M3, M4, M8** — UX polish pass.
