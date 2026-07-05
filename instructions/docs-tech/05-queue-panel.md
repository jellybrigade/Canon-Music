# Queue Panel

## What it is

Lets you see and manage everything about to play — reorder tracks, jump to any of them, or remove ones you don't want, without leaving what you're doing.

## Entry points

- **Player bar → "Queue" button** (list icon, right side of player bar, `src/components/PlayerBar.tsx:464-471`) — toggles a resizable side panel titled `Queue (N)`.
- Tracks land in the queue via right-click context menus elsewhere in the app: album detail tracklist, track table view, playlist detail, and "Play next" / "Add to queue" buttons on Now Playing radio suggestion cards.

## Step by step

1. Click the **Queue** icon in the player bar. A panel titled `Queue (N)` slides in on the right (`src/components/QueuePanel.tsx`), sized between 200–500px (default 280px), draggable via a resize handle on its left edge (width persisted to `queue.panel_width` setting).
2. Each row shows position number (or a play icon if it's the currently-playing track), cover art thumbnail, title, and artist.
3. **Click a row** → jumps to and plays that track immediately.
4. **Drag a row** (grip handle) → drop it elsewhere to reorder the queue. Disabled when: queue has more than 300 tracks, the filter box has text, or you have items multi-selected.
5. **Ctrl/Cmd+Click** → toggle a track into a multi-select. **Shift+Click** → select a range from the last-clicked row. Header shows `N selected` while active; an X button clears selection.
6. **Delete / Backspace** with a selection active removes all selected tracks (ignored if focus is inside a text input).
7. **Escape** clears the current selection.
8. **Right-click a row** → context menu:
   - Multiple selected: **"Remove N tracks"** (danger-styled).
   - Single track: **"Move to Top"** (hidden if already first), **"Play Next"** (hidden if it's already the next-up track), **"Move to Bottom"** (hidden if already last), a **"Start radio"** submenu (jumps to that track then starts radio in the chosen mode — Curated, Same Genre, Similar Artists, Same Artist, Same Album, Same Era, Loved Tracks, Random), and **"Remove"** (danger-styled).
9. A filter box (`Filter queue…`) at the top narrows the visible list by title/artist match. While filtering, drag-to-reorder and multi-select are both disabled — filtering only lets you find and click/remove.
10. Close via the X button in the header, or the Queue button again.

## Edge cases / gotchas

- Queue rendering is virtualized (`@tanstack/react-virtual`) — smooth even with very large queues, but drag-to-reorder is capped at 300 tracks (`DND_MAX_QUEUE`) to avoid perf issues; beyond that, use the context menu's Move to Top/Bottom or filter+remove instead.
- When shuffle is on, the panel displays tracks in shuffled order (`shuffleOrder` mapping) — row "position" numbers reflect play order, not underlying queue array index.
- The queue is synced to the Navidrome server (Subsonic `savePlayQueue`/`getPlayQueue`) so it can restore across devices/sessions — saves are debounced 10s and also fire on visibility change. If you close the app immediately after big queue edits, the last few seconds of changes might not sync before the debounce fires (mitigated by the visibility-change save, but worth knowing).
- Selection state resets whenever the queue's length changes (e.g., a track finishes and is trimmed, or you add more tracks) — don't expect a multi-select to survive queue mutations.

## Implementation

- **Component**: `src/components/QueuePanel.tsx` (list rendering, DnD, selection, context menu), styled in `QueuePanel.css`.
- **Trigger**: `src/components/PlayerBar.tsx:464-471` (`toggleQueue()`).
- **Zustand store** (`src/store/player.ts`):
  - State: `queue: CurrentTrack[]`, `queueIndex: number`, `isQueueOpen: boolean`, `isShuffled: boolean`, `shuffleOrder: number[]`.
  - Actions: `addToQueue(track, streamUrlFn)` (:1166), `playNext(track, streamUrlFn)` (:1178), `toggleQueue()` (:1194), `removeFromQueue(position)` (:1202), `removeManyFromQueue(positions)` (:1242), `playFromQueueIndex(position)` (:1285), `moveQueueItem(from, to)` (:1294).
- **Cross-device sync**: `src/hooks/useQueueSync.ts:8-150` — restores queue via `getPlayQueue` on first server connect, saves via debounced `savePlayQueue` (10s + on visibility change).
- **Other entry points** that feed the queue: `src/components/AlbumDetail.tsx:902-917` (track context menu — Play Now / Play Next / Add to Queue / Start radio), `src/components/TrackTableView.tsx:399,405`, `src/components/PlaylistDetail.tsx:551,554`, `src/components/NowPlayingView.tsx:746,753,795,802,929-930` (radio suggestion cards).
- Right-click menus use the shared `ContextMenu` component, which has a known WebKitGTK left-click race fix (deferred `mousedown` listener) — see `.claude/rules/known-issues.md`. Not queue-specific, but the queue's context menu relies on the same fixed component.

## Open questions

- Whether queue sync conflicts (editing queue on two devices near-simultaneously) have defined resolution behavior — not found in code reviewed; likely last-write-wins via debounced save, unverified.
