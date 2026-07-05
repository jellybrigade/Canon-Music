# Right-click menu on playlist grid cards

## What it is

Lets you rename, delete, set a cover, or edit a smart playlist's rules directly from the Playlists grid — without having to open the playlist first. Previously these actions only existed inside **PlaylistDetail**'s header controls.

## Entry points

- **Sidebar → Playlists view → right-click any playlist card** in the grid → context menu appears at the cursor.

## Step by step

1. Right-click a playlist card. A menu opens with: **Open**, **Rename**, **Edit Smart Rules** (smart playlists only), **Set Cover**, **Delete**.
2. **Open** — same as left-clicking the card; navigates to PlaylistDetail.
3. **Rename** — the card's name label turns into an inline text input in place, focused and pre-filled with the current name. Enter commits, Escape cancels, clicking away (blur) also commits. Empty or unchanged names are silently ignored.
4. **Edit Smart Rules** — only shown for playlists where `is_smart` is true and `rules_json` is present. Opens the same `SmartPlaylistModal` used elsewhere, pre-filled with the current rules.
5. **Set Cover** — opens a native file picker (hidden `<input type="file" accept="image/*">`) immediately, no intermediate dialog. Picking an image stores it as a data URI, same as the existing cover-picker in PlaylistDetail.
6. **Delete** — two-step confirm inline in the menu: first click turns the item into **"Delete for real?"**; a second click actually deletes. No separate modal. Clicking outside the menu between the two clicks resets the confirm state (the menu closes, so you'd have to right-click and click Delete again — this is not a persistent per-card confirm timer).

## Edge cases / gotchas

- The two-step delete confirm is scoped by playlist ID (`confirmDeleteId`), but since the menu itself closes as soon as any action fires or you click away, in practice a user must click Delete twice in the same menu-open session to actually delete — reopening the menu resets to the unconfirmed state.
- Rename's inline input reuses `.playlist-create-input` styling (the same class as the "new playlist" name field), not a dedicated rename-input style.
- All four actions degrade gracefully if their corresponding callback prop isn't passed (`onRename`/`onUpdateSmartRules`/`onSetCustomCover`/`onDelete` are all optional on `PlaylistList`) — the menu item simply doesn't render. Currently `App.tsx` always passes all four, so in practice the full menu always appears.

## Implementation

- `src/components/PlaylistList.tsx` — all new state/handlers: `contextMenu`, `confirmDeleteId`, `renamingId`/`renameValue`, `editSmartPlaylist`, plus `coverTargetId` ref for routing the hidden file input's result back to the right playlist.
- Reuses `src/components/ContextMenu.tsx`'s `ContextMenu` (portal-based, outside-click-safe) — no new menu primitive.
- Reuses `src/components/SmartPlaylistModal.tsx` for the Edit Smart Rules flow (same component PlaylistDetail already uses).
- Mutations come from `usePlaylists()` (`src/hooks/usePlaylists.ts`): `deletePlaylist`, `renamePlaylist`, `setCustomCover`, `updateSmartPlaylistRules` — same functions PlaylistDetail already calls, just wired to `PlaylistList` too via new props threaded through `src/App.tsx:290,913-916` (the `/playlists` route).
- `.context-menu-danger` (from `ContextMenu.css`) styles the Delete item red, matching the danger-item convention used in other menus (e.g. "Remove from Playlist" in `PlaylistDetail.tsx`).

## Open questions

- None — straightforward wiring of existing PlaylistDetail mutation callbacks into a new menu surface.
