# Search

## What it is

Lets you jump straight to any album, artist, or track in your library by typing a few letters — instead of scrolling grids or browsing by genre/year.

## Entry points

- **Search button** in the library header toolbar: labeled "Search…" with a magnifying-glass icon, tooltip "Search (Ctrl+F)" (`src/App.tsx:809-816`).
- **Keyboard shortcut**: `Ctrl+F` (or `Cmd+F` on macOS) opens the search bar and focuses it from anywhere in the app (`src/App.tsx:360-367`).
- Opening search swaps the whole library content area to a dedicated "Search" view — header title changes to "Search", a close (X) button appears at the right (`src/App.tsx:683-690`).
- Separate from this: `Ctrl+K` / `Cmd+K` opens the **Command Palette** (`src/components/CommandPalette.tsx`), which uses the same search hook internally but shows a capped 5-per-type quick-jump list in an overlay, not the full grouped results view. They are two different UI surfaces sharing one data source.

## Step by step

1. Press `Ctrl+F` or click "Search…" in the header. The search bar opens with an input focused and pre-selected (any existing text is selected for easy overwrite).
2. Type a query. Input updates instantly, but the actual DB search fires 200ms after you stop typing (debounced) — brief "Searching…" empty state shows while waiting.
3. Results appear grouped in three sections, in this order: **Artists**, **Albums**, **Tracks**. Each section only renders if it has ≥1 match.
4. Each section initially shows a capped number of rows: 12 artists, 12 albums, 16 tracks. If there are more, a "Show all N artists/albums/tracks" button appears at the bottom of that section — click to reveal the rest in place (no pagination/infinite scroll).
5. Click a result:
   - **Artist row** → navigates to that artist's page, closes search.
   - **Album row** → opens the album detail page.
   - **Track row** → plays that track immediately.
6. Right-click a result for a context menu:
   - Artist/Album → "Start Radio" submenu (radio modes).
   - Track → "Play" + "Start Radio" (radio seeded from the track's album).
7. Clear the search via the X button next to the input, the X button at the top-right of the Search header, or press `Escape` (works whether the input has text or the panel is just open).

## Edge cases / gotchas

- No results shows a plain "No results" empty state (`SearchResults.tsx:87-93`) — no suggestions or fuzzy fallback.
- Matching uses SQLite FTS5 prefix search per whitespace-split token (each word becomes `"word"*`), so it only matches from the **start** of a word, not arbitrary substrings — mid-word typos or partial-middle matches won't hit until scoring's substring fallback kicks in (tier below word-prefix, still requires FTS to have found the row via a prefix hit first). Practical effect: FTS5 recall gates everything; the JS scoring below only reranks/filters what FTS already returned.
- Ranking is done in JS after the FTS query, not by SQLite: exact match (1000) > starts-with (800) > word-starts-with (600) > plain substring (300) > 0 (dropped). Artist/album cross-matches (e.g. album matched via its artist name) are down-weighted ×0.6 (`useSearch.ts:101,107`).
- Artist search results dedupe "Artist feat. Other Artist" credit-strings against the plain artist name already in the result set, so a featured-artist credit line doesn't clutter the Artists group if the primary artist already matched (`useSearch.ts:112-126`).
- Double-quote characters in the query are stripped before building the FTS expression (prevents breaking FTS5 MATCH syntax) — searching for a quoted phrase won't do literal phrase matching, each word still matches independently.
- Each result category query is capped at 200 rows fetched from SQLite before JS scoring/sorting — an extremely broad query (e.g. a single common letter) won't return more than 200 raw candidates per type even before the UI's 12/12/16 display cap.
- React Query caches results per exact query string for 10s (`staleTime: 10_000`, `useSearch.ts:137`) — retyping the same string quickly won't re-hit the DB.

## Implementation

- **State**: `searchRaw` (live input), `searchQuery` (debounced value that actually triggers the query), `searchOpen` (panel visibility) — all in `src/App.tsx:299-301`.
- **Debounce**: `handleSearchChange()` sets a 200ms timeout before committing `searchQuery` (`App.tsx:340-344`).
- **Clear/close**: `clearSearch()` resets both state values, closes the panel, blurs the input (`App.tsx:346-351`).
- **Keyboard**: global `keydown` listener for `Ctrl/Cmd+F` (open+focus+select) and `Escape` (clear) (`App.tsx:353-374`); `Ctrl/Cmd+K` toggles Command Palette in the same listener.
- **Search bar render**: `renderSearchBar()` (`App.tsx:610-629`); full-page swap logic in `renderContent()` (`App.tsx:679-690`) and `renderLibraryContent()` (`App.tsx:631-649`, used for the home-view inline variant).
- **Query hook**: `useSearch(query)` in `src/hooks/useSearch.ts:131-139` — thin `useQuery` wrapper, `enabled` only when trimmed query is non-empty.
- **Core search fn**: `runSearch()` (`useSearch.ts:60-129`) — three parallel SQLite queries against the `tracks_fts` FTS5 virtual table (joined to `tracks`/`albums`/`artist_identity`), then JS-side `scoreMatch()` reranking (`useSearch.ts:49-58`).
- **FTS5 table**: created in schema migration v5, `tokenize='unicode61'`, columns `title, artist, album, genre` (id unindexed) — `src/db/migrations.ts:126-134`.
- **Results UI**: `src/components/SearchResults.tsx` — grouped sections, per-group "show all" state (`showAllArtists/Albums/Tracks`), context menus via shared `ContextMenu` + `StartRadioSubmenu` components.
- **React Query key**: `QK.search(trimmed)` — `src/lib/query-keys.ts:24`.
- **Command Palette**: `src/components/CommandPalette.tsx:73` reuses `useSearch` for its quick-jump list, capped to 5 results per type — separate component, separate cap, separate trigger (`Ctrl+K`).
- **Styling**: `src/styles/library.css:278-356` (search bar/trigger button), `src/components/SearchResults.css` (grouped result rows, thumbnails, show-all buttons).

## Open questions

- Whether the home-view inline search (`homeSearchRaw`/`homeSearchQuery`, `App.tsx:306-311`) is a fully separate search surface from the header one, or feeds the same results view — not traced in this pass; worth a follow-up doc item if Home view search behaves differently from the header search documented here.
