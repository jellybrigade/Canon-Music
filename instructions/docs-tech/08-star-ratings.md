# Star Ratings (1–5)

## What it is

Lets you rate the currently playing track 1–5 stars, right from the player bar. Rating is stored on your Navidrome server (via Subsonic API), not in Canon's local database — so it's visible in any Subsonic client, not just Canon.

## Entry points

Player bar (bottom of window) → right section, next to the heart/love button → row of 5 star icons. Only shown when a track is currently loaded (`currentTrack && serverWithCred`) and the window is wide enough (`player-stars--hide-narrow` class hides the row on narrow window widths, same pattern as other player-bar controls).

No menu, no modal — it's always-visible inline control.

## Step by step

1. Play a track. Star row appears in player bar next to the love (heart) button.
2. Hover over stars — preview fill shows what rating a click would set (`hoverRating` state overrides display while hovering, `src/components/PlayerBar.tsx:404`).
3. Click a star (e.g. 3rd star) → track rated 3. Filled stars update instantly (optimistic, no wait for server).
4. Click the star matching the *current* rating again → rating clears back to 0 (unrate). `handleStarClick` treats `star === trackRating` as "clear" (`src/components/PlayerBar.tsx:211`).
5. After 200ms of no further clicks, rating is sent to server (`setRating.view`). Debounced so rapid re-clicks (misclick correction) don't spam requests.
6. If the server write fails, the query is invalidated and refetched — so a failed write reverts the optimistic star display back to server truth (`src/components/PlayerBar.tsx:216-217`).
7. Switching tracks: rating for the new track is fetched fresh (`fetchTrackRating` via `getSong`, `staleTime: Infinity` — cached per track until invalidated).

## Edge cases / gotchas

- **Rating is server-side only.** No `rating` column in Canon's SQLite schema — nothing to migrate/back up locally. If Navidrome is unreachable, the optimistic UI update still shows but silently reverts once the failed write refetches truth.
- **No keyboard shortcut.** Space/arrows/L (love) are the only playback shortcuts; stars are mouse/click-only.
- **Only visible in the player bar.** Rating does not appear anywhere else — not on album cards, track tables, AlbumDetail, or NowPlayingView. If you want to see a track's rating outside the player bar, there's currently no other surface for it.
- **Narrow-window hiding.** On a narrow window the star row is hidden entirely (`player-stars--hide-narrow`), not shrunk — so a user resizing the window down loses the ability to rate without realizing the control just disappeared.
- Clicking the currently-set star clears the rating (toggle-off) — not obvious from the UI; there's no explicit "clear rating" affordance otherwise.

## Implementation

- `src/lib/navidrome.ts:361` — `setRating()`: POST `setRating.view` with `id`, `rating` (0–5 as string).
- `src/lib/navidrome.ts:372` — `fetchTrackRating()`: GET `getSong`, reads `userRating` field off response, defaults to 0.
- `src/components/PlayerBar.tsx:117-129` — `useQuery` keyed `QK.trackRating(nativeTrackId)` (`src/lib/query-keys.ts:55`), `staleTime: Infinity`.
- `src/components/PlayerBar.tsx:110-111` — `hoverRating` state + `ratingDebounce` ref (200ms).
- `src/components/PlayerBar.tsx:209-220` — `handleStarClick`: optimistic `queryClient.setQueryData`, debounced `setRating` call, invalidate-on-failure.
- `src/components/PlayerBar.tsx:399-418` — star row markup, 5 `<button>`s, `lucide-react` `Star` icon, `aria-label`/`title` = `"Rate N star(s)"`.
- `src/components/PlayerBar.css:385-408` — `.player-stars` / `.player-star-btn` styling (opacity 45% unfilled, accent on hover/filled).

## Open questions

- No unit tests cover rating behavior — untested by the existing test suite (none found for this feature).
- No `.claude/rules/known-issues.md` entry exists for ratings; nothing platform-specific documented.
