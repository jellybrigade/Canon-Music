import { lazy, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, Search, X } from "lucide-react";
import { useSearch } from "../hooks/useSearch";
import { CredentialNotice } from "./CredentialNotice";
import type { ServerWithCredential } from "../hooks/useServer";
import type { Server } from "../types/server";
import type { AlbumRow, ArtistRow } from "../types/library";
import type { PlaylistRow } from "../hooks/usePlaylists";
import type { RadioMode } from "../store/player";

const SearchResults = lazy(() => import("./SearchResults").then((m) => ({ default: m.SearchResults })));

export interface SearchViewProps {
  server: Server | undefined;
  serverWithCred: ServerWithCredential | null;
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
  playlists: PlaylistRow[] | undefined;
  searchInputRef: RefObject<HTMLInputElement | null>;
  queueClass: string;
  leaveSearch: () => void;
  openAlbum: (album: AlbumRow) => void;
  openArtist: (artist: ArtistRow | string) => void;
  handlePlayTrack: (trackId: string) => Promise<void>;
  handleStartRadioFromAlbum: (album: AlbumRow, mode: RadioMode) => Promise<void>;
  handleStartRadioFromArtist: (artist: ArtistRow, mode: RadioMode) => Promise<void>;
  addAlbumToPlaylist: (playlist: PlaylistRow, albumId: string, serverWithCred: ServerWithCredential) => unknown;
}

export function SearchView({
  server,
  serverWithCred,
  credError,
  credPending,
  retryCredential,
  playlists,
  searchInputRef,
  queueClass,
  leaveSearch,
  openAlbum,
  openArtist,
  handlePlayTrack,
  handleStartRadioFromAlbum,
  handleStartRadioFromArtist,
  addAlbumToPlaylist,
}: SearchViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [searchRaw, setSearchRaw] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleChange = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(value.trim() ? { q: value } : {}, { replace: true });
    }, 200);
  }, [setSearchParams]);

  const clearInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchRaw("");
    setSearchParams({}, { replace: true });
    searchInputRef.current?.focus();
  }, [setSearchParams, searchInputRef]);

  // A callback ref fires on attach, whenever that is - unlike the effect this replaced, this
  // also focuses correctly on a cold mount straight at /search?q=... (a deep link, or Forward).
  const attachInput = useCallback((el: HTMLInputElement | null) => {
    searchInputRef.current = el;
    el?.focus();
    el?.select();
  }, [searchInputRef]);

  const { data: searchResults, isPending: searchPending, isError: searchError } = useSearch(query, server?.id);

  return (
    <main className={`library${queueClass}`}>
      <header className="library-header">
        <button className="search-back-btn" onClick={leaveSearch} title="Back">
          <ChevronLeft size={15} /> Back
        </button>
        <h1>Search</h1>
        <span className="server-name">{server?.display_name}</span>
        <div className="search-bar">
          <Search size={15} className="search-bar-icon" />
          <input
            ref={attachInput}
            type="text"
            className="search-bar-input"
            placeholder="Search…"
            value={searchRaw}
            onChange={(e) => handleChange(e.target.value)}
          />
          {searchRaw && (
            <button className="search-bar-clear" onClick={clearInput} title="Clear search" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      {!query ? (
        <p className="empty-state">Start typing to search</p>
      ) : !serverWithCred ? (
        <CredentialNotice credError={credError} credPending={credPending} retryCredential={retryCredential} />
      ) : searchError ? (
        <p className="empty-state">Search failed. The library database could not be read.</p>
      ) : searchPending || !searchResults ? (
        <p className="empty-state">Searching…</p>
      ) : (
        <SearchResults
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          artists={searchResults.artists}
          serverWithCredential={serverWithCred}
          playlists={playlists}
          onSelectAlbum={openAlbum}
          onSelectArtist={(artist) => openArtist({ name: artist.name, album_count: artist.album_count, artwork_url: null, lastfm_image_url: null, wikidata_image_url: null, navidrome_image_url: null, enriched_at: null })}
          onPlayTrack={(id) => { void handlePlayTrack(id); }}
          onStartRadioFromAlbum={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
          onStartRadioFromArtist={(artist, mode) => { void handleStartRadioFromArtist(artist, mode); }}
          onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
        />
      )}
    </main>
  );
}
