import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import { useNormalizeAlbum } from "../hooks/useNormalizeAlbum";
import { useAlbumIdentity } from "../hooks/useAlbumIdentity";
import { useTagMappings } from "../hooks/useTagMappings";
import { normalizeAlbum } from "../lib/tag-normalize";
import { getCanonTree } from "../lib/canonicalize";
import type { TreeNode } from "../lib/canonicalize";
import type { NormalizedTag } from "../lib/tag-normalize";
import type { MbGenre } from "../lib/musicbrainz";
import { CanonCombobox, ACCEPTED, IGNORED } from "./TagsViewHelpers";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import "./TagDrawer.css";
import "./TagsView.css";

interface Props {
  albumId: string;
  albumArtist: string;
  albumName: string;
  trackId?: string;
  onClose: () => void;
}

interface RawTagRow {
  raw_value: string;
  kind: string;
  source: string;
}

function useTrackRawTags(trackId: string | undefined) {
  return useQuery({
    queryKey: QK.trackRawTags(trackId),
    queryFn: async () => {
      if (!trackId) return [];
      const db = await getDb();
      return db.select<RawTagRow[]>(
        "SELECT raw_value, kind, source FROM track_tags WHERE track_id = ? ORDER BY kind, raw_value",
        [trackId]
      );
    },
    enabled: !!trackId,
  });
}

function useAlbumRawGenreMap(albumId: string) {
  return useQuery({
    queryKey: QK.albumRawGenreMap(albumId),
    queryFn: async () => {
      const db = await getDb();
      type Row = { canonical_id: string; raw_value: string };
      const rows = await db.select<Row[]>(
        `SELECT DISTINCT tt.canonical_id, tt.raw_value
         FROM track_tags tt
         JOIN tracks t ON t.id = tt.track_id
         WHERE t.album_id = ? AND tt.kind = 'genre'
           AND tt.canonical_id IS NOT NULL
           AND tt.canonical_id NOT IN ('__accepted__', '__ignored__')`,
        [albumId]
      );
      const map = new Map<string, string[]>();
      for (const { canonical_id, raw_value } of rows) {
        const arr = map.get(canonical_id) ?? [];
        arr.push(raw_value);
        map.set(canonical_id, arr);
      }
      return map;
    },
    staleTime: Infinity,
  });
}

function useAlbumUnmatchedGenres(albumId: string) {
  return useQuery({
    queryKey: QK.albumUnmatchedGenres(albumId),
    queryFn: async () => {
      const db = await getDb();
      // album_unresolved_genres captures all unmapped tags (file, lastfm, musicbrainz)
      // written by normalizeAlbum, filter out any that already have a mapping decision
      return db.select<{ raw_value: string; source: string }[]>(
        `SELECT DISTINCT ug.raw_value, ug.source
         FROM album_unresolved_genres ug
         WHERE ug.album_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM tag_mappings tm
             WHERE tm.raw_value = ug.raw_value AND tm.kind = 'genre'
           )
         ORDER BY ug.source, ug.raw_value`,
        [albumId]
      );
    },
    staleTime: Infinity,
  });
}

const SOURCE_LABELS: Record<string, string> = {
  lastfm: "last.fm",
  file: "file tag",
};

function SourceBadge({ source }: { source: string }) {
  const label = SOURCE_LABELS[source] ?? source;
  return <span className={`tag-source-badge tag-source-badge--${source}`}>{label}</span>;
}

