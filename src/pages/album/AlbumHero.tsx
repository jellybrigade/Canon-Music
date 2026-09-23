import { useState } from "react";
import { Heart, Play, Disc, HelpCircle, ExternalLink, Shuffle, ListPlus, ListEnd } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAlbumDisplayName, useAlbumSuffixAllowlist, useAlbumSuffixExclusions, extractSuffix } from "../../hooks/useAlbumDisplayName";
import { useBoolSetting } from "../../hooks/useSetting";
import { ArtBackdrop } from "../../components/ArtBackdrop";
import type { AlbumRow } from "../../types/library";
import type { AlbumIdentityRow } from "../../features/enrichment/hooks/useAlbumIdentity";
import "./AlbumHero.css";

interface Props {
  album: AlbumRow;
  coverArtUrl: string | null;
  albumIdentity: AlbumIdentityRow | null | undefined;
  showUnidentified: boolean;
  tagsComputedAt: number | null;
  tagRefresh: { isRefreshing: boolean; error: string | null; onRefresh: () => void };
  playAction: string;
  canPlay: boolean;
  onPlayAlbum: () => void;
  isLoved: boolean;
  onToggleLove: () => void;
  onIdentify: () => void;
  onClose: () => void;
  onSelectArtist?: (artistName: string) => void;
}

function AlbumTitle({ album }: { album: AlbumRow }) {
  const albumDisplayName = useAlbumDisplayName();
  const [suffixAllowlist, addToSuffixAllowlist] = useAlbumSuffixAllowlist();
  const [suffixExcludedIds, excludeFromSuffix, unexcludeFromSuffix] = useAlbumSuffixExclusions();
  const [showFullTitle, setShowFullTitle] = useState(false);
  const [showAlbumSuffixes] = useBoolSetting("display.show_album_suffixes", false);
  const strippingEnabled = !showAlbumSuffixes;
  const detectedSuffix = extractSuffix(album.name);
  const suffixIsExcluded = suffixExcludedIds.includes(album.id);
  const suffixWasStripped = !suffixIsExcluded && albumDisplayName(album.name, album.id) !== album.name;
  const suffixCanBeAdded = strippingEnabled && detectedSuffix !== null && !suffixWasStripped &&
    !suffixAllowlist.some((s) => s.toLowerCase() === detectedSuffix.toLowerCase());

  return (
    <>
      <div className="album-detail-title-row">
        <h2 className="album-detail-title">
          {showFullTitle ? album.name : albumDisplayName(album.name, album.id)}
        </h2>
        {suffixWasStripped && (
          <button
            className="album-suffix-toggle-btn"
            onClick={() => setShowFullTitle((v) => !v)}
            title={showFullTitle ? "Hide full title" : "Show full title"}
          >
            {showFullTitle ? "Hide" : "···"}
          </button>
        )}
        {suffixWasStripped && showFullTitle && detectedSuffix && (
          <button
            className="album-suffix-toggle-btn"
            onClick={() => { void excludeFromSuffix(album.id); setShowFullTitle(false); }}
            title="Keep the suffix visible for this album only."
          >
            Keep
          </button>
        )}
      </div>
      {suffixCanBeAdded && detectedSuffix && (
        <button
          className="album-suffix-add-btn"
          onClick={() => void addToSuffixAllowlist(detectedSuffix)}
          title="Strips this parenthetical from all albums. Manage in Tags › Title Cleanup."
        >
          + Strip "({detectedSuffix})" from all albums
        </button>
      )}
      {suffixIsExcluded && detectedSuffix && (
        <button
          className="album-suffix-add-btn"
          onClick={() => void unexcludeFromSuffix(album.id)}
          title="Re-apply suffix stripping to this album."
        >
          ↩ Strip "({detectedSuffix})" again
        </button>
      )}
    </>
  );
}

