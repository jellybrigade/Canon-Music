import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Music, Users, Tag, Tags, Calendar, Settings, Heart, Search, X, ListMusic, FilePen, AlertTriangle, Radio } from "lucide-react";
import { AddServerModal } from "./components/AddServerModal";
import { AlbumGrid } from "./components/AlbumGrid";
import { AlbumDetail } from "./components/AlbumDetail";
import { ArtistGrid } from "./components/ArtistGrid";
import { ArtistDetail } from "./components/ArtistDetail";
import { GenreList } from "./components/GenreList";
import { YearView } from "./components/YearView";
import { PlaylistList } from "./components/PlaylistList";
import { PlaylistDetail } from "./components/PlaylistDetail";
import { SearchResults } from "./components/SearchResults";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { NowPlayingOverlay } from "./components/NowPlayingOverlay";
import { SettingsView } from "./components/SettingsView";
import { PendingChangesView } from "./components/PendingChangesView";
import { TagsView } from "./components/TagsView";
import { TagIssuesView } from "./components/TagIssuesView";
import { RadioView } from "./components/RadioView";
import { useServers, useServerWithCredential } from "./hooks/useServer";
import { useAlbums } from "./hooks/useAlbums";
import { useArtists } from "./hooks/useArtists";
import { useGenres, useAlbumsByGenre } from "./hooks/useGenres";
import { useLoved } from "./hooks/useLoved";
import { useSearch } from "./hooks/useSearch";
import { useSetting } from "./hooks/useSetting";
import { usePlaylists } from "./hooks/usePlaylists";
import type { PlaylistRow } from "./hooks/usePlaylists";
import { useTagIssues } from "./hooks/useTagIssues";
import { useScrobbleFlush } from "./hooks/useScrobbleFlush";
import { useMediaSession } from "./hooks/useMediaSession";
import { useRadio } from "./hooks/useRadio";
import { syncLibrary } from "./lib/sync";
import { getCoverArtUrl, getStreamUrl } from "./lib/navidrome";
import { stripServerPrefix } from "./lib/ids";
import { getDb } from "./db";
import { useTrackEndedListener } from "./hooks/useTrackEndedListener";
import { useScrobble } from "./hooks/useScrobble";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { usePlayerStore } from "./store/player";
import type { Server } from "./types/server";
import type { AlbumRow } from "./hooks/useAlbums";
import type { AlbumSort } from "./hooks/useAlbums";
import type { ArtistRow } from "./hooks/useArtists";
import type { GenreRow } from "./hooks/useGenres";
import "./App.css";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";
type View = "library" | "artists" | "genres" | "years" | "playlists" | "tags" | "pending" | "issues" | "radio" | "settings";

