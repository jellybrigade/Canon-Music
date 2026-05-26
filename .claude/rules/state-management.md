---
description: State ownership rules — Zustand vs React Query, credential storage, key invariants
---

# State Management

## Ownership

| State | Owner |
|---|---|
| Playback (queue, position, volume, current track) | Zustand (`src/store/player.ts`) |
| Library data (tracks, albums, artists from server) | React Query + SQLite cache |
| Pending tag edits | React Query (reads from SQLite `pending_edits`) |
| Server credentials | OS keychain only — never Zustand, React Query, or SQLite |

## Key Invariants

- **`streamUrlFor` is a callback in Zustand**, not a URL string. Caller provides it so the store never holds credentials.
- **React Query never holds `Set`.** Return `string[]` from queryFn; convert to Set in the hook body. Reason: RQ `structuralSharing` treats any two Sets as equal after first render, blocking updates.
- **`getDb()` is promise-cached.** Call it concurrently without concern — migrations run exactly once.
- **`resolveTrack(queue, shuffleOrder, isShuffled, position)`** — every queue position access must go through this pure function in `player.ts`.
- **Album/track IDs in SQLite are `"{serverId}:{nativeId}"`** — strip prefix with `id.slice(server.id.length + 1)`. See HANDOFF "Known Bugs" for fragility note.

## SQLite Access Patterns

- All reads go through React Query hooks — never call `getDb()` directly in components.
- All writes from hooks (not components). Components call hook mutation functions.
- `INSERT OR REPLACE` for upserts (not `BEGIN`/`COMMIT` — pool routes statements to different connections).
