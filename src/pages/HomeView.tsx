import { useMemo, useRef, useState, useCallback } from "react";
import { Search, X } from "lucide-react";
import { CanonIcon } from "../ui/CanonIcon";
import { useSetting } from "../hooks/useSetting";
import { getCoverArtUrl, getStreamUrl } from "../clients/navidromeUrls";
import { sampleFromHead } from "../lib/shuffle";
import type { ForYouCategoryConfig } from "../lib/forYouGroups";
import { useForYouGroups } from "../hooks/useForYouGroups";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow, ArtistRow } from "../types/library";
import { useAlbums } from "../hooks/useAlbums";
import { useCarouselAlbums } from "../hooks/useCarouselAlbums";
import { useListeningStats } from "../hooks/useListeningStats";
import { useLoved } from "../hooks/useLoved";
import { usePlayAlbum, useAddAlbumToQueue } from "../hooks/usePlayAlbum";
import { useRecommendedAlbum } from "../hooks/useRecommendedAlbum";
import { useRecentlyReleasedAlbums } from "../hooks/useRecentlyReleasedAlbums";
import { useRecentGenres } from "../hooks/useGenres";
import { usePlayerStore } from "../features/playback/store/player";
import { useStartRadio } from "../features/radio/hooks/useStartRadio";
import type { RadioMode, CurrentTrack } from "../features/playback/store/playerTypes";
import { useSearch } from "../features/search/useSearch";
import { getDb } from "../db";
import { stripServerPrefix } from "../lib/ids";
import { SearchResults } from "../features/search/SearchResults";
import { ContextMenu, ContextMenuSubmenu } from "../ui/ContextMenu";
import { StartRadioSubmenu } from "../features/radio/components/StartRadioSubmenu";
import { usePlaylists } from "../features/playlists/usePlaylists";
import { AlbumIdentifyDialog } from "../features/enrichment/components/IdentifyDialog";
import { type SpotlightPick, naviToAlbumRow, stripFeaturedArtists, buildSpotlightCandidates, dedupePicks, Spotlight } from "./home/Spotlight";
import { DEFAULT_FOR_YOU_CONFIG, DEFAULT_FOR_YOU_CONFIG_JSON, mergeForYouConfig, ForYouRail } from "./home/ForYouRail";
import { GenreChipsLine } from "./home/GenreChipsLine";
import { AlbumCarousel } from "./home/AlbumCarousel";
import "./HomeView.css";
import "./GenreView.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (name: string) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  onStartRadioFromArtist: (artist: ArtistRow, mode: RadioMode) => void;
  onPlayTrack: (trackId: string) => void;
  onOpenCommandPalette: () => void;
  homeSearchRaw: string;
  homeSearchQuery: string;
  onHomeSearchRawChange: (v: string) => void;
}

