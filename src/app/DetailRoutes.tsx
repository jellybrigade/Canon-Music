import { lazy, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CredentialNotice } from "../components/CredentialNotice";
import { getDb } from "../db";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import type { PlaylistRow, usePlaylists } from "../features/playlists/usePlaylists";
import { QK } from "../lib/queryKeys";

const AlbumDetail = lazy(() => import("../pages/AlbumDetail").then((m) => ({ default: m.AlbumDetail })));
const ArtistDetail = lazy(() => import("../pages/ArtistDetail").then((m) => ({ default: m.ArtistDetail })));
const PlaylistDetail = lazy(() => import("../features/playlists/PlaylistDetail").then((m) => ({ default: m.PlaylistDetail })));

type PlaylistApi = ReturnType<typeof usePlaylists>;

/** The notice plus the page chrome a detail route would otherwise have rendered around it. */
function CredentialGate({
  credError,
  credPending,
  retryCredential,
  queueClass,
}: {
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
  queueClass: string;
}) {
  return (
    <main className={`library${queueClass}`}>
      <CredentialNotice credError={credError} credPending={credPending} retryCredential={retryCredential} />
    </main>
  );
}

export function AlbumDetailRoute({
  serverWithCred,
  credError,
  credPending,
  retryCredential,
  onSelectAlbum,
  onSelectArtist,
  onTagFilter,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onTagFilter: (canonicalId: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { albumId } = useParams<{ albumId: string }>();
  const { data: fetchedAlbum, isPending: albumPending } = useQuery<AlbumRow | null>({
    queryKey: QK.albumById(albumId, serverWithCred?.server.id),
    enabled: !!albumId && !!serverWithCred,
    queryFn: async () => {
      const db = await getDb();
      // Scoped by server because everything below builds its cover and stream URLs from the
      // *selected* server's credential: an unscoped lookup happily resolved another server's
      // row and then pointed every request at the wrong host.
      const rows = await db.select<AlbumRow[]>(
        `SELECT id, server_id, name, artist, year, artwork_url, release_type, accent_color
         FROM albums WHERE id = ? AND server_id = ?`,
        // `useParams` has already decoded the segment, so `albumId` is the id `albumPath`
        // encoded. Decoding again throws on an id holding a literal `%` and silently
        // rewrites one holding the text `%20` into a space.
        [albumId!, serverWithCred!.server.id]
      );
      return rows[0] ?? null;
    },
  });
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} retryCredential={retryCredential} queueClass={queueClass} />;
  }
  // `data` is undefined while the lookup is in flight as well as when the album is genuinely
  // absent from the mirror, so the old `fetchedAlbum ?? null` folded both into one bare
  // `return null` and painted a blank page for each. Same split, and the same copy shape, as
  // PlaylistDetailRoute below.
  if (!fetchedAlbum) {
    return (
      <main className={`library${queueClass}`}>
        {albumPending ? (
          <p className="empty-state">Loading album…</p>
        ) : (
          <p className="empty-state">
            That album is no longer here. It may have been removed from the server.
          </p>
        )}
      </main>
    );
  }
  return (
    <main className={`library${queueClass}`}>
      <AlbumDetail
        album={fetchedAlbum}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
        onTagFilter={onTagFilter}
      />
    </main>
  );
}

