# Decisions

Behavior choices the user made that code alone doesn't explain. Read before changing the behavior an entry covers; never contradict one silently. New entry = next number, appended, same commit as the code. Superseded entries stay, struck through, with a pointer to the replacement.

Format: `- **D-<n> <short title>** (YYYY-MM-DD): <decision>. Why: <reason>.`

## Entries
- **D-1 Test connection checks the alternate URL** (2026-11-12): Test connection pings the primary and the alternate URL with the same login, side by side, and reports each. Only the primary decides whether the server can be saved: an alternate that doesn't answer shows a warning and Save stays enabled; a failed primary blocks saving even if the alternate answers. Editing the alternate clears only its result. Why: the alternate is often a LAN address that can't answer from where the test runs, but a typo in it otherwise goes unnoticed until the primary is down.
