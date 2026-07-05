# Loving Tracks & Albums

## What it is

Lets you mark a track or album as a favorite ("love" it) with one click or the `L` key. Loved items sync to your Navidrome server (so they show up as "starred" there too, and survive across devices), and you can filter your library to loved-only.

## Entry points

- **Player bar** (`src/components/PlayerBar.tsx:394,527`) — heart icon next to the currently-playing track, both compact and expanded layouts.
- **Now Playing view** (`src/components/NowPlayingView.tsx:529`) — heart button in the transport row, `now-playing-love-btn`.
- **Album detail page** (`src/components/AlbumDetail.tsx:838`) — heart icon on each track row (`track-heart`).
- **Album grid** (`src/components/AlbumGrid.tsx:81`) — heart overlay on each album card (`album-heart`), loves the whole album.
- **Filter sidebar** (`src/components/FilterSidebar.tsx:71`) — "loved only" toggle button (`filter-sidebar-loved`) filters the library view to only loved albums/tracks.
- **Keyboard shortcut**: `L` — loves/unloves the currently playing track, from anywhere in the app (not while typing in a text field). `src/hooks/useGlobalShortcuts.ts:59`.

## Step by step

1. Click a heart icon (player bar, Now Playing, album detail track row, or album card), or press `L` while a track is playing.
2. Heart fills solid immediately (optimistic — no waiting on network).
3. In the background, Canon calls Navidrome's `star.view`/`unstar.view` Subsonic endpoint. If that call fails (offline, bad credential), the local loved state does **not** roll back — you stay "loved" locally even if the server never received it (see Gotchas).
4. Loved albums appear in Home view's favorites row (`HomeView.tsx:920`) — this includes both albums loved directly and albums that are loved by virtue of having at least one loved track (`lovedTrackAlbumIds`).
5. Toggling "loved only" in the Filter Sidebar restricts the library view to loved albums/tracks only.

## Edge cases / gotchas

- **Fire-and-forget network calls**: `toggleTrackLove`/`toggleAlbumLove` write to local SQLite and invalidate the query immediately, then call the Navidrome star/unstar endpoint without awaiting or reconciling failure — errors are only `console.error`'d (`src/hooks/useLoved.ts:68-75, 90-97`). A failed star call leaves local and server state silently out of sync until the next full sync overwrites local state from the server (see below) — at which point the "love" can be lost if the star.view call never actually reached the server.
- **Sync overwrites local loved state from server truth**: every library sync calls `getStarred2` and does a full `DELETE` + re-`INSERT` of `loved_albums`/`loved_tracks` for that server, replacing local state with whatever Navidrome reports as starred (`src/lib/sync.ts:204-226`). This runs independent of incremental sync skip logic, so it always executes on every sync pass.
- **Album loved state has two sources**: an album can show as loved either because the album itself is starred (`loved_albums`), or because at least one of its tracks is loved (`lovedTrackAlbumIds`, derived via a join in `useLoved.ts:39-49`). Home view treats these differently for its "Recently Loved" strip (`HomeView.tsx:931-940`).
- React Query note: `useLoved` deliberately returns `string[]` (not `Set`) from its queryFns, converting to `Set` only via `useMemo` after — returning a `Set` directly breaks React Query's structural-sharing diffing (see [[feedback-rq-set-bug]] memory).

## Implementation

- **Hook**: `src/hooks/useLoved.ts` — `useLoved()` exposes `lovedTrackIds`, `lovedAlbumIds`, `lovedTrackAlbumIds` (all `Set<string>`), plus `toggleTrackLove(trackId, serverWithCred)` / `toggleAlbumLove(albumId, serverWithCred)`.
- **DB tables**: `loved_tracks (track_id PK, loved_at)`, `loved_albums (album_id PK, loved_at)` — created in `src/db/migrations.ts:112-120`. IDs are prefixed `${server.id}:${nativeId}`.
- **React Query keys**: `QK.loved_tracks()`, `QK.loved_albums()`, `QK.loved_track_albums()` (`src/lib/query-keys.ts`), all `staleTime: Infinity` (invalidated manually on toggle/sync, not polled).
- **Navidrome/Subsonic calls**: `starTrack`/`unstarTrack`/`starAlbum`/`unstarAlbum` in `src/lib/navidrome.ts:321-358`, thin wrappers over `star.view`/`unstar.view`.
- **Sync**: `fetchStarred2` (`getStarred2` Subsonic call) + full local overwrite in `src/lib/sync.ts:204-226`; invalidated post-sync in `src/hooks/useLibrarySync.ts:45-46`.
- **Radio**: "Loved" is one of Radio's 8 modes — queries `loved_tracks` directly (`src/lib/radio.ts:306-311`, `src/store/player.ts:36-46,1362`); see docs-tech/06-radio-auto-dj.md.
- **Other UI surfaces**: Artist detail "Favorites" section filters an artist's top tracks down to loved ones (`src/components/ArtistDetail.tsx:450,464-466,687-720`); Home view has a dedicated "Loved" spotlight carousel (`src/components/HomeView.tsx:965,1120`); Now Playing's Up Next queue rows show a loved indicator (`NowPlayingView.tsx:673-675`).
- **Filter state**: "loved only" toggle lives in Zustand (`src/store/libraryFilters.ts` — `lovedOnly`/`toggleLovedOnly`), wired through `src/App.tsx:238-289,655-673,827-846`.

## Open questions

- No visible UI surfaces a failed star/unstar network call to the user (console-only) — unconfirmed whether this is intentional or a gap.
- Whether there's any retry/reconciliation for failed star calls before the next full sync overwrites local state — not found in code; appears there is none.
