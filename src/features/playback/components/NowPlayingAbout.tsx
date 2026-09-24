import { useState, type ReactNode } from "react";
import { Play, ListEnd, PlayCircle } from "lucide-react";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack, RadioMode } from "../store/playerTypes";
import { formatDuration } from "../hooks/useSeekBar";
import type { TopTrack, SuggestedTrack } from "../hooks/useNowPlayingArtist";
import { useAlbumDisplayName } from "../../../hooks/useAlbumDisplayName";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { AlbumRow } from "../../../types/library";
import { getCoverArtUrl, getStreamUrl } from "../../../clients/navidromeUrls";
import type { BandsintownEvent } from "../../../clients/bandsintown";
import { stripServerPrefix } from "../../../lib/ids";
import { TourCard } from "../../../components/TourCard";
import { ContextMenu } from "../../../ui/ContextMenu";
import { StartRadioSubmenu } from "../../radio/components/StartRadioSubmenu";
import "./NowPlayingAbout.css";

type AboutTrack = TopTrack | SuggestedTrack;

export interface TourState {
  enabled: boolean;
  loading: boolean;
  events: BandsintownEvent[];
  onEnable: () => void;
}

interface Props {
  serverWithCredential: ServerWithCredential;
  primaryArtist: string | null;
  pending: boolean;
  otherAlbums: AlbumRow[];
  topTracks: TopTrack[] | undefined;
  suggestedTracks: SuggestedTrack[] | undefined;
  tour: TourState;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
}

