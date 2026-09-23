# Tag Issue Detection

## What it is

Canon automatically flags tracks with problematic metadata — missing genre, missing artist, a genre value that looks broken, an album whose tracks disagree on artist, or an album that's been duplicated in your library — so you can spot and fix bad tags without manually auditing every track.

## Status: backend-only, not user-visible yet

**This feature has no UI and no read path.** Detection and storage run on every sync; nothing in the app reads the results. `CLAUDE.md` currently lists "Tag issue detection... + `TagIssuesView` w/ dismiss + sidebar badge" under shipped v0.6.x work - that line is inaccurate as of this writing. There is no `TagIssuesView` component, and the "Tags" sidebar badge shows the *unmapped-tag* count (`unmappedCount` in `src/App.tsx:291`), not the tag-issue count. `useTagIssues()` existed as an orphan for months and was deleted in the 2026-09-09 dead-code sweep, along with `QK.tagIssues()` and the post-sync invalidation of that key; a view has to bring its own read back.

Until a view is built, issues silently accumulate in the `tag_issues` table with no way for a user to see or dismiss them from the UI (the settings toggle described below controls a badge that isn't wired to this data).

## What exists today

### Detection (runs automatically, no user action)

`scanForIssues(serverId)` (`src/features/tags/lib/tagIssues.ts:3`) runs at the end of every library sync (`src/features/sync/sync.ts:265`, called from within the sync pipeline after tracks/albums are updated). It:

1. Deletes all *non-dismissed* issues for that server (dismissed rows are preserved so a dismissal survives future rescans — `src/features/tags/lib/tagIssues.ts:6-14`).
2. Re-inserts current issues via `INSERT OR IGNORE`, one query per issue type:

| Issue type | Condition | Detail text |
|---|---|---|
| `missing_genre` | track's `genre` is NULL/empty | "Track has no genre tag" |
| `missing_artist` | track's `artist` is NULL/empty | "Track has no artist tag" |
| `suspicious_genre` | genre starts with `http` or is >60 chars | "Genre looks like a URL or is unusually long" |
| `inconsistent_album_artist` | track has no `album_artist`, and its album's tracks have >1 distinct `artist` value | "Album has multiple distinct artist values with no album_artist tag" |
| `duplicate_album` | album shares `(lower(name), lower(artist))` with another album on the same server | "Multiple albums share the same name and artist" |

(Exact SQL: `src/features/tags/lib/tagIssues.ts:16-70`.)

### Storage

Table `tag_issues`, created in schema migration v8 (`src/db/migrations.ts:176-183`), `dismissed_at` column added in v10 (`src/db/migrations.ts:232`). Columns: `id`, `track_id`, `issue_type`, `details`, `detected_at`, `dismissed_at`, with `UNIQUE(track_id, issue_type)` preventing duplicate rows per track/issue pair.

### Data access

None. The deleted `useTagIssues()` read non-dismissed issues joined to track/album (`track_title`, `track_artist`, `album_name`, `album_id`) and carried `dismissIssue(id)` / `dismissAll()` mutations writing `dismissed_at`; see it in git history at `src/hooks/useTagIssues.ts` before the 2026-09-09 sweep. Rows reach nothing today, so a view starts from the table.

### Existing but unrelated settings toggle

Settings → Metadata & Tags tab has a checkbox labeled **"Hide tag issues badge"** ("Suppresses the badge counter on the Tags sidebar item.", `src/features/settings/components/TagsTab.tsx:369-370`, state `hideTagBadge`). This toggle currently only suppresses the *unmapped-tag* badge (`src/App.tsx:582`) - it does not affect tag-issue data in any way, since nothing reads the table. The toggle's copy implies it controls tag-issue visibility; it doesn't yet.

## Edge cases / gotchas

- Dismissals persist across re-syncs by design (dismissed rows aren't deleted by the pre-scan cleanup), but since there's no UI to dismiss anything yet, this can't currently be exercised by a user.
- `inconsistent_album_artist` and `duplicate_album` detection only look within a single `server_id` — cross-server duplicate albums aren't flagged.
- The settings toggle's label/description is misleading given current wiring; if a `TagIssuesView` is built, confirm whether `hideTagBadge` should control both badges or be split into two settings.

## Implementation reference

- Detection: `src/features/tags/lib/tagIssues.ts:3-71`
- Sync trigger: `src/features/sync/sync.ts:265` (import at `src/features/sync/sync.ts:6`)
- Schema: `src/db/migrations.ts:176-183` (v8), `:232` (v10, `dismissed_at`)
- Misleading settings toggle: `src/features/settings/components/TagsTab.tsx:369-375`
- Actual sidebar badge (unrelated data): `src/App.tsx:291`, `:582`

## Open questions

- Was a `TagIssuesView` ever built and later removed, or never built? Not in git history scope of this pass — worth checking `git log -- '**/TagIssuesView*'` if provenance matters.
- Should CLAUDE.md's status line be corrected to remove this from "shipped"? Flagging for user decision, not editing CLAUDE.md as part of this doc pass.
