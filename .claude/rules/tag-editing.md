---
description: Tag editing rules — pending_edits flow, sidecar, diff required, conflict handling, edit_history
paths:
  - "src/db/**"
  - "src/components/AlbumDetail.tsx"
  - "src/components/SettingsView.tsx"
  - "sidecar/**"
---

# Tag Editing

## The Rule: Never Skip the Diff

All tag edits — manual, Last.fm enrichment, Genre Unifier — **must** go through `pending_edits` in SQLite first. Nothing is written to files without the user reviewing a diff and confirming. This is non-negotiable.

## Sidecar for Writes

The app never writes tags directly. All tag writes go through the sidecar REST API running on the user's server as a Docker container.

- Auth: `Authorization: Bearer <shared-secret>`
- Dry-run: `POST /write?dry_run=true` — returns resolved path + diff, touches nothing
- Backup: sidecar copies original to `.canon-backup/` before every write
- If sidecar is unreachable: tag editing is disabled. Do not attempt workarounds or fallbacks.

## Flow

```
UI edit → INSERT INTO pending_edits → diff review UI → user confirms
        → POST /write?dry_run=true → show resolved diff → user confirms again
        → POST /write → on 200: move row to edit_history
```

## `pending_edits` Schema

```
id, track_id, field, old_value, new_value, source, error, created_at
```

`source` values: `manual` | `lastfm` | `genre_unifier`

## Conflict Handling

If two sources edit the same `(track_id, field)`: surface the conflict to the user. Never silently overwrite. User picks which value wins.

## Undo

After confirmed write, row moves to `edit_history`. Undo supported 1 level deep via `edit_history`.

## Current Status

`pending_edits` and `edit_history` tables exist (migration v1). No application code references them yet — the full feature starts at Goal T3.
