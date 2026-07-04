# Canon

A desktop music player and tag management tool for self-hosted music servers. Currently supports Navidrome.

## Features

- Stream your library from Navidrome
- Full playback controls: shuffle, repeat, queue, drag-to-reorder
- Radio Auto-DJ: genre-aware track generation using a canonical genre tree and Last.fm
- Tag management: review and write tags back to files via a sidecar process
- Genre normalization pipeline with a curated genre taxonomy
- MusicBrainz album identification
- Synced lyrics via LRClib
- Scrobbling to Last.fm and ListenBrainz
- OS media key integration (MPRIS on Linux)

## Installation

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
