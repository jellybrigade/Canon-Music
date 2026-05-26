"""Canon sidecar — tag writing service for music files.

Env vars:
  CANON_SIDECAR_SECRET    Required. Bearer token for all write endpoints.
  CANON_SIDECAR_MUSIC_ROOT  Required. Absolute path to the music directory.
                            Requests whose resolved path escapes this root are rejected.
  CANON_SIDECAR_HOST      Optional. Bind host (default 0.0.0.0).
  CANON_SIDECAR_PORT      Optional. Bind port (default 8765).
"""

import os
import shutil
import secrets
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from mutagen import File as MutagenFile
from mutagen.id3 import ID3, ID3NoHeaderError
from pydantic import BaseModel

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="canon-sidecar", version=VERSION)

EXPECTED_SECRET = os.environ.get("CANON_SIDECAR_SECRET", "")
MUSIC_ROOT_ENV = os.environ.get("CANON_SIDECAR_MUSIC_ROOT", "")


def _music_root() -> Path:
    if not MUSIC_ROOT_ENV:
        raise RuntimeError("CANON_SIDECAR_MUSIC_ROOT is not set")
    return Path(MUSIC_ROOT_ENV).resolve()


def _check_auth(authorization: str | None) -> None:
    if not EXPECTED_SECRET:
        raise HTTPException(status_code=500, detail="Sidecar secret not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[len("Bearer "):]
    if not secrets.compare_digest(token, EXPECTED_SECRET):
        raise HTTPException(status_code=401, detail="Invalid token")


def _resolve_path(file_path: str) -> Path:
    root = _music_root()
    resolved = (root / Path(file_path).relative_to("/") if Path(file_path).is_absolute() else root / file_path).resolve()
    # Reject paths that escape the music root
    try:
        resolved.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes music root")
    # Reject symlinks that resolve outside root
    if resolved.is_symlink() and not resolved.resolve().is_relative_to(root):
        raise HTTPException(status_code=400, detail="Symlink escapes music root")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {resolved}")
    return resolved


def _backup(path: Path) -> Path:
    backup_dir = path.parent / ".canon-backup"
    backup_dir.mkdir(exist_ok=True)
    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"{path.name}.{timestamp}"
    shutil.copy2(path, backup_path)
    return backup_path


FIELD_MAP: dict[str, str | list[str]] = {
    "title": ["TIT2", "©nam", "TITLE"],
    "artist": ["TPE1", "©ART", "ARTIST"],
    "album": ["TALB", "©alb", "ALBUM"],
    "album_artist": ["TPE2", "aART", "ALBUMARTIST"],
    "genre": ["TCON", "©gen", "GENRE"],
    "year": ["TDRC", "©day", "DATE"],
    "track_number": ["TRCK", "trkn", "TRACKNUMBER"],
    "disc_number": ["TPOS", "disk", "DISCNUMBER"],
    "comment": ["COMM::eng", "©cmt", "COMMENT"],
}


def _read_tags(f: Any, field: str) -> str | None:
    """Read a tag value from a mutagen file object."""
    candidates = FIELD_MAP.get(field, [field])
    for key in candidates:
        if key in f:
            val = f[key]
            if hasattr(val, "text"):
                return str(val.text[0]) if val.text else None
            if isinstance(val, list):
                return str(val[0]) if val else None
            return str(val)
    return None


def _write_tag(f: Any, field: str, value: str | None) -> None:
    """Write a single tag to a mutagen file object (does not save)."""
    candidates = FIELD_MAP.get(field, [field])
    for key in candidates:
        if key in f:
            if value is None:
                del f[key]
            else:
                existing = f[key]
                if hasattr(existing, "text"):
                    existing.text = [value]
                elif isinstance(existing, list):
                    f[key] = [value]
                else:
                    f[key] = value
            return
    if value is not None:
        # Insert using the first candidate key — mutagen handles format-specific types
        key = candidates[0]
        try:
            from mutagen.id3 import TIT2, TPE1, TALB, TPE2, TCON, TDRC, TRCK, TPOS, COMM
            tag_classes = {
                "TIT2": TIT2, "TPE1": TPE1, "TALB": TALB, "TPE2": TPE2,
                "TCON": TCON, "TDRC": TDRC, "TRCK": TRCK, "TPOS": TPOS,
            }
            if key in tag_classes:
                f[key] = tag_classes[key](encoding=3, text=[value])
                return
        except (ImportError, Exception):
            pass
        f[key] = value


class WriteRequest(BaseModel):
    file_path: str
    tags: dict[str, str | None]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION}


@app.post("/write")
async def write_tags(request: Request, body: WriteRequest, authorization: str | None = Header(default=None)) -> JSONResponse:
    _check_auth(authorization)
    dry_run = request.query_params.get("dry_run", "false").lower() in ("true", "1", "yes")

    resolved = _resolve_path(body.file_path)
    f = MutagenFile(resolved, easy=False)
    if f is None:
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    diff = []
    for field, new_value in body.tags.items():
        old_value = _read_tags(f, field)
        if old_value != new_value:
            diff.append({"field": field, "old_value": old_value, "new_value": new_value})

    if dry_run:
        return JSONResponse({"resolved_path": str(resolved), "diff": diff})

    if diff:
        backup_path = _backup(resolved)
        logger.info("Backup created: %s", backup_path)
        for field, new_value in body.tags.items():
            _write_tag(f, field, new_value)
        f.save()
        logger.info("Tags written to: %s (%d fields changed)", resolved, len(diff))

    return JSONResponse({"resolved_path": str(resolved), "diff": diff})
