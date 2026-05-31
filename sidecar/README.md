# Canon Sidecar

Tag-writing service for Canon. Runs on your music server. Writes audio file tags via mutagen, saving a small JSON backup of old values before every write (no full-file copies).

---

## Setup options

Pick the one that matches how you run your server.

---

### Option A — Docker Compose alongside Navidrome (most common)

Add the sidecar service to your existing `docker-compose.yml`. It needs read-write access to the same music volume Navidrome uses.

```yaml
services:
  navidrome:
    image: deluan/navidrome:latest
    ports:
      - "4533:4533"
    volumes:
      - /path/to/music:/music:ro   # read-only is fine for Navidrome
    environment:
      ND_MUSICFOLDER: /music

  canon-sidecar:
    image: ghcr.io/jellybrigade/canon-sidecar:latest
    ports:
      - "8765:8765"
    volumes:
      - /path/to/music:/music:rw   # needs write access
    environment:
      CANON_SIDECAR_SECRET: your-secret-here
      CANON_SIDECAR_MUSIC_ROOT: /music
    restart: unless-stopped
```

```bash
docker compose up -d
curl http://localhost:8765/health   # should return {"status":"ok","version":"..."}
```

---

### Option B — Docker Compose, standalone (no Navidrome in compose)

If Navidrome runs elsewhere (bare metal, separate compose stack, etc.):

```yaml
services:
  canon-sidecar:
    image: ghcr.io/jellybrigade/canon-sidecar:latest
    ports:
      - "8765:8765"
    volumes:
      - /path/to/music:/music:rw
    environment:
      CANON_SIDECAR_SECRET: your-secret-here
      CANON_SIDECAR_MUSIC_ROOT: /music
    restart: unless-stopped
```

---

### Option C — Unraid

1. Install **Community Applications** if not already.
2. Search for **Canon Sidecar** in the Apps tab (or add manually via Docker tab → Add Container).
3. Set:
   - Repository: `ghcr.io/jellybrigade/canon-sidecar:latest`
   - Port: `8765 → 8765`
   - Volume: your music share path → `/music` (read/write)
   - Variables: `CANON_SIDECAR_SECRET` and `CANON_SIDECAR_MUSIC_ROOT=/music`

---

### Option D — TrueNAS Scale

Use **Apps → Custom App** (or the Docker Compose UI in TrueNAS 24.10+):

```yaml
services:
  canon-sidecar:
    image: ghcr.io/jellybrigade/canon-sidecar:latest
    ports:
      - "8765:8765"
    volumes:
      - /mnt/pool/music:/music:rw
    environment:
      CANON_SIDECAR_SECRET: your-secret-here
      CANON_SIDECAR_MUSIC_ROOT: /music
    restart: unless-stopped
```

Map the dataset that holds your music to `/music`.

---

### Option E — Bare metal (systemd)

```bash
# Install
pip install "canon-sidecar @ git+https://github.com/jellybrigade/canon.git#subdirectory=sidecar"

# Create service
sudo tee /etc/systemd/system/canon-sidecar.service > /dev/null <<EOF
[Unit]
Description=Canon Sidecar
After=network.target

[Service]
User=your-user
Environment=CANON_SIDECAR_SECRET=your-secret-here
Environment=CANON_SIDECAR_MUSIC_ROOT=/path/to/music
ExecStart=uvicorn canon_sidecar.main:app --host 0.0.0.0 --port 8765
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now canon-sidecar
```

---

## Configure Canon

Once the sidecar is running, open Canon → **Settings → Server** and fill in:

| Field | Value |
|---|---|
| Sidecar URL | `http://your-server-ip:8765` |
| Secret | Same value as `CANON_SIDECAR_SECRET` |

Hit **Test connection** — Canon calls `/health` and confirms it can reach the sidecar.

### Path remapping

If Navidrome and the sidecar see your music at different paths (common when one runs in Docker and one doesn't), set a path remap in the same settings panel:

- **From**: the path Navidrome reports (e.g. `/mnt/data/music`)
- **To**: the path the sidecar sees (e.g. `/music`)

Canon applies the remap before sending write requests.

---

## Env vars

| Var | Required | Default | Description |
|---|---|---|---|
| `CANON_SIDECAR_SECRET` | Yes | — | Bearer token, must match Canon settings |
| `CANON_SIDECAR_MUSIC_ROOT` | Yes | — | Absolute path to music directory on the sidecar's filesystem |
| `CANON_SIDECAR_HOST` | No | `0.0.0.0` | Bind host |
| `CANON_SIDECAR_PORT` | No | `8765` | Bind port |

---

## API

### `GET /health`
Returns `{ "status": "ok", "version": "..." }`. No auth required. Use this to verify the sidecar is reachable.

### `POST /write`
Writes tags to a file. Requires `Authorization: Bearer <secret>`.

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

Set `genre` (or any field) to `null` to remove that tag.

Add `?dry_run=true` to preview the diff without writing:

```json
{
  "resolved_path": "/music/Artist/Album/01 Track.mp3",
  "diff": [
    { "field": "title", "old_value": "Old Title", "new_value": "New Title" }
  ]
}
```

Supported fields: `title`, `artist`, `album`, `album_artist`, `genre`, `year`, `track_number`, `disc_number`, `comment`.

---

## Security

- All write endpoints require `Authorization: Bearer <secret>`.
- Paths that escape `CANON_SIDECAR_MUSIC_ROOT` are rejected (HTTP 400) — no directory traversal.
- Symlinks that resolve outside the music root are rejected.
- Before every write, old tag values are saved as a small JSON file in `{file_dir}/.canon-backup/` (not a full file copy — negligible storage cost).

---

## Build from source

```bash
git clone https://github.com/jellybrigade/canon.git
cd canon/sidecar
docker build -t canon-sidecar .
```

---

## Tests

```bash
cd sidecar
pip install -e ".[dev]"
pytest tests/ -v
```
