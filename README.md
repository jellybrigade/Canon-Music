# Canon

A desktop music player and tag management tool for self-hosted music servers. Currently supports Navidrome.

## Features

- Stream your library from Navidrome, Jellyfin, or Plex
- Full playback controls: shuffle, repeat, queue, drag-to-reorder
- Radio Auto-DJ: genre-aware track generation using a canonical genre tree and Last.fm
- Tag management: review and write tags back to files via a sidecar process
- Genre normalization pipeline with a curated genre taxonomy
- MusicBrainz album identification
- Synced lyrics via LRClib
- Scrobbling to Last.fm and ListenBrainz
- OS media key integration (MPRIS on Linux)

## Installation

Download the latest release for your platform from the [Releases](../../releases) page:

- **Linux** — `.AppImage`
- **macOS** — `.dmg` (universal, Intel + Apple Silicon)
- **Windows** — `.exe` installer

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
