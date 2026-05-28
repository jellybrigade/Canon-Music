import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { useNormalizeAlbum } from "../hooks/useNormalizeAlbum";
import { usePendingEdits } from "../hooks/usePendingEdits";
import type { NormalizedTag } from "../lib/tag-normalize";
import "./TagDrawer.css";

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
    queryKey: ["track-raw-tags", trackId],
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

function SourceBadge({ source }: { source: string }) {
  const label = source === "lastfm" ? "last.fm" : source;
  return <span className={`tag-source-badge tag-source-badge--${source}`}>{label}</span>;
}

function TagSection({
  title,
  tags,
  trackId,
  onOverride,
}: {
  title: string;
  tags: NormalizedTag[];
  trackId?: string;
  onOverride: (tag: NormalizedTag) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-drawer-section">
      <h3 className="tag-drawer-section-title">{title}</h3>
      {tags.map((tag) => (
        <div key={tag.id ?? tag.name} className="tag-drawer-row">
          <span className="tag-drawer-name">{tag.name}</span>
          <SourceBadge source={tag.source} />
          <span className="tag-drawer-confidence">{Math.round(tag.confidence * 100)}%</span>
          {trackId && (
            <button className="tag-drawer-override" onClick={() => onOverride(tag)}>
              Override
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function TagDrawer({ albumId, albumArtist, albumName, trackId, onClose }: Props) {
  const { data: normalizedTags, isLoading } = useNormalizeAlbum(albumId, albumArtist, albumName);
  const { addPendingEdits } = usePendingEdits();
  const { data: rawTrackTags } = useTrackRawTags(trackId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleOverride(tag: NormalizedTag) {
    if (!trackId) return;
    const newValue = window.prompt(`Override "${tag.name}" with:`, tag.name);
    if (!newValue || newValue.trim() === tag.name) return;
    await addPendingEdits.mutateAsync({
      trackId,
      fieldChanges: [{ field: "genre", oldValue: tag.name, newValue: newValue.trim() }],
    });
  }

  return createPortal(
    <div className="tag-drawer-overlay" onClick={onClose}>
      <div className="tag-drawer" onClick={(e) => e.stopPropagation()}>
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
              <TagSection
                title="Genres"
                tags={normalizedTags.genres}
                trackId={trackId}
                onOverride={(tag) => void handleOverride(tag)}
              />
              <TagSection
                title="Descriptors"
                tags={normalizedTags.descriptors}
                trackId={trackId}
                onOverride={(tag) => void handleOverride(tag)}
              />
              <TagSection
                title="Scenes & Movements"
                tags={normalizedTags.scenes}
                trackId={trackId}
                onOverride={(tag) => void handleOverride(tag)}
              />
              {trackId && rawTrackTags && rawTrackTags.length > 0 && (
                <div className="tag-drawer-section tag-drawer-section--raw">
                  <h3 className="tag-drawer-section-title">Raw file tags</h3>
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
