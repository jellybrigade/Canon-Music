import type { ReactNode } from "react";
import { Search, LayoutList } from "lucide-react";
import { AlbumGrid } from "../components/AlbumGrid";
import { FilterSidebar } from "../components/FilterSidebar";
import { CanonLockup } from "../ui/CanonIcon";
import { SyncErrorBanner } from "../features/sync/SyncErrorBanner";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import type { AlbumSort } from "../types/library";
import type { AppViewProps } from "../app/AppRoutes";

const SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
  { value: "recently_added", label: "Recent" },
  { value: "artist", label: "Artist" },
  { value: "alphabetical", label: "A-Z" },
  { value: "year", label: "Year" },
];

type LibraryViewProps = Pick<
  AppViewProps,
  "server" | "serverWithCred" | "albums" | "albumsLoading" | "albumsError" | "visibleAlbums" |
  "genres" | "playlists" | "canonicalIdFilters" | "lovedOnly" | "yearFromInput" | "yearToInput" |
  "setCanonicalIdFilters" | "toggleCanonicalIdFilter" | "toggleLovedOnly" | "setYearFromInput" |
  "setYearToInput" | "filterSidebarOpen" | "setFilterSidebarOpen" | "sort" | "setSort" |
  "albumsPaginated" | "setAlbumsPaginated" | "syncStatus" | "syncError" | "syncProgress" |
  "nextRetryAt" | "runSync" | "navigateTo" | "openAlbum" | "handleStartRadioFromAlbum" |
  "handleAddAlbumToQueue" | "addAlbumToPlaylist" | "queueClass"
> & {
  credentialNotice: ReactNode;
};

export function LibraryView({
  server,
  serverWithCred,
  albums,
  albumsLoading,
  albumsError,
  visibleAlbums,
  genres,
  playlists,
  canonicalIdFilters,
  lovedOnly,
  yearFromInput,
  yearToInput,
  setCanonicalIdFilters,
  toggleCanonicalIdFilter,
  toggleLovedOnly,
  setYearFromInput,
  setYearToInput,
  filterSidebarOpen,
  setFilterSidebarOpen,
  sort,
  setSort,
  albumsPaginated,
  setAlbumsPaginated,
  syncStatus,
  syncError,
  syncProgress,
  nextRetryAt,
  runSync,
  navigateTo,
  openAlbum,
  handleStartRadioFromAlbum,
  handleAddAlbumToQueue,
  addAlbumToPlaylist,
  queueClass,
  credentialNotice,
}: LibraryViewProps) {
  function renderLibraryContent() {
    // `albums === undefined` used to render a bare "Loading…" line, which a failed read
    // also reached (useAlbums left `data` undefined on error) and never left. The grid now
    // owns all three states, so a failure surfaces with a retry instead of a permanent wait.
    if (!serverWithCred) return credentialNotice;
    const filtersActive = lovedOnly || canonicalIdFilters.length > 0 || yearFromInput !== "" || yearToInput !== "";
    const emptyMessage = lovedOnly
      ? {
          title: "No loved albums",
          hint: "Albums you heart show up here. Hover any album's cover and click the heart to add one.",
        }
      : filtersActive
        ? {
            title: "No albums match this filter",
            hint: "Widen or clear the genre, year and loved filters in the sidebar to see more.",
          }
        : {
            title: "No albums yet",
            hint: "Sync your library from Settings and every album on your server fills this grid.",
          };
    return (
      <AlbumGrid
        albums={visibleAlbums}
        serverWithCredential={serverWithCred}
        onSelect={openAlbum}
        onStartRadio={(album, mode) => { void handleStartRadioFromAlbum(album, mode); }}
        onAddAlbumToQueue={(album) => { void handleAddAlbumToQueue(album); }}
        onAddAlbumToPlaylist={serverWithCred ? (album, pl) => { void addAlbumToPlaylist(pl, album.id, serverWithCred); } : undefined}
        playlists={playlists}
        emptyMessage={emptyMessage}
        sort={sort}
        isLoading={albumsLoading || albums === undefined}
        error={albumsError}
        onRetry={() => useAlbumBrowseSessionStore.getState().bumpRefresh()}
      />
    );
  }

  return (
    <main className={`library${queueClass}`}>
      <header className="library-header library-header--browse">
        <div className="library-header-zone library-header-zone--start">
          <CanonLockup height={22} className="library-header-logo" />
          <span className="server-name">{server?.display_name}</span>
          {syncStatus === "syncing" && (
            <span className="sync-status">
              {syncProgress && syncProgress.total > 0
                ? `Syncing ${syncProgress.done} of ${syncProgress.total} albums…`
                : "Syncing…"}
            </span>
          )}
          {serverWithCred && (syncStatus === "error" || syncStatus === "partial") && (
            <SyncErrorBanner
              variant={syncStatus}
              serverName={serverWithCred.server.display_name}
              detail={syncError}
              nextRetryAt={nextRetryAt}
              onRetry={() => runSync(serverWithCred)}
            />
          )}
        </div>
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
        <div className="library-header-zone library-header-zone--end">
          <button
            className="search-trigger-btn"
            onClick={() => navigateTo("search")}
            title="Search (Ctrl+F)"
          >
            <Search size={15} />
            Search…
          </button>
          {serverWithCred && (
            <button
              className="rescan-btn"
              onClick={() => runSync(serverWithCred)}
              disabled={syncStatus === "syncing"}
            >
              Rescan
            </button>
          )}
          <button
            className={`header-toggle-btn${albumsPaginated ? " header-toggle-btn--active" : ""}`}
            onClick={() => void setAlbumsPaginated(!albumsPaginated)}
            title={albumsPaginated ? "Switch to scroll view" : "Switch to page view"}
          >
            <LayoutList size={14} />
            Pages
          </button>
        </div>
      </header>
      <div className="library-body">
        <FilterSidebar
          genres={genres ?? []}
          canonicalIdFilters={canonicalIdFilters}
          toggleCanonicalIdFilter={toggleCanonicalIdFilter}
          clearGenreFilters={() => setCanonicalIdFilters([])}
          yearFromInput={yearFromInput}
          yearToInput={yearToInput}
          setYearFromInput={setYearFromInput}
          setYearToInput={setYearToInput}
          lovedOnly={lovedOnly}
          toggleLovedOnly={toggleLovedOnly}
          isOpen={filterSidebarOpen}
          onToggle={() => void setFilterSidebarOpen(!filterSidebarOpen)}
        />
        <div className="library-content">
          {renderLibraryContent()}
        </div>
      </div>
    </main>
  );
}