export function NowPlayingAbout({
  serverWithCredential, primaryArtist, pending, otherAlbums, topTracks, suggestedTracks, tour,
  onSelectAlbum, onSelectArtist, onStartRadio,
}: Props) {
  const next = usePlayerStore((s) => s.next);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const albumDisplayName = useAlbumDisplayName();
  const [albumChipMenu, setAlbumChipMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; track: AboutTrack } | null>(null);
  const { server, credential } = serverWithCredential;

  const streamUrlFor = (ct: CurrentTrack) =>
    getStreamUrl(server.url, server.username, credential, stripServerPrefix(ct.id, server.id));

  function buildTrack(t: AboutTrack): CurrentTrack {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      coverArtUrl: t.artwork_url
        ? getCoverArtUrl(server.url, server.username, credential, t.artwork_url, 64)
        : null,
      artworkRef: t.artwork_url ?? null,
      album: t.album_name ?? null,
      albumId: t.album_id ?? null,
    };
  }

  function albumOf(t: AboutTrack, albumId: string): AlbumRow {
    return {
      id: albumId,
      server_id: server.id,
      name: t.album_name ?? "",
      artist: t.artist,
      year: null,
      artwork_url: t.artwork_url,
    };
  }

  function handlePlayTrack(t: AboutTrack) {
    playNext(buildTrack(t), streamUrlFor);
    void next();
  }

  function handleAddToQueue(t: AboutTrack) {
    addToQueue(buildTrack(t), streamUrlFor);
  }

  function handlePlayNext(t: AboutTrack) {
    playNext(buildTrack(t), streamUrlFor);
  }

  function renderTrackRow(track: AboutTrack, placeholder: ReactNode, subtitle: ReactNode) {
    return (
      <div key={track.id} className="now-playing-track-row" onContextMenu={(e) => { e.preventDefault(); setTrackMenu({ x: e.clientX, y: e.clientY, track }); }}>
        {track.artwork_url
          ? <img className="now-playing-track-thumb" src={getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)} alt="" />
          : placeholder}
        <div className="now-playing-track-info">
          <span className="now-playing-track-title">{track.title}</span>
          {subtitle}
        </div>
        {track.duration && (
          <span className="now-playing-track-duration">
            {formatDuration(track.duration)}
          </span>
        )}
        <div className="now-playing-track-actions">
          <button
            className="now-playing-track-action-btn"
            title="Play now"
            onClick={(e) => { e.stopPropagation(); handlePlayTrack(track); }}
          >
            <PlayCircle size={16} />
          </button>
          <button
            className="now-playing-track-action-btn"
            title="Play next"
            onClick={(e) => { e.stopPropagation(); handlePlayNext(track); }}
          >
            <Play size={14} />
          </button>
          <button
            className="now-playing-track-action-btn"
            title="Add to queue"
            onClick={(e) => { e.stopPropagation(); handleAddToQueue(track); }}
          >
            <ListEnd size={16} />
          </button>
        </div>
      </div>
    );
  }

  const menuAlbumId = trackMenu?.track.album_id ?? null;

  return (
    <>
      {pending && (
        <div className="now-playing-about-skeleton" aria-hidden="true">
          <div className="now-playing-about-skeleton-title" />
          <div className="now-playing-about-skeleton-chips">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="now-playing-about-skeleton-chip" />
            ))}
          </div>
          <div className="now-playing-about-skeleton-title" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="now-playing-about-skeleton-row">
              <div className="now-playing-about-skeleton-thumb" />
              <div className="now-playing-about-skeleton-bar" />
            </div>
          ))}
        </div>
      )}

      {otherAlbums.length > 0 && (
        <div className="now-playing-more-section">
          <h3 className="now-playing-section-title">More from {primaryArtist}</h3>
          <div className="now-playing-album-scroll">
            {otherAlbums.map((album) => {
              const thumbUrl = album.artwork_url
                ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 120)
                : null;
              return (
                <button
                  key={album.id}
                  className="now-playing-album-chip"
                  onClick={() => onSelectAlbum(album)}
                  onContextMenu={(e) => { e.preventDefault(); setAlbumChipMenu({ x: e.clientX, y: e.clientY, album }); }}
                >
                  {thumbUrl
                    ? <img src={thumbUrl} alt={album.name} className="now-playing-album-chip-art" />
                    : <div className="now-playing-album-chip-art now-playing-album-chip-art--placeholder" />
                  }
                  <span className="now-playing-album-chip-name">{albumDisplayName(album.name)}</span>
                  {album.year && <span className="now-playing-album-chip-year">{album.year}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {topTracks && topTracks.length > 0 && (
        <div className="now-playing-more-section">
          <h3 className="now-playing-section-title">Top tracks by {primaryArtist}</h3>
          <div className="now-playing-top-tracks-grid">
            {topTracks.slice(0, 10).map((track, i) => renderTrackRow(
              track,
              <span className="now-playing-track-num">{i + 1}</span>,
              track.album_name && (
                <span className="now-playing-track-album">{albumDisplayName(track.album_name, track.album_id ?? undefined)}</span>
              ),
            ))}
          </div>
        </div>
      )}

      {suggestedTracks && suggestedTracks.length > 0 && (
        <div className="now-playing-more-section">
          <h3 className="now-playing-section-title">Suggested</h3>
          <div className="now-playing-top-tracks-grid">
            {suggestedTracks.slice(0, 10).map((track) => renderTrackRow(
              track,
              <span className="now-playing-track-num" />,
              <span className="now-playing-track-album">
                {[track.artist, track.album_name ? albumDisplayName(track.album_name, track.album_id ?? undefined) : null].filter(Boolean).join(" - ")}
              </span>,
            ))}
          </div>
        </div>
      )}

      {!pending && otherAlbums.length === 0 && (!topTracks || topTracks.length === 0) && (
        <p className="now-playing-empty">
          Nothing else by {primaryArtist ?? "this artist"} in your library yet. Other
          albums and top tracks show up here once they are synced.
        </p>
      )}

      {primaryArtist && (
        <TourCard
          artistName={primaryArtist}
          enabled={tour.enabled}
          loading={tour.loading}
          events={tour.events}
          onEnable={tour.onEnable}
        />
      )}

      {albumChipMenu && (
        <ContextMenu x={albumChipMenu.x} y={albumChipMenu.y} onClose={() => setAlbumChipMenu(null)}>
          <button onClick={() => { onSelectAlbum(albumChipMenu.album); setAlbumChipMenu(null); }}>Go to Album</button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadio(albumChipMenu.album, mode); setAlbumChipMenu(null); }}
          />
        </ContextMenu>
      )}

      {trackMenu && (
        <ContextMenu x={trackMenu.x} y={trackMenu.y} onClose={() => setTrackMenu(null)}>
          <button onClick={() => { handlePlayTrack(trackMenu.track); setTrackMenu(null); }}>Play now</button>
          <button onClick={() => { handlePlayNext(trackMenu.track); setTrackMenu(null); }}>Play next</button>
          <button onClick={() => { handleAddToQueue(trackMenu.track); setTrackMenu(null); }}>Add to queue</button>
          {menuAlbumId && (
            <button onClick={() => { onSelectAlbum(albumOf(trackMenu.track, menuAlbumId)); setTrackMenu(null); }}>
              Go to Album
            </button>
          )}
          {onSelectArtist && trackMenu.track.artist && (
            <button onClick={() => { onSelectArtist(trackMenu.track.artist!); setTrackMenu(null); }}>
              Go to Artist
            </button>
          )}
          {menuAlbumId && (
            <StartRadioSubmenu
              onSelect={(mode) => { onStartRadio(albumOf(trackMenu.track, menuAlbumId), mode); setTrackMenu(null); }}
            />
          )}
        </ContextMenu>
      )}
    </>
  );
}
