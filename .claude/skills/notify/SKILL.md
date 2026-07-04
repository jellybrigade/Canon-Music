---
name: notify
description: Push a one-off in-app announcement banner to Canon users without shipping a release. Use when user says "notify users", "push a notice", "announce X in the app", or invokes /notify.
---

Canon has a remote-notice system: on launch, the app fetches `notice.json` from the `main` branch of the GitHub repo (raw.githubusercontent.com) and shows a dismissible banner if the `id` is new to that user. No app update/release needed — editing and pushing the file is the whole mechanism.

## How it works (for context, don't re-explain unless asked)

- `src/lib/notice.ts` — `fetchRemoteNotice()` fetches the JSON, swallows errors, returns `null` if `id`/`message` missing.
- `src/components/RemoteNoticeBanner.tsx` — fixed-top dismissible banner, optional "Learn more" link via `openUrl`.
- `App.tsx` — fetches on launch, compares `id` against `settings['notice.last_seen_id']` (SQLite, via `useSetting`); shows banner only if unseen; dismiss persists the id so it never reappears for that user.
- `notice.json` (repo root) — the payload. Shape: `{ "id": string, "message": string, "url"?: string }`. Empty `id`/`message` = no banner shown (inert default).

## Steps to push a notice

1. Ask user for: the message text, optional link URL, and whether this is a new announcement (needs a new `id`) or editing/retracting the current one.
2. Edit `/notice.json` at repo root:
   ```json
   { "id": "<unique-slug>", "message": "<short text>", "url": "<optional link>" }
   ```
   - `id` must change from whatever's currently live, or already-dismissed users won't see the update. Use a short dated slug, e.g. `"2026-07-docs"`.
   - To retract/silence the notice entirely, set `id`/`message` back to `""`.
3. Keep `message` short — it renders in a single-line fixed-width banner, not a modal. No markdown.
4. Commit the change (use `/commit` conventions — plain message, no prefix) and push to `main` (this file lives outside the release cycle; pushing to `main` directly is fine for `notice.json` since it's not app code, but confirm with user before pushing to `main` if unsure).
5. Users see it on next app launch. No rebuild, no version bump, no `/release`.

## Constraints

- Banner is dismissible only — no snooze/remind-later. Once dismissed, gone for that user forever (until `id` changes again).
- No targeting/segmentation — this is global, all users see the same notice.
- Not for critical/security alerts requiring guaranteed delivery — it's best-effort (only fires if the fetch succeeds and the user opens the app).
