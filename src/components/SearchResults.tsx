import { useState } from "react";
import { Music, User } from "lucide-react";
import type { SearchAlbum, SearchTrack, SearchArtist } from "../hooks/useSearch";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import { getCoverArtUrl } from "../lib/navidrome";
import "./SearchResults.css";

interface Props {
  albums: SearchAlbum[];
  tracks: SearchTrack[];
  artists: SearchArtist[];
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onPlayTrack: (trackId: string) => void;
}

const GROUP_LIMIT = 5;

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SearchResults({
  albums,
  tracks,
  artists,
  serverWithCredential,
  onSelectAlbum,
  onPlayTrack,
}: Props) {
  const { server, credential } = serverWithCredential;
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [showAllArtists, setShowAllArtists] = useState(false);

  const visibleAlbums = showAllAlbums ? albums : albums.slice(0, GROUP_LIMIT);
  const visibleTracks = showAllTracks ? tracks : tracks.slice(0, GROUP_LIMIT);
  const visibleArtists = showAllArtists ? artists : artists.slice(0, GROUP_LIMIT);

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
      {albums.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">Albums</h2>
          <div className="search-album-list">
            {visibleAlbums.map((album) => (
              <button
                key={album.id}
                className="search-album-row"
                onClick={() =>
                  onSelectAlbum({
                    id: album.id,
                    server_id: server.id,
                    name: album.name,
                    artist: album.artist,
                    year: null,
                    artwork_url: album.artwork_url,
                  })
                }
              >
                <div className="search-album-thumb">
                  {album.artwork_url ? (
                    <img
                      src={getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 64)}
                      alt={album.name}
                    />
                  ) : (
                    <Music size={16} />
                  )}
                </div>
                <div className="search-album-info">
                  <span className="search-item-primary">{album.name}</span>
                  {album.artist && (
                    <span className="search-item-secondary">{album.artist}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {albums.length > GROUP_LIMIT && !showAllAlbums && (
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
              >
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
          {tracks.length > GROUP_LIMIT && !showAllTracks && (
            <button className="search-show-all" onClick={() => setShowAllTracks(true)}>
              Show all {tracks.length} tracks
            </button>
          )}
        </section>
      )}

      {artists.length > 0 && (
        <section className="search-group">
          <h2 className="search-group-title">Artists</h2>
          <div className="search-artist-list">
            {visibleArtists.map((artist) => (
              <div key={artist.name} className="search-artist-row">
                <div className="search-artist-icon">
                  <User size={14} />
                </div>
                <div className="search-artist-info">
                  <span className="search-item-primary">{artist.name}</span>
                  <span className="search-item-secondary">
                    {artist.album_count} {artist.album_count === 1 ? "album" : "albums"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {artists.length > GROUP_LIMIT && !showAllArtists && (
            <button className="search-show-all" onClick={() => setShowAllArtists(true)}>
              Show all {artists.length} artists
            </button>
          )}
        </section>
      )}
    </div>
  );
}