/** Oldest-played albums a vault refresh draws from, so a refresh stays long-forgotten. */
const VAULT_POOL_SIZE = 100;

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function HomeView({ serverWithCredential, onSelectAlbum, onSelectArtist, onStartRadio, onStartRadioFromArtist, onPlayTrack, onOpenCommandPalette, homeSearchRaw, homeSearchQuery, onHomeSearchRawChange }: Props) {
  const { server, credential } = serverWithCredential;
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const startRadio = useStartRadio();
  const playAlbum = usePlayAlbum(serverWithCredential);
  const [forYouSeed, setForYouSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const refreshForYou = useCallback(() => setForYouSeed(s => s + 1), []);
  const [vaultSeed, setVaultSeed] = useState(0);
  const refreshVault = useCallback(() => setVaultSeed(s => s + 1), []);

  const [rawCategoryConfig, setRawCategoryConfig] = useSetting("for_you_categories", DEFAULT_FOR_YOU_CONFIG_JSON);
  const categoryConfig = useMemo<ForYouCategoryConfig[]>(() => {
    try {
      const parsed = JSON.parse(rawCategoryConfig) as ForYouCategoryConfig[];
      if (!Array.isArray(parsed)) return DEFAULT_FOR_YOU_CONFIG;
      return mergeForYouConfig(parsed);
    } catch {
      return DEFAULT_FOR_YOU_CONFIG;
    }
  }, [rawCategoryConfig]);
  const handleForYouConfigChange = useCallback((config: ForYouCategoryConfig[]) => {
    void setRawCategoryConfig(JSON.stringify(config));
  }, [setRawCategoryConfig]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const [identifyAlbum, setIdentifyAlbum] = useState<AlbumRow | null>(null);
  const openCardContextMenu = useCallback((e: React.MouseEvent, album: AlbumRow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, album });
  }, []);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: searchResults, isError: searchError } = useSearch(homeSearchQuery, server.id);

  const { data: recentRaw, isLoading: recentLoading } = useCarouselAlbums(serverWithCredential, "recent");
  const { data: frequentRaw } = useCarouselAlbums(serverWithCredential, "frequent");
  const { data: allAlbums, isLoading: allLoading } = useAlbums("recently_added");
  const { data: recentlyReleasedRaw, isLoading: recentlyReleasedLoading } = useRecentlyReleasedAlbums();
  const { genres: recentGenres } = useRecentGenres();
  const { onRepeat, rediscover, vault, hiddenGem, finishTheAlbum, almostDone, playedAlbumIds, isLoading: statsLoading } = useListeningStats();
  const { lovedAlbumIds, lovedTrackAlbumIds } = useLoved();

  const recentItems = useMemo(
    () => recentRaw?.map(a => naviToAlbumRow(a, server.id)),
    [recentRaw, server.id]
  );

  const unplayedWithArt = useMemo(
    () => allAlbums?.filter(a => a.artwork_url && !playedAlbumIds.has(a.id)) ?? [],
    [allAlbums, playedAlbumIds]
  );

  const spotlightCandidates = useMemo(
    () => buildSpotlightCandidates(
      currentTrack?.artist ?? null,
      currentTrack?.albumId ?? null,
      onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id,
      unplayedWithArt,
    ),
    [currentTrack, onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id, unplayedWithArt]
  );

  const currentAlbumId = currentTrack?.albumId ?? null;
  const { data: recommendedAlbum } = useRecommendedAlbum(currentAlbumId);

  const recommendedPick = useMemo<SpotlightPick | null>(() => {
    if (!currentTrack || !recommendedAlbum) return null;
    const album: AlbumRow = {
      id: recommendedAlbum.id,
      // Read back off the row, never stamped from the selected server: the
      // recommendation query spans the whole mirror, so the album can belong
      // to a different server and its stream URL has to be built against that one.
      server_id: recommendedAlbum.server_id,
      name: recommendedAlbum.name,
      artist: recommendedAlbum.artist,
      year: recommendedAlbum.year,
      artwork_url: recommendedAlbum.artwork_url,
      accent_color: recommendedAlbum.accent_color,
    };
    const primaryArtist = currentTrack.artist
      ? stripFeaturedArtists(currentTrack.artist)
      : null;
    const kicker = primaryArtist
      ? `Because you're listening to ${primaryArtist}`
      : "You might also like";
    return { kicker, album };
  }, [currentTrack, recommendedAlbum, server.id]);

  // Picks sourced from the carousels arrive as NavidromeAlbum rows, which carry no
  // accent_color. Without this the Spotlight effect re-extracts and re-writes an
  // accent the albums table already holds, once per mount, and flashes the accent
  // off in between. Fill it from the local mirror before rendering.
  const accentByAlbumId = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of allAlbums ?? []) {
      if (a.accent_color) map.set(a.id, a.accent_color);
    }
    return map;
  }, [allAlbums]);

  const spotlightPicks = useMemo(
    () => dedupePicks(
      recommendedPick ? [recommendedPick, ...spotlightCandidates] : spotlightCandidates,
      3
    ).map(pick => pick.album.accent_color
      ? pick
      : { ...pick, album: { ...pick.album, accent_color: accentByAlbumId.get(pick.album.id) ?? null } }
    ),
    [recommendedPick, spotlightCandidates, accentByAlbumId]
  );
  const primarySpotlight = spotlightPicks[0] ?? null;
  const secondarySpotlights = spotlightPicks.slice(1);

  const handleAddToQueue = useAddAlbumToQueue(serverWithCredential);
  const { data: playlists, addAlbumToPlaylist } = usePlaylists();

  const lovedItems = useMemo(
    () => allAlbums?.filter(a => lovedAlbumIds.has(a.id)),
    [allAlbums, lovedAlbumIds]
  );
  // Loved-sort fix: explicitly-loved albums come before track-only-loved albums
  const lovedSource = useMemo(() => {
    if (!allAlbums) return undefined;
    const seen = new Set<string>();
    const albumLoved: AlbumRow[] = [];
    const trackOnly: AlbumRow[] = [];
    for (const a of allAlbums) {
      if (seen.has(a.id)) continue;
      if (lovedAlbumIds.has(a.id)) {
        seen.add(a.id);
        albumLoved.push(a);
      } else if (lovedTrackAlbumIds.has(a.id)) {
        seen.add(a.id);
        trackOnly.push(a);
      }
    }
    return [...albumLoved, ...trackOnly];
  }, [allAlbums, lovedAlbumIds, lovedTrackAlbumIds]);

  const customCategorySources = useMemo<Record<string, AlbumRow[]>>(() => {
    const result: Record<string, AlbumRow[]> = {};
    if (!allAlbums) return result;
    for (const cat of categoryConfig) {
      if (!cat.customFilter) continue;
      const f = cat.customFilter;
      if (f.type === "decade") {
        result[cat.key] = allAlbums.filter(a => a.artwork_url && a.year != null && a.year >= f.decade && a.year < f.decade + 10);
      } else if (f.type === "artist") {
        const lower = f.artist.toLowerCase();
        result[cat.key] = allAlbums.filter(a => a.artwork_url && a.artist?.toLowerCase().includes(lower));
      }
    }
    return result;
  }, [allAlbums, categoryConfig]);

  const forYouSources = useMemo<Record<string, AlbumRow[]>>(() => ({
    "jump-back-in":     recentItems ?? [],
    "on-repeat":        onRepeat as AlbumRow[],
    "rediscover":       rediscover as AlbumRow[],
    "finish-the-album": finishTheAlbum as AlbumRow[],
    "hidden-gem":       hiddenGem as AlbumRow[],
    "loved":            lovedSource ?? [],
    "unplayed":         unplayedWithArt,
    "almost-done":      almostDone as AlbumRow[],
    ...customCategorySources,
  }), [recentItems, onRepeat, rediscover, finishTheAlbum, hiddenGem, lovedSource, unplayedWithArt, almostDone, customCategorySources]);

  const spotlightIds = useMemo(() => spotlightPicks.map(p => p.album.id), [spotlightPicks]);
  const { groups: forYouGroups, perTab: forYouPerTab, setPerTab: setForYouPerTab } =
    useForYouGroups(spotlightIds, forYouSources, categoryConfig, forYouSeed);
  const onRepeatItems = useMemo(() => onRepeat.slice(0, 20) as AlbumRow[], [onRepeat]);
  const newestItems = useMemo(() => allAlbums?.slice(0, 20), [allAlbums]);
  const vaultItems = useMemo(() => sampleFromHead(vault, vaultSeed, 20, VAULT_POOL_SIZE) as AlbumRow[], [vault, vaultSeed]);

  const featuredGenres = recentGenres;

  const handlePlayGenre = useCallback(async (canonicalId: string, genreLabel?: string) => {
    const db = await getDb();
    type TrackRow = { id: string; title: string; artist: string | null; duration: number | null; album_id: string; artwork_url: string | null; album_name: string | null };
    const rows = await db.select<TrackRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, t.album_id, a.artwork_url, a.name AS album_name
       FROM tracks t
       JOIN albums a ON t.album_id = a.id
       JOIN album_genres ag ON a.id = ag.album_id
       WHERE ag.canonical_id = ? AND ag.relation = 'direct'
       ORDER BY RANDOM()
       LIMIT 1`,
      [canonicalId]
    );
    const t = rows[0];
    if (!t) return;
    const coverArtUrl = t.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, t.artwork_url, 64)
      : null;
    const track: CurrentTrack = {
      id: t.id, title: t.title, artist: t.artist, duration: t.duration,
      coverArtUrl, artworkRef: t.artwork_url ?? null, album: t.album_name ?? null, albumId: t.album_id,
    };
    const streamUrlFn = (tr: CurrentTrack) =>
      getStreamUrl(server.url, server.username, credential, stripServerPrefix(tr.id, server.id));
    await startRadio({ tracks: [track], streamUrlFor: streamUrlFn, mode: "same-genre", label: genreLabel });
  }, [server, credential, startRadio]);

  const play = (album: AlbumRow) => void playAlbum(album);

  const isSearching = homeSearchRaw.length > 0;

  return (
    <div className="home-view">
      <div className="home-sticky-region">
        <header className="home-greeting">
          <div className="home-greeting__left">
            <CanonIcon size={38} className="home-greeting__logo" />
            <h1 className="home-greeting__text">{getGreeting()}</h1>
          </div>
          <div className="home-search-bar">
            <Search size={13} className="search-bar-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="search-bar-input"
              placeholder="Search…"
              value={homeSearchRaw}
              onChange={(e) => onHomeSearchRawChange(e.target.value)}
            />
            {homeSearchRaw ? (
              <button className="search-bar-clear" onClick={(e) => { searchInputRef.current?.blur(); e.currentTarget.blur(); onHomeSearchRawChange(""); }} title="Clear">
                <X size={13} />
              </button>
            ) : (
              <button className="home-search-palette-hint" onClick={onOpenCommandPalette} title="Command palette: search tracks, artists, albums, and navigate anywhere">
                <kbd>⌘K</kbd>
              </button>
            )}
          </div>
          {allAlbums != null && !isSearching && (
            <span className="home-greeting__sub">{allAlbums.length.toLocaleString()} albums</span>
          )}
        </header>

        {!isSearching && primarySpotlight && (
          <section className="home-fusion">
            <div className="home-fusion__spotlights">
              <Spotlight
                key={primarySpotlight.album.id}
                pick={primarySpotlight}
                serverWithCred={serverWithCredential}
                onSelectAlbum={onSelectAlbum}
                onSelectArtist={onSelectArtist}
                playAlbum={play}
                onAddToQueue={handleAddToQueue}
                onCardContextMenu={openCardContextMenu}
                primary
              />
              {secondarySpotlights.length > 0 && (
                <div className="home-fusion__spotlights-secondary">
                  {secondarySpotlights.map(pick => (
                    <Spotlight
                      key={pick.album.id}
                      pick={pick}
                      serverWithCred={serverWithCredential}
                      onSelectAlbum={onSelectAlbum}
                      onSelectArtist={onSelectArtist}
                      playAlbum={play}
                      onAddToQueue={handleAddToQueue}
                      onCardContextMenu={openCardContextMenu}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {!isSearching && featuredGenres.length > 0 && (
          <section className="home-genres-section">
            <GenreChipsLine genres={featuredGenres} onPlayGenre={handlePlayGenre} />
          </section>
        )}
      </div>

      {isSearching ? (
        searchError ? (
          <p className="empty-state">Search failed. The library database could not be read.</p>
        ) : searchResults && homeSearchQuery ? (
          <SearchResults
            albums={searchResults.albums}
            tracks={searchResults.tracks}
            artists={searchResults.artists}
            serverWithCredential={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            onSelectArtist={(artist) => { onHomeSearchRawChange(""); onSelectArtist?.(artist.name); }}
            onPlayTrack={onPlayTrack}
            onStartRadioFromAlbum={(album, mode) => onStartRadio(album, mode)}
            onStartRadioFromArtist={(artist, mode) => onStartRadioFromArtist(artist, mode)}
          />
        ) : (
          <p className="empty-state">Searching…</p>
        )
      ) : (
        <>
          {/* Deliberately unkeyed: forYouSeed already feeds forYouGroups, and keying on it
              remounted the rail on every Refresh, throwing away the selected tab and the
              unlocked edit state. */}
          <ForYouRail
            groups={forYouGroups}
            isLoading={statsLoading || recentLoading || allLoading}
            serverWithCred={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            playAlbum={play}
            onRefresh={refreshForYou}
            onStartRadio={(album) => onStartRadio(album, "same-genre")}
            onCardContextMenu={openCardContextMenu}
            config={categoryConfig}
            onConfigChange={handleForYouConfigChange}
            perTab={forYouPerTab}
            onPerTabChange={setForYouPerTab}
          />

          <AlbumCarousel title="Recently Played" subtitle="Where you left off" items={recentItems} isLoading={recentLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = recentItems?.[Math.floor(Math.random() * (recentItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="On Repeat" subtitle="Your most-played" items={onRepeatItems} isLoading={statsLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = onRepeatItems?.[Math.floor(Math.random() * (onRepeatItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Loved" subtitle="Starred albums" items={lovedItems} isLoading={allLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = lovedItems?.[Math.floor(Math.random() * (lovedItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Newly Added" subtitle="Fresh arrivals" items={newestItems} isLoading={allLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = newestItems?.[Math.floor(Math.random() * (newestItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="Recently Released" subtitle="Sorted by release year" items={recentlyReleasedRaw} isLoading={recentlyReleasedLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = recentlyReleasedRaw?.[Math.floor(Math.random() * (recentlyReleasedRaw?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
          <AlbumCarousel title="From the Vault" subtitle="Long-forgotten listens" onRefresh={refreshVault} items={vaultItems} isLoading={statsLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} onRadio={() => { const a = vaultItems?.[Math.floor(Math.random() * (vaultItems?.length ?? 0))]; if (a) onStartRadio(a, "same-genre"); }} />
        </>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelectAlbum(contextMenu.album); setContextMenu(null); }}>
            Open album
          </button>
          <button onClick={() => { handleAddToQueue(contextMenu.album); setContextMenu(null); }}>
            Add to Queue
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
          />
          {playlists && playlists.length > 0 && (
            <ContextMenuSubmenu label="Add to Playlist">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => { void addAlbumToPlaylist(pl, contextMenu.album.id, serverWithCredential); setContextMenu(null); }}
                >
                  {pl.name}
                </button>
              ))}
            </ContextMenuSubmenu>
          )}
          <button onClick={() => { setIdentifyAlbum(contextMenu.album); setContextMenu(null); }}>
            Identify on MusicBrainz…
          </button>
        </ContextMenu>
      )}
      {identifyAlbum && (
        <AlbumIdentifyDialog
          albumId={identifyAlbum.id}
          artist={identifyAlbum.artist ?? ""}
          album={identifyAlbum.name}
          onClose={() => setIdentifyAlbum(null)}
        />
      )}
    </div>
  );
}