export function ArtistDetailRoute({
  serverWithCred,
  credError,
  credPending,
  retryCredential,
  onSelectAlbum,
  onSelectArtist,
  onClose,
  queueClass,
}: {
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string) => void;
  onClose: () => void;
  queueClass: string;
}) {
  const { artistName } = useParams<{ artistName: string }>();
  // `useParams` decodes the segment already, so this is the name `artistPath` encoded.
  // Decoding a second time threw `URIError` on any name holding a literal `%` - in the
  // render body, so it took the whole tree down, not just this route.
  const decodedName = artistName ?? null;
  const { data: fetchedArtist, isPending: artistPending } = useQuery<ArtistRow | null>({
    queryKey: QK.artistByName(artistName, serverWithCred?.server.id),
    enabled: !!artistName && !!serverWithCred,
    queryFn: async () => {
      const db = await getDb();
      const serverId = serverWithCred!.server.id;
      // Matched case-insensitively because the name in the URL can come from a
      // Last.fm similar-artist card, whose spelling drifts from the local one
      // ("Tyler, The Creator" vs "Tyler, the Creator"). `a.name` is selected, so
      // everything downstream queries with the library's own spelling and finds
      // the artist's albums and tracks.
      const rows = await db.select<ArtistRow[]>(
        `SELECT a.name, a.album_count,
           (SELECT al.artwork_url FROM albums al
            WHERE al.artist = a.name AND al.server_id = a.server_id AND al.artwork_url IS NOT NULL
            LIMIT 1) AS artwork_url,
           ai.lastfm_image_url,
           ai.wikidata_image_url
         FROM artists a
         LEFT JOIN artist_identity ai ON ai.artist_name = a.name
         WHERE LOWER(TRIM(a.name)) = LOWER(TRIM(?)) AND a.server_id = ?`,
        [decodedName!, serverId]
      );
      return rows[0] ?? null;
    },
  });
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} retryCredential={retryCredential} queueClass={queueClass} />;
  }
  if (!decodedName) return null;
  // Held until the lookup settles: `data` is undefined while pending as well as
  // when the artist is genuinely absent, so rendering the fallback immediately
  // painted a library artist's hero as "0 albums in library" with no portrait
  // for the length of the query, then swapped it out.
  if (artistPending) return <main className={`library${queueClass}`} />;
  // Recommended/similar artists surfaced in an artist view are not in the local
  // `artists` table, so the lookup above misses. Fall back to a minimal row
  // synthesized from the URL name (same shape openArtist(string) builds) so
  // ArtistDetail still renders and can enrich/look up by name, instead of
  // hard-returning null (which painted a black screen).
  const artist: ArtistRow = fetchedArtist ?? {
    name: decodedName,
    album_count: 0,
    artwork_url: null,
    lastfm_image_url: null,
    wikidata_image_url: null,
    navidrome_image_url: null,
    enriched_at: null,
  };
  return (
    <main className={`library${queueClass}`}>
      <ArtistDetail
        key={artist.name}
        artist={artist}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
      />
    </main>
  );
}

export function PlaylistDetailRoute({
  serverWithCred,
  credError,
  credPending,
  retryCredential,
  playlists,
  onSelectAlbum,
  onSelectArtist,
  onClose,
  queueClass,
  deletePlaylist,
  renamePlaylist,
  setCustomCover,
  refreshSmartPlaylist,
  updateSmartPlaylistRules,
}: {
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
  playlists: PlaylistRow[] | undefined;
  onSelectAlbum: (albumId: string) => void;
  onSelectArtist: (name: string) => void;
  onClose: () => void;
  queueClass: string;
  deletePlaylist: PlaylistApi["deletePlaylist"];
  renamePlaylist: PlaylistApi["renamePlaylist"];
  setCustomCover: PlaylistApi["setCustomCover"];
  refreshSmartPlaylist: PlaylistApi["refreshSmartPlaylist"];
  updateSmartPlaylistRules: PlaylistApi["updateSmartPlaylistRules"];
}) {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  // Resolved out of the same list the playlists view renders rather than through a second
  // query of its own. The previous `["playlist-by-id"]` key was outside `QK` and nothing
  // invalidated it, while every playlist mutation signals through the playlist session
  // store instead - so renaming, editing the description, setting a cover or refreshing a
  // smart playlist from this page left the row this component rendered untouched, and the
  // edit visibly reverted until the default staleTime lapsed.
  // Already decoded by `useParams`; see the note in `ArtistDetailRoute`.
  const decodedId = playlistId ?? null;
  const playlist = useMemo(
    () => (decodedId ? playlists?.find((p) => p.id === decodedId) ?? null : null),
    [playlists, decodedId]
  );
  if (!serverWithCred) {
    return <CredentialGate credError={credError} credPending={credPending} retryCredential={retryCredential} queueClass={queueClass} />;
  }
  if (!playlist) {
    return (
      <main className={`library${queueClass}`}>
        {playlists === undefined ? (
          <p className="empty-state">Loading playlist…</p>
        ) : (
          <p className="empty-state">
            That playlist is no longer here. It may have been deleted on the server.
          </p>
        )}
      </main>
    );
  }
  return (
    <main className={`library${queueClass}`}>
      <PlaylistDetail
        playlist={playlist}
        serverWithCredential={serverWithCred}
        onClose={onClose}
        onDelete={async () => {
          await deletePlaylist(playlist, serverWithCred);
          navigate("/playlists");
        }}
        onRename={renamePlaylist}
        onRefreshSmart={refreshSmartPlaylist}
        onUpdateSmartRules={updateSmartPlaylistRules}
        onSetCustomCover={setCustomCover}
        onSelectAlbum={onSelectAlbum}
        onSelectArtist={onSelectArtist}
      />
    </main>
  );
}