export function AlbumHero({
  album,
  coverArtUrl,
  albumIdentity,
  showUnidentified,
  tagsComputedAt,
  tagRefresh,
  playAction,
  canPlay,
  onPlayAlbum,
  isLoved,
  onToggleLove,
  onIdentify,
  onClose,
  onSelectArtist,
}: Props) {
  // The album button does whatever album.play_action says, so its label and icon have to say so
  // too. A fixed "Play Album" is a lie for three of the four settings.
  const playActionLabel =
    playAction === "queue_last" ? "Add to Queue"
    : playAction === "queue_next" ? "Play Next"
    : playAction === "shuffle" ? "Shuffle Album"
    : "Play Album";
  const PlayActionIcon =
    playAction === "queue_last" ? ListEnd
    : playAction === "queue_next" ? ListPlus
    : playAction === "shuffle" ? Shuffle
    : Play;

  return (
    <div className="album-detail-header">
      <ArtBackdrop imageUrl={coverArtUrl} className="album-detail-hero-bg" />
      <button className="album-detail-back" onClick={onClose}>
        ← Back
      </button>
      <div className="album-detail-hero">
        {coverArtUrl ? (
          <img className="album-detail-art" src={coverArtUrl} alt={album.name} />
        ) : (
          <div className="album-detail-art album-art--placeholder" />
        )}
        <div className="album-detail-meta">
          <AlbumTitle album={album} />
          {album.artist && (
            onSelectArtist ? (
              <span
                className="album-detail-artist album-detail-artist--link"
                onClick={() => onSelectArtist(album.artist!)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onSelectArtist(album.artist!)}
              >
                {album.artist}
              </span>
            ) : (
              <p className="album-detail-artist">{album.artist}</p>
            )
          )}
          {album.year && !(albumIdentity?.confirmed_at && albumIdentity.release_date) && (
            <p className="album-detail-year">{album.year}</p>
          )}
          {albumIdentity?.confirmed_at ? (
            (albumIdentity.release_date || albumIdentity.label || albumIdentity.country) && (
              <div className="album-detail-identity">
                <p className="mb-verified-facts">
                  {albumIdentity.release_date && (
                    <span>{albumIdentity.release_date.slice(0, 4)}</span>
                  )}
                  {albumIdentity.label && <span>{albumIdentity.label}</span>}
                  {albumIdentity.country && <span>{albumIdentity.country}</span>}
                  {albumIdentity.catalog_number && <span>{albumIdentity.catalog_number}</span>}
                </p>
              </div>
            )
          ) : showUnidentified ? (
            <button
              className="album-unidentified-badge"
              onClick={onIdentify}
              title="Album not identified on MusicBrainz, click to identify"
            >
              <HelpCircle size={12} /> Unidentified
            </button>
          ) : null}
          <div className="album-meta-refresh-line">
            {tagsComputedAt ? (
              <span className="album-meta-refresh-hint">
                Tags updated {Math.floor((Date.now() / 1000 - tagsComputedAt) / 86400) === 0
                  ? "today"
                  : `${Math.floor((Date.now() / 1000 - tagsComputedAt) / 86400)}d ago`}
              </span>
            ) : null}
            <button
              className="album-meta-refresh-btn"
              onClick={tagRefresh.onRefresh}
              disabled={tagRefresh.isRefreshing}
            >
              {tagRefresh.isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            {tagRefresh.error && (
              <span className="album-meta-refresh-error" role="status">{tagRefresh.error}</span>
            )}
          </div>
          <div className="album-detail-actions">
            <button
              className="play-album-btn"
              onClick={onPlayAlbum}
              disabled={!canPlay}
              aria-label={playActionLabel}
            >
              <PlayActionIcon size={16} /> {playActionLabel}
            </button>
            <button
              className={`album-identify-btn${isLoved ? " album-identify-btn--loved" : ""}`}
              onClick={onToggleLove}
              aria-label={isLoved ? "Unlove album" : "Love album"}
              title={isLoved ? "Unlove album" : "Love album"}
            >
              <Heart size={14} fill={isLoved ? "currentColor" : "none"} strokeWidth={isLoved ? 0 : 2} />
            </button>
            <button
              className="album-identify-btn"
              onClick={onIdentify}
              aria-label="Identify album"
              title="Identify on MusicBrainz"
            >
              <Disc size={14} />
            </button>
            {albumIdentity?.confirmed_at && albumIdentity.mb_release_id && (
              <button
                className="album-identify-btn"
                onClick={() => void openUrl(`https://musicbrainz.org/release/${albumIdentity.mb_release_id}`)}
                aria-label="Open on MusicBrainz"
                title="Open on MusicBrainz"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
