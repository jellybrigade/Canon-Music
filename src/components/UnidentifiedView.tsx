import { useState, useCallback } from "react";
import { Disc, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFailedLookupAlbums, persistAlbumIdentity } from "../hooks/useAlbumIdentity";
import { autoIdentifyAlbum } from "../lib/album-identify";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import { AlbumIdentifyDialog } from "./IdentifyDialog";
import { AlbumArt } from "./AlbumArt";
import { getCoverArtUrl } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../types/library";
import "./UnidentifiedView.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
}

export function UnidentifiedView({ serverWithCredential, onSelectAlbum }: Props) {
  const { server, credential } = serverWithCredential;
  const queryClient = useQueryClient();
  const { data: albums = [] } = useFailedLookupAlbums();
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);
  const [rescanProgress, setRescanProgress] = useState<{ done: number; total: number } | null>(null);

  const handleRescanAll = useCallback(async () => {
    if (albums.length === 0) return;
    const db = await getDb();
    setRescanProgress({ done: 0, total: albums.length });

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]!;
      try {
        const result = await autoIdentifyAlbum({ artist: album.artist ?? "", album: album.name });
        if (result.decision === "auto_confirmed" && result.detail) {
          await persistAlbumIdentity({
            albumId: album.id,
            mbReleaseGroupId: result.detail.id,
            mbReleaseId: result.release?.id ?? null,
            mbArtistId: result.detail.artistMbid ?? null,
            lastfmArtistName: null,
            lastfmAlbumName: null,
            lastfmMatchConfirmed: false,
            combinedGenres: result.combinedGenres,
            combinedTags: result.combinedTags,
            label: result.release?.label ?? null,
            country: result.release?.country ?? null,
            catalogNumber: result.release?.catalogNumber ?? null,
            barcode: result.release?.barcode ?? null,
            releaseDate: result.release?.date ?? result.detail.firstReleaseDate ?? null,
            autoMatched: true,
            matchScore: Math.round(result.score * 100),
          });
        } else {
          // Update the failed row so looked_up_at reflects this rescan
          const now = Math.floor(Date.now() / 1000);
          await db.execute(
            `INSERT OR REPLACE INTO album_identity
               (album_id, auto_matched, match_score, looked_up_at, lastfm_match_confirmed)
             VALUES (?, 0, ?, ?, 0)`,
            [album.id, Math.round(result.score * 100), now]
          );
        }
      } catch (e) {
        console.warn("Rescan failed for:", album.name, e);
      }
      setRescanProgress({ done: i + 1, total: albums.length });
    }

    await queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbums() });
    await queryClient.invalidateQueries({ queryKey: QK.failedLookupAlbumIds() });
    setRescanProgress(null);
  }, [albums, queryClient]);

  const scanning = rescanProgress !== null;

  return (
    <main className="content-main unidentified-view">
      <div className="unidentified-header">
        <h2 className="unidentified-title">Unidentified Albums</h2>
        {albums.length > 0 && (
          <span className="unidentified-count">{albums.length}</span>
        )}
        {albums.length > 0 && (
          <button
            className="unidentified-rescan-btn"
            onClick={() => { void handleRescanAll(); }}
            disabled={scanning}
            title="Re-run auto-identification on all unidentified albums"
          >
            <RefreshCw size={13} className={scanning ? "unidentified-rescan-spin" : ""} />
            {scanning
              ? `${rescanProgress.done} / ${rescanProgress.total}`
              : "Rescan All"}
          </button>
        )}
      </div>

      {albums.length === 0 ? (
        <p className="unidentified-empty">All albums have been identified.</p>
      ) : (
        <div className="unidentified-list">
          {albums.map((album) => {
            const artUrl = album.artwork_url ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url) : null;
            return (
              <div key={album.id} className="unidentified-row">
                <div
                  className="unidentified-art-wrap"
                  onClick={() => onSelectAlbum(album)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(album)}
                >
                  <AlbumArt
                    src={artUrl}
                    artist={album.artist}
                    album={album.name}
                    alt={album.name}
                    className="unidentified-art"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div
                  className="unidentified-info"
                  onClick={() => onSelectAlbum(album)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(album)}
                >
                  <span className="unidentified-name">{album.name}</span>
                  {album.artist && <span className="unidentified-artist">{album.artist}</span>}
                </div>
                <button
                  className="unidentified-identify-btn"
                  onClick={() => setIdentifyAlbum(album)}
                  disabled={scanning}
                  title="Identify on MusicBrainz"
                >
                  <Disc size={14} />
                  Identify
                </button>
              </div>
            );
          })}
        </div>
      )}

      {identifyAlbum && (
        <AlbumIdentifyDialog
          albumId={identifyAlbum.id}
          artist={identifyAlbum.artist ?? ""}
          album={identifyAlbum.name}
          onClose={() => setIdentifyAlbum(null)}
        />
      )}
    </main>
  );
}