export default function App() {
  useTrackEndedListener();
  useMediaSession();
  useRadio();
  const loadSettings = usePlayerStore((s) => s.loadSettings);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const elapsed = usePlayerStore((s) => s.elapsed);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  useScrobble(currentTrack, elapsed);

  const { data: servers, isLoading: serversLoading } = useServers();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>("library");
  const [lovedOnly, setLovedOnly] = useState(false);
  const { lovedAlbumIds } = useLoved();

  const [rawSort, setSort] = useSetting("library_sort", "artist");
  const sort = (["artist", "alphabetical", "year", "recently_added"].includes(rawSort)
    ? rawSort
    : "artist") as AlbumSort;
  const [selectedGenreFilters, setSelectedGenreFilters] = useState<string[]>([]);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const genreDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!genreDropdownOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(e.target as Node)) {
        setGenreDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [genreDropdownOpen]);

  const [selectedArtist, setSelectedArtist] = useState<ArtistRow | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<GenreRow | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistRow | null>(null);
  const { data: playlists, createPlaylist, deletePlaylist } = usePlaylists();

  const [searchRaw, setSearchRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: searchResults } = useSearch(searchQuery);

  const handleSearchChange = useCallback((value: string) => {
    setSearchRaw(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 200);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchRaw("");
    setSearchQuery("");
    setSearchOpen(false);
    searchInputRef.current?.blur();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      }
      if (e.key === "Escape" && (searchRaw || searchOpen)) {
        clearSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchRaw, searchOpen, clearSearch]);

  const play = usePlayerStore((s) => s.play);
  const setStreamUrlFor = usePlayerStore((s) => s.setStreamUrlFor);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const server = servers?.[0];
  const { data: serverWithCred, error: credError } = useServerWithCredential(server?.id);
  useGlobalShortcuts(serverWithCred);
  useScrobbleFlush(serverWithCred);
  const { issueCount } = useTagIssues();
  const { data: albums } = useAlbums(sort, selectedGenreFilters);
  const { data: artists } = useArtists();
  const { data: genres } = useGenres();
  const { data: genreAlbums } = useAlbumsByGenre(selectedGenre?.name ?? null);

  useEffect(() => {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    setStreamUrlFor((track) => {
      const navTrackId = track.id.slice(srv.id.length + 1);
      return getStreamUrl(srv.url, srv.username, credential, navTrackId);
    });
  }, [serverWithCred, setStreamUrlFor]);

  const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "library", label: "Library", icon: <Music size={18} /> },
    { id: "artists", label: "Artists", icon: <Users size={18} /> },
    { id: "genres", label: "Genres", icon: <Tag size={18} /> },
    { id: "years", label: "Years", icon: <Calendar size={18} /> },
    { id: "playlists", label: "Playlists", icon: <ListMusic size={18} /> },
    { id: "radio", label: "Radio", icon: <Radio size={18} /> },
    { id: "tags", label: "Tags", icon: <Tags size={18} /> },
    { id: "issues", label: "Issues", icon: <AlertTriangle size={18} />, badge: issueCount > 0 ? issueCount : undefined },
    { id: "pending", label: "Pending", icon: <FilePen size={18} /> },
    { id: "settings", label: "Settings", icon: <Settings size={18} /> },
  ];

  const syncedRef = useRef<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string>("");
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRow | null>(null);

  function navigateTo(v: View) {
    setView(v);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setSelectedGenre(null);
    setSelectedPlaylist(null);
    setSelectedGenreFilters([]);
  }

  async function handlePlayTrack(trackId: string) {
    if (!serverWithCred) return;
    const { server: srv, credential } = serverWithCred;
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string };
    const rows = await db.select<TrackRow[]>(
      "SELECT id, title, artist, duration, album_id FROM tracks WHERE id = ?",
      [trackId]
    );
    const t = rows[0];
    if (!t) return;
    type AlbumRow = { artwork_url: string | null; name: string };
    const albumRows = await db.select<AlbumRow[]>(
      "SELECT artwork_url, name FROM albums WHERE id = ?",
      [t.album_id]
    );
    const albumData = albumRows[0] ?? null;
    const artworkUrl = albumData?.artwork_url ?? null;
    const navTrackId = stripServerPrefix(t.id, srv.id);
    const coverArtUrl = artworkUrl
      ? getCoverArtUrl(srv.url, srv.username, credential, artworkUrl, 64)
      : null;
    const streamUrl = getStreamUrl(srv.url, srv.username, credential, navTrackId);
    await play({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: artworkUrl, album: albumData?.name ?? null, albumId: t.album_id }, streamUrl);
  }

  function runSync(s: Server) {
    setSyncStatus("syncing");
    setSyncError("");
    syncLibrary(s)
      .then(({ failedAlbums, failedPlaylists }) => {
        const hasPartialFailure = failedAlbums > 0 || failedPlaylists > 0;
        setSyncStatus(hasPartialFailure ? "partial" : "done");
        if (hasPartialFailure) {
          const parts = [];
          if (failedAlbums > 0) parts.push(`${failedAlbums} album${failedAlbums > 1 ? "s" : ""}`);
          if (failedPlaylists > 0) parts.push(`${failedPlaylists} playlist${failedPlaylists > 1 ? "s" : ""}`);
          setSyncError(`Sync partial — failed to fetch tracks for ${parts.join(" and ")}.`);
        }
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ["albums"] }),
          queryClient.invalidateQueries({ queryKey: ["artists"] }),
          queryClient.invalidateQueries({ queryKey: ["genres"] }),
          queryClient.invalidateQueries({ queryKey: ["loved_tracks"] }),
          queryClient.invalidateQueries({ queryKey: ["loved_albums"] }),
          queryClient.invalidateQueries({ queryKey: ["playlists"] }),
          queryClient.invalidateQueries({ queryKey: ["tag_issues"] }),
        ]);
      })
      .catch((err: unknown) => {
        setSyncStatus("error");
        setSyncError(err instanceof Error ? err.message : String(err));
        console.error("Sync failed:", err);
      });
  }

  useEffect(() => {
    if (!server || syncedRef.current === server.id) return;
    syncedRef.current = server.id;
    runSync(server);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  if (serversLoading) return null;

  if (!servers || servers.length === 0) {
    return (
      <AddServerModal
        onSuccess={(newServer: Server) => {
          queryClient.setQueryData(["servers"], [newServer]);
        }}
      />
    );
  }

  function renderLibraryContent() {
    if (!serverWithCred || albums === undefined) {
      return <p className="empty-state">Loading…</p>;
    }
    if (selectedAlbum) {
      return (
        <AlbumDetail
          album={selectedAlbum}
          serverWithCredential={serverWithCred}
          onClose={() => setSelectedAlbum(null)}
        />
      );
    }
    if (searchQuery && searchResults) {
      return (
        <SearchResults
          albums={searchResults.albums}
          tracks={searchResults.tracks}
          artists={searchResults.artists}
          serverWithCredential={serverWithCred}
          onSelectAlbum={(album) => {
            clearSearch();
            setSelectedAlbum(album);
          }}
          onPlayTrack={(id) => { void handlePlayTrack(id); }}
        />
      );
    }
    if (searchQuery && !searchResults) {
      return <p className="empty-state">Searching…</p>;
    }
    const visibleAlbums = lovedOnly
      ? albums.filter((a) => lovedAlbumIds.has(a.id))
      : albums;
    return (
      <AlbumGrid
        albums={visibleAlbums}
        serverWithCredential={serverWithCred}
        onSelect={setSelectedAlbum}
      />
    );
  }

  const queueClass = isQueueOpen ? " library--queue-open" : "";

  function renderAlbumDetail() {
    if (!selectedAlbum || !serverWithCred) return null;
    return (
      <AlbumDetail
        album={selectedAlbum}
        serverWithCredential={serverWithCred}
        onClose={() => setSelectedAlbum(null)}
      />
    );
  }

  const SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
    { value: "recently_added", label: "Recent" },
    { value: "artist", label: "Artist" },
    { value: "alphabetical", label: "A–Z" },
    { value: "year", label: "Year" },
  ];

  function toggleGenreFilter(name: string) {
    setSelectedGenreFilters((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    );
  }

  function renderSearchBar() {
    return (
      <div className="search-bar">
        <Search size={13} className="search-bar-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="search-bar-input"
          placeholder="Search…"
          value={searchRaw}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {searchRaw && (
          <button className="search-bar-clear" onClick={clearSearch} title="Clear search">
            <X size={12} />
          </button>
        )}
      </div>
    );
  }

  function renderContent() {
    if (searchOpen || searchQuery) {
      return (
        <main className={`library${queueClass}`}>
          <header className="library-header">
            <h1>Search</h1>
            <span className="server-name">{server?.display_name}</span>
            {renderSearchBar()}
            <button className="search-bar-clear" onClick={clearSearch} title="Close search" style={{ marginLeft: "auto" }}>
              <X size={13} />
            </button>
          </header>
          {serverWithCred && searchResults && searchQuery ? (
            <SearchResults
              albums={searchResults.albums}
              tracks={searchResults.tracks}
              artists={searchResults.artists}
              serverWithCredential={serverWithCred}
              onSelectAlbum={(album) => {
                clearSearch();
                setSelectedAlbum(album);
                setView("library");
              }}
              onPlayTrack={(id) => { void handlePlayTrack(id); }}
            />
          ) : (
            <p className="empty-state">{searchQuery ? "Searching…" : "Start typing to search"}</p>
          )}
        </main>
      );
    }

    switch (view) {
      case "library":
        return (
          <main className={`library${queueClass}`}>
            <header className="library-header">
              <h1>Canon</h1>
              <span className="server-name">{server?.display_name}</span>
              {syncStatus === "syncing" && (
                <span className="sync-status">Syncing…</span>
              )}
              {syncStatus === "error" && (
                <span className="sync-status sync-status--error" title={syncError}>
                  Sync failed: {syncError}
                </span>
              )}
              {syncStatus === "partial" && (
                <span className="sync-status sync-status--error" title={syncError ?? undefined}>
                  {syncError}
                </span>
              )}
              {credError && (
                <span className="sync-status sync-status--error">
                  Credential error: {credError instanceof Error ? credError.message : String(credError)}
                </span>
              )}
              <div className="sort-bar">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`sort-btn${sort === opt.value ? " sort-btn--active" : ""}`}
                    onClick={() => { void setSort(opt.value); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                className="search-trigger-btn"
                onClick={() => { setSearchOpen(true); setTimeout(() => { searchInputRef.current?.focus(); }, 0); }}
                title="Search (Ctrl+F)"
              >
                <Search size={13} />
                Search…
              </button>
              {genres && genres.length > 0 && (
                <div className="genre-filter" ref={genreDropdownRef}>
                  <button
                    className={`genre-filter-btn${selectedGenreFilters.length > 0 ? " genre-filter-btn--active" : ""}`}
                    onClick={() => setGenreDropdownOpen((v) => !v)}
                    title="Filter by genre"
                  >
                    <Tag size={12} />
                    {selectedGenreFilters.length > 0 ? `Genre (${selectedGenreFilters.length})` : "Genre"}
                  </button>
                  {genreDropdownOpen && (
                    <div className="genre-dropdown">
                      {selectedGenreFilters.length > 0 && (
                        <button
                          className="genre-dropdown-clear"
                          onClick={() => setSelectedGenreFilters([])}
                        >
                          Clear
                        </button>
                      )}
                      {genres.map((g) => (
                        <button
                          key={g.name}
                          className={`genre-dropdown-item${selectedGenreFilters.includes(g.name) ? " genre-dropdown-item--active" : ""}`}
                          onClick={() => toggleGenreFilter(g.name)}
                        >
                          <span className="genre-dropdown-name">{g.name}</span>
                          <span className="genre-dropdown-count">{g.album_count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                className={`loved-filter-btn${lovedOnly ? " loved-filter-btn--active" : ""}`}
                onClick={() => setLovedOnly((v) => !v)}
                title={lovedOnly ? "Show all albums" : "Show loved albums"}
              >
                <Heart size={12} fill={lovedOnly ? "currentColor" : "none"} strokeWidth={2} />
                Loved
              </button>
              {server && (
                <button
                  className="rescan-btn"
                  onClick={() => runSync(server)}
                  disabled={syncStatus === "syncing"}
                >
                  Rescan
                </button>
              )}
            </header>
            {renderLibraryContent()}
          </main>
        );

      case "artists":
        return (
          <main className={`library${queueClass}`}>
            {selectedAlbum && serverWithCred ? (
              renderAlbumDetail()
            ) : selectedArtist && serverWithCred ? (
              <ArtistDetail
                artist={selectedArtist}
                serverWithCredential={serverWithCred}
                onClose={() => setSelectedArtist(null)}
                onSelectAlbum={setSelectedAlbum}
              />
            ) : (
              <>
                <header className="library-header">
                  <h1>Artists</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                {serverWithCred ? (
                  <ArtistGrid
                    artists={artists ?? []}
                    serverWithCredential={serverWithCred}
                    onSelect={setSelectedArtist}
                  />
                ) : (
                  <p className="empty-state">Loading…</p>
                )}
              </>
            )}
          </main>
        );

      case "genres":
        return (
          <main className={`library${queueClass}`}>
            {selectedAlbum && serverWithCred ? (
              renderAlbumDetail()
            ) : selectedGenre && serverWithCred ? (
              <>
                <header className="library-header">
                  <button className="album-detail-back" onClick={() => setSelectedGenre(null)}>
                    ← Genres
                  </button>
                  <h1>{selectedGenre.name}</h1>
                </header>
                <AlbumGrid
                  albums={genreAlbums ?? []}
                  serverWithCredential={serverWithCred}
                  onSelect={setSelectedAlbum}
                />
              </>
            ) : (
              <>
                <header className="library-header">
                  <h1>Genres</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                <GenreList
                  genres={genres ?? []}
                  onSelect={setSelectedGenre}
                />
              </>
            )}
          </main>
        );

      case "years":
        return (
          <main className={`library${queueClass}`}>
            {selectedAlbum && serverWithCred ? (
              renderAlbumDetail()
            ) : (
              <>
                <header className="library-header">
                  <h1>Years</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                {serverWithCred ? (
                  <YearView
                    albums={albums ?? []}
                    serverWithCredential={serverWithCred}
                    onSelect={setSelectedAlbum}
                  />
                ) : (
                  <p className="empty-state">Loading…</p>
                )}
              </>
            )}
          </main>
        );

      case "playlists":
        return (
          <main className={`library${queueClass}`}>
            {selectedPlaylist && serverWithCred ? (
              <PlaylistDetail
                playlist={selectedPlaylist}
                serverWithCredential={serverWithCred}
                onClose={() => setSelectedPlaylist(null)}
                onDelete={async () => {
                  await deletePlaylist(selectedPlaylist, serverWithCred);
                  setSelectedPlaylist(null);
                }}
              />
            ) : (
              <>
                <header className="library-header">
                  <h1>Playlists</h1>
                  <span className="server-name">{server?.display_name}</span>
                </header>
                {serverWithCred ? (
                  <PlaylistList
                    playlists={playlists ?? []}
                    serverWithCredential={serverWithCred}
                    onSelect={setSelectedPlaylist}
                    onCreatePlaylist={createPlaylist}
                  />
                ) : (
                  <p className="empty-state">Loading…</p>
                )}
              </>
            )}
          </main>
        );

      case "tags":
        return (
          <main className="content-main">
            <TagsView onNavigateSettings={() => setView("settings")} />
          </main>
        );

      case "issues":
        return (
          <TagIssuesView
            onNavigateAlbum={(albumId) => {
              void (async () => {
                const db = await getDb();
                type AlbumLookupRow = { id: string; server_id: string; name: string; artist: string | null; year: number | null; artwork_url: string | null };
                const rows = await db.select<AlbumLookupRow[]>(
                  "SELECT id, server_id, name, artist, year, artwork_url FROM albums WHERE id = ?",
                  [albumId]
                );
                if (rows[0]) {
                  setSelectedAlbum(rows[0] as AlbumRow);
                  setView("library");
                }
              })();
            }}
          />
        );

      case "radio":
        return <RadioView />;

      case "pending":
        return <PendingChangesView serverWithCredential={serverWithCred} />;

      case "settings":
        return (
          <main className="content-main">
            <SettingsView />
          </main>
        );
    }
  }

  return (
    <>
      <div className="app-layout">
        <nav className="sidebar">
          {NAV_ITEMS.map(({ id, label, icon, badge }) => (
            <button
              key={id}
              className={`sidebar-btn${view === id ? " sidebar-btn--active" : ""}`}
              title={label}
              onClick={() => navigateTo(id)}
            >
              {icon}
              {badge != null && badge > 0 && (
                <span className="sidebar-badge">{badge > 99 ? "99+" : badge}</span>
              )}
            </button>
          ))}
        </nav>
        {renderContent()}
      </div>
      <QueuePanel />
      <PlayerBar />
      {serverWithCred && (
        <NowPlayingOverlay
          serverWithCredential={serverWithCred}
          onSelectAlbum={(album) => {
            setSelectedAlbum(album);
            setView("library");
          }}
          onSelectArtist={(artistName) => {
            setSelectedArtist({ name: artistName, album_count: 0, artwork_url: null });
            setView("artists");
          }}
        />
      )}
    </>
  );
}
