# Decisions

Behavior choices the user made that code alone doesn't explain. Read before changing the behavior an entry covers; never contradict one silently. New entry = next number, appended, same commit as the code. Superseded entries stay, struck through, with a pointer to the replacement.

Format: `- **D-<n> <short title>** (YYYY-MM-DD): <decision>. Why: <reason>.`

## Entries
- **D-1 Test connection checks the alternate URL** (2026-11-12): Test connection pings the primary and the alternate URL with the same login, side by side, and reports each. Only the primary decides whether the server can be saved: an alternate that doesn't answer shows a warning and Save stays enabled; a failed primary blocks saving even if the alternate answers. Editing the alternate clears only its result. Why: the alternate is often a LAN address that can't answer from where the test runs, but a typo in it otherwise goes unnoticed until the primary is down.
- **D-2 Casting hands the renderer the server's cover at 600px** (2026-11-12): a cast track's DIDL carries a `/rest/getCoverArt` URL at size 600 on the same address and login as its stream. An album whose cover was chosen in Canon still casts the server's cover, since the chosen file lives only on this computer. Why: sharp on a TV, light for weak renderers; the renderer can't reach Canon's own cover files.
