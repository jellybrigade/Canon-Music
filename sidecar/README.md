# Canon Sidecar

Tag-writing service for Canon. Runs on your music server (or local machine). Writes audio file tags via mutagen after creating a backup.

## Requirements

- Python 3.11+
- `uv` or `pip`

## Run locally

```bash
cd sidecar

# With uv (recommended)
uv run --extra dev uvicorn canon_sidecar.main:app --host 0.0.0.0 --port 8765 --reload

# With pip
pip install -e ".[dev]"
uvicorn canon_sidecar.main:app --host 0.0.0.0 --port 8765 --reload
```

Required env vars:

| Var | Description |
|---|---|
| `CANON_SIDECAR_SECRET` | Shared secret — must match what you configure in Canon |
| `CANON_SIDECAR_MUSIC_ROOT` | Absolute path to your music directory |

Optional:

| Var | Default | Description |
|---|---|---|
| `CANON_SIDECAR_HOST` | `0.0.0.0` | Bind host |
| `CANON_SIDECAR_PORT` | `8765` | Bind port |

## Docker

```bash
docker build -t canon-sidecar .

docker run -d \
  -p 8765:8765 \
  -v /path/to/music:/music:rw \
  -e CANON_SIDECAR_SECRET=your-secret-here \
  -e CANON_SIDECAR_MUSIC_ROOT=/music \
  canon-sidecar
```

## API

### `GET /health`
Returns `{ status: "ok", version: "..." }`. No auth required.

### `POST /write`
Writes tags to a file. Requires `Authorization: Bearer <secret>`.

Body:
```json
{
  "file_path": "/music/Artist/Album/01 Track.mp3",
  "tags": {
    "title": "New Title",
    "artist": "New Artist",
    "genre": null
  }
}
```

With `?dry_run=true`: returns diff without writing. Response:
```json
{
  "resolved_path": "/music/Artist/Album/01 Track.mp3",
  "diff": [
    { "field": "title", "old_value": "Old Title", "new_value": "New Title" }
  ]
}
```

Supported tag fields: `title`, `artist`, `album`, `album_artist`, `genre`, `year`, `track_number`, `disc_number`, `comment`.

## Path remapping

If Canon runs on a different machine than the sidecar, file paths from Navidrome may not match the sidecar's filesystem. Configure path remapping in Canon's server settings:

- **From**: `/mnt/data/music` (path as Navidrome sees it)
- **To**: `/music` (path as the sidecar sees it)

Canon applies the remap before sending to the sidecar.

## Security

- All write endpoints require `Authorization: Bearer <secret>`.
- Requests whose resolved path escapes `CANON_SIDECAR_MUSIC_ROOT` are rejected (HTTP 400).
- Symlinks that resolve outside the music root are rejected.
- Original file is backed up to `{file_dir}/.canon-backup/` before every write.

## Tests

```bash
cd sidecar
pip install -e ".[dev]"
pytest tests/ -v
```
