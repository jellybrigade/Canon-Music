import { useState } from "react";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { Music, User } from "lucide-react";
import type { SearchAlbum, SearchTrack, SearchArtist } from "../hooks/useSearch";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { RadioMode } from "../store/player";
import { getCoverArtUrl } from "../lib/navidrome";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import "./SearchResults.css";

interface Props {
  albums: SearchAlbum[];
  tracks: SearchTrack[];
  artists: SearchArtist[];
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (artist: SearchArtist) => void;
  onPlayTrack: (trackId: string) => void;
  onStartRadioFromAlbum: (album: AlbumRow, mode: RadioMode) => void;
  onStartRadioFromArtist: (artist: ArtistRow, mode: RadioMode) => void;
}

type AlbumMenu = { x: number; y: number; album: SearchAlbum };
type TrackMenu = { x: number; y: number; track: SearchTrack };
type ArtistMenu = { x: number; y: number; artist: SearchArtist };

const ARTIST_LIMIT = 12;
const ALBUM_LIMIT = 12;
const TRACK_LIMIT = 16;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function toAlbumRow(album: SearchAlbum, serverId: string): AlbumRow {
  return { id: album.id, server_id: serverId, name: album.name, artist: album.artist, year: null, artwork_url: album.artwork_url };
}

function trackAlbumRow(track: SearchTrack, serverId: string): AlbumRow {
  return { id: track.album_id, server_id: serverId, name: track.album_name ?? "", artist: track.artist, year: null, artwork_url: null };
}

function toArtistRow(artist: SearchArtist): ArtistRow {
  return { name: artist.name, album_count: artist.album_count, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null };
}

export function SearchResults({
  albums,
  tracks,
  artists,
  serverWithCredential,
  onSelectAlbum,
  onSelectArtist,
  onPlayTrack,
  onStartRadioFromAlbum,
  onStartRadioFromArtist,
}: Props) {
  const { server, credential } = serverWithCredential;
  const albumDisplayName = useAlbumDisplayName();
  const [showAllArtists, setShowAllArtists] = useState(false);
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [albumMenu, setAlbumMenu] = useState<AlbumMenu | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenu | null>(null);
  const [artistMenu, setArtistMenu] = useState<ArtistMenu | null>(null);

  const visibleArtists = showAllArtists ? artists : artists.slice(0, ARTIST_LIMIT);
  const visibleAlbums = showAllAlbums ? albums : albums.slice(0, ALBUM_LIMIT);
  const visibleTracks = showAllTracks ? tracks : tracks.slice(0, TRACK_LIMIT);

  const isEmpty = albums.length === 0 && tracks.length === 0 && artists.length === 0;

  if (isEmpty) {
    return (
      <div className="search-empty">
        No results
      </div>
    );
  }

  return (
    <div className="search-results">
      {artists.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">Artists</h2>
          <div className="search-artist-list">
            {visibleArtists.map((artist) => (
              <button
                key={artist.name}
                className="search-artist-row"
                onClick={() => onSelectArtist(artist)}
                onContextMenu={(e) => { e.preventDefault(); setArtistMenu({ x: e.clientX, y: e.clientY, artist }); }}
              >
                <div className="search-artist-icon">
                  <User size={16} />
                </div>
                <div className="search-artist-info">
                  <span className="search-item-primary">{artist.name}</span>
                  <span className="search-item-secondary">
                    {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {artists.length > ARTIST_LIMIT && !showAllArtists && (
            <button className="search-show-all" onClick={() => setShowAllArtists(true)}>
              Show all {artists.length} artists
            </button>
          )}
        </section>
      )}

      {albums.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">Albums</h2>
          <div className="search-album-list">
            {visibleAlbums.map((album) => (
              <button
                key={album.id}
                className="search-album-row"
                onClick={() => onSelectAlbum(toAlbumRow(album, server.id))}
                onContextMenu={(e) => { e.preventDefault(); setAlbumMenu({ x: e.clientX, y: e.clientY, album }); }}
              >
                <div className="search-album-thumb">
                  {album.artwork_url ? (
                    <img
                      src={getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 64)}
                      alt={album.name}
                      loading="lazy"
                    />
                  ) : (
                    <Music size={18} />
                  )}
                </div>
                <div className="search-album-info">
                  <span className="search-item-primary">{albumDisplayName(album.name)}</span>
                  {album.artist && (
                    <span className="search-item-secondary">{album.artist}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {albums.length > ALBUM_LIMIT && !showAllAlbums && (
            <button className="search-show-all" onClick={() => setShowAllAlbums(true)}>
              Show all {albums.length} albums
            </button>
          )}
        </section>
      )}

      {tracks.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">Tracks</h2>
          <div className="search-track-list">
            {visibleTracks.map((track) => (
              <button
                key={track.id}
                className="search-track-row"
                onClick={() => onPlayTrack(track.id)}
                onContextMenu={(e) => { e.preventDefault(); setTrackMenu({ x: e.clientX, y: e.clientY, track }); }}
              >
                <div className="search-track-thumb">
                  {track.artwork_url ? (
                    <img
                      src={getCoverArtUrl(server.url, server.username, credential, track.artwork_url, 64)}
                      alt={track.album_name ?? track.title}
                      loading="lazy"
                    />
                  ) : (
                    <Music size={16} />
                  )}
                </div>
                <div className="search-track-info">
                  <span className="search-item-primary">{track.title}</span>
                  <span className="search-item-secondary">
                    {[track.artist, track.album_name].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {track.duration != null && (
                  <span className="search-track-duration">{formatDuration(track.duration)}</span>
                )}
              </button>
            ))}
          </div>
          {tracks.length > TRACK_LIMIT && !showAllTracks && (
            <button className="search-show-all" onClick={() => setShowAllTracks(true)}>
              Show all {tracks.length} tracks
            </button>
          )}
        </section>
      )}

      {albumMenu && (
        <ContextMenu x={albumMenu.x} y={albumMenu.y} onClose={() => setAlbumMenu(null)}>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadioFromAlbum(toAlbumRow(albumMenu.album, server.id), mode); setAlbumMenu(null); }}
          />
        </ContextMenu>
      )}

      {trackMenu && (
        <ContextMenu x={trackMenu.x} y={trackMenu.y} onClose={() => setTrackMenu(null)}>
          <button onClick={() => { onPlayTrack(trackMenu.track.id); setTrackMenu(null); }}>Play</button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadioFromAlbum(trackAlbumRow(trackMenu.track, server.id), mode); setTrackMenu(null); }}
          />
        </ContextMenu>
      )}

      {artistMenu && (
        <ContextMenu x={artistMenu.x} y={artistMenu.y} onClose={() => setArtistMenu(null)}>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadioFromArtist(toArtistRow(artistMenu.artist), mode); setArtistMenu(null); }}
          />
        </ContextMenu>
      )}
    </div>
  );
}
