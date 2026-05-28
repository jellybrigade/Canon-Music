---
description: Tag editing rules — display-only normalization, pending_edits flow for manual overrides only, sidecar, diff required, conflict handling, edit_history
paths:
  - "src/db/**"
  - "src/components/AlbumDetail.tsx"
  - "src/components/TagDrawer.tsx"
  - "src/components/SettingsView.tsx"
  - "sidecar/**"
---

# Tag Editing

## Policy

**Normalization is display-only.** The pipeline writes `normalized_tags_json` to the `albums` table. Files on disk are never touched automatically.

**Manual override is the only file-write path.** A user right-clicks a tag chip → "Override this tag" → the edit goes through `pending_edits` → diff review → sidecar write. Nothing else writes to files.

## The Rule: Never Skip the Diff (manual override path only)

Manual edits **must** go through `pending_edits` in SQLite first. Nothing is written to files without the user reviewing a diff and confirming. This applies to the manual override path only — the normalization pipeline never triggers this flow.

## Sidecar for Writes

The app never writes tags directly. All tag writes go through the sidecar REST API running on the user's server as a Docker container.

- Auth: `Authorization: Bearer <shared-secret>`
- Dry-run: `POST /write?dry_run=true` — returns resolved path + diff, touches nothing
- Backup: sidecar copies original to `.canon-backup/` before every write
- If sidecar is unreachable: tag editing is disabled. Do not attempt workarounds or fallbacks.

## Manual Override Flow

```
Right-click chip → Override → INSERT INTO pending_edits
  → diff review UI → user confirms
  → POST /write?dry_run=true → show resolved diff → user confirms again
  → POST /write → on 200: move row to edit_history
```

## `pending_edits` Schema

```
id, track_id, field, old_value, new_value, source, error, created_at
```

`source` values: `manual` (normalization pipeline never writes here)

## Conflict Handling

If two manual edits touch the same `(track_id, field)`: surface the conflict to the user. Never silently overwrite. User picks which value wins.

## Undo

After confirmed write, row moves to `edit_history`. Undo supported 1 level deep via `edit_history`.