function TagSection({
  title,
  tags,
  level,
  emptyMessage,
  rawMap,
  onIgnore,
}: {
  title: string;
  tags: NormalizedTag[];
  level: "album" | "track";
  emptyMessage?: string;
  rawMap?: Map<string, string[]>;
  onIgnore?: (rawName: string) => void;
}) {
  if (tags.length === 0) {
    if (!emptyMessage) return null;
    return (
      <div className="tag-drawer-section">
        <h3 className="tag-drawer-section-title">
          {title}
          <span className={`tag-level-badge tag-level-badge--${level}`}>{level}</span>
        </h3>
        <p className="tag-drawer-empty">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="tag-drawer-section">
      <h3 className="tag-drawer-section-title">
        {title}
        <span className={`tag-level-badge tag-level-badge--${level}`}>{level}</span>
      </h3>
      {tags.map((tag) => {
        const originals = tag.id ? rawMap?.get(tag.id) : undefined;
        const remapped = originals?.filter((r) => r.toLowerCase() !== tag.name.toLowerCase());
        const tooltip = remapped?.length ? `Original: ${remapped.join(", ")}` : undefined;
        const isUnmapped = tag.id === null;
        return (
          <div key={tag.id ?? tag.name} className="tag-drawer-row" title={tooltip}>
            <span className="tag-drawer-name">{tag.name}</span>
            {remapped?.length ? <span className="td-remapped-hint">⟵</span> : null}
            <SourceBadge source={tag.source} />
            {isUnmapped && onIgnore ? (
              <button
                className="tag-drawer-ignore-btn"
                title="Ignore, exclude from genre output"
                onClick={() => onIgnore(tag.name)}
              >
                Ignore
              </button>
            ) : (
              <span className="tag-drawer-confidence">{Math.round(tag.confidence * 100)}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── UnmatchedSection ──────────────────────────────────────────────────────────

interface UnmatchedSectionProps {
  albumId: string;
  albumArtist: string;
  albumName: string;
}

export function UnmatchedSection({ albumId, albumArtist, albumName }: UnmatchedSectionProps) {
  const { data: unmatched = [] } = useAlbumUnmatchedGenres(albumId);
  const { data: identity } = useAlbumIdentity(albumId);
  const { saveMapping } = useTagMappings();
  const queryClient = useQueryClient();
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);

  useEffect(() => {
    getCanonTree().then((t) => setTreeNodes(t.nodes)).catch(console.error);
  }, []);

  if (unmatched.length === 0) return null;

  async function handleDecision(rawValue: string, canonicalId: string) {
    try {
      await saveMapping.mutateAsync({ rawValue, kind: "genre", canonicalId, source: "manual" });
    } catch {
      return;
    }

    let combinedMbGenres: MbGenre[] | null = null;
    if (identity?.combined_genres_json) {
      try { combinedMbGenres = JSON.parse(identity.combined_genres_json) as MbGenre[]; } catch { /* malformed */ }
    }
    let combinedMbTags: MbGenre[] | null = null;
    if (identity?.combined_tags_json) {
      try { combinedMbTags = JSON.parse(identity.combined_tags_json) as MbGenre[]; } catch { /* malformed */ }
    }

    await normalizeAlbum(albumId, albumArtist, albumName, {
      lastfmArtistName: identity?.lastfm_artist_name ?? null,
      lastfmAlbumName: identity?.lastfm_album_name ?? null,
      combinedMbGenres,
      combinedMbTags,
    });

    void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumUnmatchedGenres(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumGenreRawSources(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumRawGenreMap(albumId) });
  }

  return (
    <div className="tag-drawer-section">
      <h3 className="tag-drawer-section-title">Unmatched genres</h3>
      {unmatched.map(({ raw_value, source }) => (
        <div key={raw_value} className="td-unmatched-row">
          <div className="td-unmatched-top">
            <span className="td-unmatched-name">{raw_value}</span>
            <SourceBadge source={source} />
          </div>
          <div className="td-unmatched-actions">
            <button
              className="btn-flat accept"
              title="Accept as-is, keep in genre output without remapping"
              onClick={() => void handleDecision(raw_value, ACCEPTED)}
            >
              Accept
            </button>
            <button
              className="btn-flat ignore"
              title="Ignore, exclude from genre output"
              onClick={() => void handleDecision(raw_value, IGNORED)}
            >
              Ignore
            </button>
          </div>
          <CanonCombobox
            treeNodes={treeNodes}
            currentId={null}
            onSelect={(id) => void handleDecision(raw_value, id)}
            onClear={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

// ── TagDrawer ─────────────────────────────────────────────────────────────────

export function TagDrawer({ albumId, albumArtist, albumName, trackId, onClose }: Props) {
  const { data: normalizedTags, isLoading } = useNormalizeAlbum(albumId, albumArtist, albumName);
  const { data: rawTrackTags } = useTrackRawTags(trackId);
  const { data: rawMap } = useAlbumRawGenreMap(albumId);
  const { data: identity } = useAlbumIdentity(albumId);
  const { saveMapping } = useTagMappings();
  const queryClient = useQueryClient();
  const dismiss = useOverlayDismiss(onClose);

  async function handleIgnoreUnmappedGenre(rawName: string) {
    try {
      await saveMapping.mutateAsync({ rawValue: rawName, kind: "genre", canonicalId: IGNORED, source: "manual" });
    } catch {
      return;
    }
    let combinedMbGenres: MbGenre[] | null = null;
    if (identity?.combined_genres_json) {
      try { combinedMbGenres = JSON.parse(identity.combined_genres_json) as MbGenre[]; } catch { /* malformed */ }
    }
    let combinedMbTags: MbGenre[] | null = null;
    if (identity?.combined_tags_json) {
      try { combinedMbTags = JSON.parse(identity.combined_tags_json) as MbGenre[]; } catch { /* malformed */ }
    }
    await normalizeAlbum(albumId, albumArtist, albumName, {
      lastfmArtistName: identity?.lastfm_artist_name ?? null,
      lastfmAlbumName: identity?.lastfm_album_name ?? null,
      combinedMbGenres,
      combinedMbTags,
    });
    void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumUnmatchedGenres(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumGenreRawSources(albumId) });
    void queryClient.invalidateQueries({ queryKey: QK.albumRawGenreMap(albumId) });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="tag-drawer-overlay" {...dismiss}>
      <div className="tag-drawer">
        <div className="tag-drawer-header">
          <h2 className="tag-drawer-title">
            {trackId ? "Track Tags" : "Album Tags"}
          </h2>
          <button className="tag-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tag-drawer-body">
          {isLoading ? (
            <div className="tag-drawer-empty">Loading tags…</div>
          ) : !normalizedTags ? (
            <div className="tag-drawer-empty">No normalized tags yet.</div>
          ) : (
            <>
              <UnmatchedSection
                albumId={albumId}
                albumArtist={albumArtist}
                albumName={albumName}
              />
              <TagSection
                title="Genres"
                tags={normalizedTags.genres}
                level="album"
                emptyMessage="No genres identified, try syncing in Settings."
                rawMap={rawMap}
                onIgnore={handleIgnoreUnmappedGenre}
              />
              <TagSection
                title="Descriptors"
                tags={normalizedTags.descriptors}
                level="album"
                rawMap={rawMap}
              />
              <TagSection
                title="Scenes & Movements"
                tags={normalizedTags.scenes}
                level="album"
              />
              {trackId && rawTrackTags && rawTrackTags.length > 0 && (
                <div className="tag-drawer-section tag-drawer-section--raw">
                  <h3 className="tag-drawer-section-title">
                    Raw file tags
                    <span className="tag-level-badge tag-level-badge--track">track</span>
                  </h3>
                  {rawTrackTags.map((t) => (
                    <div key={t.raw_value} className="tag-drawer-row">
                      <span className="tag-drawer-name">{t.raw_value}</span>
                      <SourceBadge source={t.source} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
