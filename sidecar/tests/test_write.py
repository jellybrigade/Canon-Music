"""Sidecar integration tests.

Requires: pytest, httpx, mutagen
Run: cd sidecar && pytest tests/ -v
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2

SECRET = "test-secret-abc"

os.environ["CANON_SIDECAR_SECRET"] = SECRET


@pytest.fixture()
def music_root(tmp_path: Path):
    os.environ["CANON_SIDECAR_MUSIC_ROOT"] = str(tmp_path)
    yield tmp_path
    del os.environ["CANON_SIDECAR_MUSIC_ROOT"]


@pytest.fixture()
def client(music_root):
    from canon_sidecar.main import app
    return TestClient(app)


@pytest.fixture()
def sample_mp3(music_root: Path) -> Path:
    """Create a minimal valid MP3 file with ID3 tags."""
    mp3_path = music_root / "test.mp3"
    # Minimal MP3 frame (silent, 128kbps)
    frame = bytes([
        0xFF, 0xFB, 0x90, 0x00,  # sync + header
    ] + [0x00] * 413)
    mp3_path.write_bytes(frame)
    try:
        tags = ID3()
        tags.add(TIT2(encoding=3, text=["Original Title"]))
        tags.save(str(mp3_path))
    except Exception:
        pass
    return mp3_path


def auth_headers():
    return {"Authorization": f"Bearer {SECRET}"}


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_no_auth(client):
    # Health endpoint is public (no auth required)
    res = client.get("/health")
    assert res.status_code == 200


def test_write_missing_auth(client, music_root, sample_mp3):
    res = client.post(
        "/write",
        json={"file_path": str(sample_mp3), "tags": {"title": "New Title"}},
    )
    assert res.status_code == 401


def test_write_wrong_auth(client, music_root, sample_mp3):
    res = client.post(
        "/write",
        headers={"Authorization": "Bearer wrong-secret"},
        json={"file_path": str(sample_mp3), "tags": {"title": "New Title"}},
    )
    assert res.status_code == 401


def test_dry_run_returns_diff_no_write(client, music_root, sample_mp3):
    mtime_before = sample_mp3.stat().st_mtime
    res = client.post(
        "/write?dry_run=true",
        headers=auth_headers(),
        json={"file_path": str(sample_mp3), "tags": {"title": "Changed Title"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert "diff" in data
    assert "resolved_path" in data
    # File must NOT be modified
    assert sample_mp3.stat().st_mtime == mtime_before


def test_write_creates_backup(client, music_root, sample_mp3):
    res = client.post(
        "/write",
        headers=auth_headers(),
        json={"file_path": str(sample_mp3), "tags": {"title": "New Title"}},
    )
    assert res.status_code == 200
    backup_dir = sample_mp3.parent / ".canon-backup"
    backups = list(backup_dir.iterdir()) if backup_dir.exists() else []
    assert len(backups) >= 1


def test_path_escape_rejected(client, music_root):
    res = client.post(
        "/write",
        headers=auth_headers(),
        json={"file_path": "/etc/passwd", "tags": {"title": "x"}},
    )
    assert res.status_code in (400, 404)


def test_missing_file(client, music_root):
    res = client.post(
        "/write",
        headers=auth_headers(),
        json={"file_path": str(music_root / "nonexistent.mp3"), "tags": {"title": "x"}},
    )
    assert res.status_code == 404
