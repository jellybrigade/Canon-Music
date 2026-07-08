# Canon

Your music player for Navidrome.

A desktop player for Navidrome libraries. Keeps tags and album titles tidy, and makes genre browsing as easy as it should be.

## Genre graph

~8,000 genres in one tree. Genres link to parents and children instead of sitting in a flat list. Auto-DJ stations follow the tree: a station seeded from one genre stays close to it, however wide you set it.

## Tag normalization

Canon reads file tags, Last.fm, and MusicBrainz, then resolves them against the genre tree. Local only, SQLite side; Canon never writes to your music files.

## Title cleanup

Strips display-level junk like `(Deluxe Edition)` and `(Remastered 2011)` from how albums are shown, without touching the files on disk.

## Features

- Stream your library from Navidrome
- Full playback controls: shuffle, repeat, queue, drag-to-reorder
- Radio Auto-DJ: genre-aware track generation using the canon tree and Last.fm similar artists
- Genre normalization pipeline with a curated genre taxonomy
- Artist enrichment: bio, stats, similar artists
- Tag issue detection with a dedicated review view
- MusicBrainz album identification
- Synced lyrics via LRClib
- Scrobbling to Navidrome
- OS media key integration (MPRIS on Linux)

## Installation

This is an alpha. Expect bugs and crashes.

**Linux / macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/jellybrigade/Canon-Music/main/install.sh | sh
```

Or download directly from the [Releases](../../releases) page:

| Platform | File | Notes |
|---|---|---|
| Linux | `.deb` | Debian / Ubuntu |
| Linux | `.rpm` | Fedora / RHEL |
| Linux | `.AppImage` | Portable, any distro |
| macOS | `.dmg` | Universal (Intel + Apple Silicon) |
| Windows | `-setup.exe` | NSIS installer |
| Windows | `.msi` | MSI package |

## Building from source

Requires: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20+, [pnpm](https://pnpm.io)

```bash
pnpm install
pnpm tauri build
```

For development with hot reload:

```bash
pnpm tauri dev
```

## License

Canon is licensed under the [GNU General Public License v3.0](LICENSE).
