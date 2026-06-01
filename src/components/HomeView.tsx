import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Play, RefreshCw, Search, X } from "lucide-react";
import { getCoverArtUrl } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import { useAlbums } from "../hooks/useAlbums";
import { useCarouselAlbums } from "../hooks/useCarouselAlbums";
import { useListeningStats } from "../hooks/useListeningStats";
import type { AlbumStatRow } from "../hooks/useListeningStats";
import { useLoved } from "../hooks/useLoved";
import { usePlayAlbum } from "../hooks/usePlayAlbum";
import { usePlayerStore } from "../store/player";
import type { RadioMode } from "../store/player";
import { extractAccent } from "../lib/artColor";
import { useSearch } from "../hooks/useSearch";
import { SearchResults } from "./SearchResults";
import { ContextMenu } from "./ContextMenu";
import { StartRadioSubmenu } from "./StartRadioSubmenu";
import "../styles/home.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  onPlayTrack: (trackId: string) => void;
  onOpenCommandPalette: () => void;
}

interface SpotlightPick {
  kicker: string;
  album: AlbumRow;
}

interface ForYouGroup {
  kicker: string;
  albums: AlbumRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function naviToAlbumRow(album: NavidromeAlbum, serverId: string): AlbumRow {
  return {
    id: `${serverId}:${album.id}`,
    server_id: serverId,
    name: album.name,
    artist: album.artist,
    year: album.year ?? null,
    artwork_url: album.coverArt ?? null,
  };
}

function stripPrefix(id: string, serverId: string): string {
  const prefix = `${serverId}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function buildSpotlight(
  currentArtist: string | null,
  currentAlbumId: string | null,
  onRepeat: AlbumStatRow[],
  rediscover: AlbumStatRow[],
  recentRaw: NavidromeAlbum[] | undefined,
  frequentRaw: NavidromeAlbum[] | undefined,
  allAlbums: AlbumRow[] | undefined,
  serverId: string,
): SpotlightPick | null {
  if (currentArtist) {
    const fromStats =
      onRepeat.find(a => a.artist === currentArtist && a.id !== currentAlbumId) ??
      rediscover.find(a => a.artist === currentArtist && a.id !== currentAlbumId);
    if (fromStats) return { kicker: `More from ${currentArtist}`, album: fromStats };

    const fromFrequent = frequentRaw?.find(a => {
      const id = `${serverId}:${a.id}`;
      return a.artist === currentArtist && id !== currentAlbumId;
    });
    if (fromFrequent) return { kicker: `More from ${currentArtist}`, album: naviToAlbumRow(fromFrequent, serverId) };

    const fromAlbums = allAlbums?.find(
      a => a.artist === currentArtist && a.id !== currentAlbumId && a.artwork_url
    );
    if (fromAlbums) return { kicker: `More from ${currentArtist}`, album: fromAlbums };
  }

  if (recentRaw?.[0]) return { kicker: "Jump back in", album: naviToAlbumRow(recentRaw[0], serverId) };
  if (rediscover[0]) return { kicker: "Rediscover", album: rediscover[0] };
  if (onRepeat[0]) return { kicker: "On repeat", album: onRepeat[0] };

  return null;
}

function buildForYouGroups(
  spotlightId: string | null,
  onRepeat: AlbumStatRow[],
  rediscover: AlbumStatRow[],
  vault: AlbumStatRow[],
  allAlbums: AlbumRow[] | undefined,
  recentNavIds: Set<string>,
  recentItems: AlbumRow[] | undefined,
  lovedSource: AlbumRow[] | undefined,
  serverId: string,
  seed: number,
  perCategory = 4,
): ForYouGroup[] {
  const groups: ForYouGroup[] = [];
  const used = new Set<string>(spotlightId ? [spotlightId] : []);

  const groupFrom = (kicker: string, source: AlbumRow[]) => {
    const withArt = source.filter(a => a.artwork_url);
    if (withArt.length === 0) return;
    const start = withArt.length > perCategory ? seed % (withArt.length - perCategory + 1) : 0;
    const albums: AlbumRow[] = [];
    for (let i = 0; i < withArt.length && albums.length < perCategory; i++) {
      const a = withArt[(start + i) % withArt.length]!;
      if (used.has(a.id)) continue;
      used.add(a.id);
      albums.push(a);
    }
    if (albums.length > 0) groups.push({ kicker, albums });
  };

  if (recentItems) {
    groupFrom("Jump back in", recentItems);
  }
  groupFrom("On repeat", onRepeat as AlbumRow[]);
  groupFrom("Rediscover", rediscover as AlbumRow[]);
  groupFrom("Long time no hear", vault as AlbumRow[]);

  if (allAlbums) {
    const unheard = allAlbums.filter(
      a => a.artwork_url && !recentNavIds.has(stripPrefix(a.id, serverId))
    );
    groupFrom("New to library", unheard);
  }

  if (lovedSource) {
    groupFrom("Loved", lovedSource);
  }

  return groups;
}

// ── Spotlight ─────────────────────────────────────────────────────────────────

interface SpotlightProps {
  pick: SpotlightPick;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
}

function Spotlight({ pick, serverWithCred, onSelectAlbum, playAlbum, onCardContextMenu }: SpotlightProps) {
  const { server, credential } = serverWithCred;
  const [accentColor, setAccentColor] = useState<string | null>(null);

  const artUrl = pick.album.artwork_url
    ? getCoverArtUrl(server.url, server.username, credential, pick.album.artwork_url, 400)
    : null;

  useEffect(() => {
    if (!artUrl) { setAccentColor(null); return; }
    let cancelled = false;
    void extractAccent(artUrl).then(color => {
      if (!cancelled) setAccentColor(color);
    });
    return () => { cancelled = true; };
  }, [artUrl]);

  const meta = [pick.album.artist, pick.album.year].filter(Boolean).join(" · ");

  return (
    <section
      className="home-spotlight"
      style={{ "--spotlight-accent": accentColor ?? "transparent" } as React.CSSProperties}
    >
      <div className="home-spotlight__wash" />
      <div className="home-spotlight__rule" />
      <div
        className="home-spotlight__art-wrap"
        onContextMenu={(e) => onCardContextMenu(e, pick.album)}
      >
        {artUrl
          ? <img className="home-spotlight__art" src={artUrl} alt={pick.album.name} />
          : <div className="home-spotlight__art home-spotlight__art--placeholder" />}
      </div>
      <div className="home-spotlight__body">
        <div className="home-spotlight__top">
          <span className="home-spotlight__kicker">{pick.kicker}</span>
          <h2 className="home-spotlight__title">{pick.album.name}</h2>
          {meta && <p className="home-spotlight__meta">{meta}</p>}
        </div>
        <div className="home-spotlight__actions">
          <button className="home-spotlight__play" onClick={() => playAlbum(pick.album)}>
            <Play size={13} fill="currentColor" />
            Play
          </button>
          <button className="home-spotlight__open" onClick={() => onSelectAlbum(pick.album)}>
            Open
          </button>
        </div>
      </div>
    </section>
  );
}

// ── For You Rail ──────────────────────────────────────────────────────────────

interface ForYouRailProps {
  groups: ForYouGroup[];
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onRefresh: () => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
}

const KICKER_COLORS: Record<string, string> = {
  "Jump back in":     "#3b82f6",
  "On repeat":        "#6366f1",
  "Rediscover":       "#f59e0b",
  "Long time no hear":"#8b5cf6",
  "New to library":   "#10b981",
  "Loved":            "#ec4899",
  "More from":        "#f43f5e",
  _default:           "#6b7280",
};

function ForYouRail({ groups, isLoading, serverWithCred, onSelectAlbum, playAlbum, onRefresh, onCardContextMenu }: ForYouRailProps) {
  const { server, credential } = serverWithCred;
  if (groups.length === 0 && !isLoading) return null;
  if (groups.length === 0 && isLoading) {
    return (
      <section className="home-rail">
        <div className="home-rail__header">
          <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        </div>
        <div className="home-suggestion-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="suggestion-card suggestion-card--skeleton">
              <div className="suggestion-card__header">
                <span className="suggestion-card__kicker-skel" />
              </div>
              <div className="suggestion-card__row suggestion-card__row--top">
                <div className="suggestion-card__tile"><div className="suggestion-card__art-wrap" /></div>
              </div>
              <div className="suggestion-card__row suggestion-card__row--bottom">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="suggestion-card__tile"><div className="suggestion-card__art-wrap" /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="home-rail">
      <div className="home-rail__header">
        <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        <button className="home-rail__refresh" onClick={onRefresh} aria-label="Refresh suggestions">
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="home-suggestion-grid">
        {groups.map(group => {
          const kickerColor = KICKER_COLORS[group.kicker]
            ?? (group.kicker.startsWith("More from") ? KICKER_COLORS["More from"] : undefined)
            ?? KICKER_COLORS._default;
          return (
            <div
              key={group.kicker}
              className="suggestion-card"
              style={{ "--kicker-color": kickerColor } as React.CSSProperties}
            >
              <div className="suggestion-card__header">
                <span className="suggestion-card__kicker">{group.kicker}</span>
              </div>
              {/* Top row — 1 large tile */}
              <div className="suggestion-card__row suggestion-card__row--top">
                {group.albums.slice(0, 1).map(album => {
                  const artUrl = getCoverArtUrl(server.url, server.username, credential, album.artwork_url!, 300);
                  return (
                    <div
                      key={album.id}
                      className="suggestion-card__tile"
                      onClick={() => onSelectAlbum(album)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
                      onContextMenu={e => onCardContextMenu(e, album)}
                    >
                      <div className="suggestion-card__art-wrap">
                        <img className="suggestion-card__art" src={artUrl} alt={album.name} decoding="async" />
                        <div className="album-overlay">
                          <span className="album-name">{album.name}</span>
                          {album.artist && <span className="album-artist">{album.artist}</span>}
                        </div>
                        <button
                          className="suggestion-card__play"
                          onClick={e => { e.stopPropagation(); playAlbum(album); }}
                          aria-label={`Play ${album.name}`}
                        >
                          <Play size={13} fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Bottom row — 3 smaller tiles */}
              {group.albums.length > 1 && (
                <div className="suggestion-card__row suggestion-card__row--bottom">
                  {group.albums.slice(1, 4).map(album => {
                    const artUrl = getCoverArtUrl(server.url, server.username, credential, album.artwork_url!, 300);
                    return (
                      <div
                        key={album.id}
                        className="suggestion-card__tile"
                        onClick={() => onSelectAlbum(album)}
                        role="button"
                        tabIndex={0}
                        title={album.artist ? `${album.name} · ${album.artist}` : album.name}
                        onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
                        onContextMenu={e => onCardContextMenu(e, album)}
                      >
                        <div className="suggestion-card__art-wrap">
                          <img className="suggestion-card__art" src={artUrl} alt={album.name} decoding="async" />
                          <button
                            className="suggestion-card__play suggestion-card__play--sm"
                            onClick={e => { e.stopPropagation(); playAlbum(album); }}
                            aria-label={`Play ${album.name}`}
                          >
                            <Play size={10} fill="currentColor" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Album Carousel ────────────────────────────────────────────────────────────

interface AlbumCarouselProps {
  title: string;
  subtitle?: string;
  items: AlbumRow[] | undefined;
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
}

const CARD_WIDTH = 168 + 14;

function AlbumCarousel({ title, subtitle, items, isLoading, serverWithCred, onSelectAlbum, playAlbum, onCardContextMenu }: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { server, credential } = serverWithCred;

  if (!isLoading && (!items || items.length === 0)) return null;

  const scroll = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "next" ? CARD_WIDTH * 3 : -CARD_WIDTH * 3, behavior: "smooth" });
  };

  const skeletons = Array.from({ length: 6 });

  return (
    <section className="home-section">
      <div className="home-section__header">
        <h2 className="home-section__title">{title}</h2>
        {subtitle && <p className="home-section__subtitle">{subtitle}</p>}
      </div>
      <div className="album-carousel">
        <button className="album-carousel__arrow album-carousel__arrow--prev" onClick={() => scroll("prev")} aria-label="Scroll left">
          <ChevronLeft size={15} />
        </button>
        <div className="album-carousel__track" ref={trackRef}>
          {isLoading
            ? skeletons.map((_, i) => (
                <div key={i} className="carousel-card carousel-card--skeleton">
                  <div className="carousel-card__art-wrap" />
                  <p className="carousel-card__name">&nbsp;</p>
                  <p className="carousel-card__artist">&nbsp;</p>
                </div>
              ))
            : (items ?? []).map(item => {
                const artUrl = item.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, item.artwork_url, 300)
                  : null;
                return (
                  <div
                    key={item.id}
                    className="carousel-card"
                    onClick={() => onSelectAlbum(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && onSelectAlbum(item)}
                    onContextMenu={e => onCardContextMenu(e, item)}
                  >
                    <div className="carousel-card__art-wrap">
                      {artUrl
                        ? <img className="carousel-card__art" src={artUrl} alt={item.name} decoding="async" />
                        : <div className="carousel-card__art" />}
                      <button
                        className="carousel-card__play"
                        onClick={e => { e.stopPropagation(); void playAlbum(item); }}
                        aria-label={`Play ${item.name}`}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    </div>
                    <p className="carousel-card__name">{item.name}</p>
                    {item.artist && <p className="carousel-card__artist">{item.artist}</p>}
                  </div>
                );
              })}
        </div>
        <button className="album-carousel__arrow album-carousel__arrow--next" onClick={() => scroll("next")} aria-label="Scroll right">
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export function HomeView({ serverWithCredential, onSelectAlbum, onStartRadio, onPlayTrack, onOpenCommandPalette }: Props) {
  const { server } = serverWithCredential;
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const playAlbum = usePlayAlbum(serverWithCredential);
  const [forYouSeed, setForYouSeed] = useState(0);
  const refreshForYou = useCallback(() => setForYouSeed(s => s + 1), []);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: AlbumRow } | null>(null);
  const openCardContextMenu = useCallback((e: React.MouseEvent, album: AlbumRow) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, album });
  }, []);

  const [searchRaw, setSearchRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchRaw), 200);
    return () => clearTimeout(t);
  }, [searchRaw]);
  const { data: searchResults } = useSearch(searchQuery);

  const { data: recentRaw, isLoading: recentLoading } = useCarouselAlbums(serverWithCredential, "recent");
  const { data: frequentRaw } = useCarouselAlbums(serverWithCredential, "frequent");
  const { data: allAlbums, isLoading: allLoading } = useAlbums("recently_added");
  const { onRepeat, rediscover, vault, isLoading: statsLoading } = useListeningStats();
  const { lovedAlbumIds, lovedTrackAlbumIds } = useLoved();

  const recentNavIds = useMemo(
    () => new Set(recentRaw?.slice(0, 20).map(a => a.id) ?? []),
    [recentRaw]
  );

  const recentItems = useMemo(
    () => recentRaw?.map(a => naviToAlbumRow(a, server.id)),
    [recentRaw, server.id]
  );

  const spotlight = useMemo(
    () => buildSpotlight(
      currentTrack?.artist ?? null,
      currentTrack?.albumId ?? null,
      onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id,
    ),
    [currentTrack, onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id]
  );

  const lovedItems = useMemo(
    () => allAlbums?.filter(a => lovedAlbumIds.has(a.id)),
    [allAlbums, lovedAlbumIds]
  );
  const lovedSource = useMemo(() => {
    if (!allAlbums) return undefined;
    const seen = new Set<string>();
    return allAlbums.filter(a => {
      if (!lovedAlbumIds.has(a.id) && !lovedTrackAlbumIds.has(a.id)) return false;
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [allAlbums, lovedAlbumIds, lovedTrackAlbumIds]);

  const forYouGroups = useMemo(
    () => buildForYouGroups(
      spotlight?.album.id ?? null,
      onRepeat, rediscover, vault, allAlbums, recentNavIds, recentItems, lovedSource, server.id, forYouSeed, 4,
    ),
    [spotlight, onRepeat, rediscover, vault, allAlbums, recentNavIds, recentItems, lovedSource, server.id, forYouSeed]
  );
  const onRepeatItems = useMemo(() => onRepeat.slice(0, 20) as AlbumRow[], [onRepeat]);
  const newestItems = useMemo(() => allAlbums?.slice(0, 20), [allAlbums]);
  const vaultItems = useMemo(() => vault.slice(0, 20) as AlbumRow[], [vault]);

  const play = (album: AlbumRow) => void playAlbum(album);

  const isSearching = searchRaw.length > 0;

  return (
    <div className="home-view">
      <header className="home-greeting">
        <h1 className="home-greeting__text">{getGreeting()}</h1>
        <div className="home-search-bar">
          <Search size={13} className="search-bar-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-bar-input"
            placeholder="Search…"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
          />
          {searchRaw ? (
            <button className="search-bar-clear" onClick={() => { setSearchRaw(""); setSearchQuery(""); }} title="Clear">
              <X size={13} />
            </button>
          ) : (
            <button className="home-search-palette-hint" onClick={onOpenCommandPalette} title="Command palette — search tracks, artists, albums, and navigate anywhere">
              <kbd>⌘K</kbd>
            </button>
          )}
        </div>
        {allAlbums != null && !isSearching && (
          <span className="home-greeting__sub">{allAlbums.length.toLocaleString()} albums</span>
        )}
      </header>

      {isSearching ? (
        searchResults && searchQuery ? (
          <SearchResults
            albums={searchResults.albums}
            tracks={searchResults.tracks}
            artists={searchResults.artists}
            serverWithCredential={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            onPlayTrack={onPlayTrack}
          />
        ) : (
          <p className="empty-state">Searching…</p>
        )
      ) : (
        <>
          {spotlight && (
            <Spotlight
              pick={spotlight}
              serverWithCred={serverWithCredential}
              onSelectAlbum={onSelectAlbum}
              playAlbum={play}
              onCardContextMenu={openCardContextMenu}
            />
          )}

          <ForYouRail
            key={forYouSeed}
            groups={forYouGroups}
            isLoading={statsLoading || recentLoading || allLoading}
            serverWithCred={serverWithCredential}
            onSelectAlbum={onSelectAlbum}
            playAlbum={play}
            onRefresh={refreshForYou}
            onCardContextMenu={openCardContextMenu}
          />

          <AlbumCarousel title="Recently Played" subtitle="Where you left off" items={recentItems} isLoading={recentLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} />
          <AlbumCarousel title="On Repeat" subtitle="Your most-played" items={onRepeatItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} />
          <AlbumCarousel title="Loved" subtitle="Starred albums" items={lovedItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} />
          <AlbumCarousel title="Newly Added" subtitle="Fresh arrivals" items={newestItems} isLoading={allLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} />
          <AlbumCarousel title="From the Vault" subtitle="Long-forgotten listens" items={vaultItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} onCardContextMenu={openCardContextMenu} />
        </>
      )}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button onClick={() => { onSelectAlbum(contextMenu.album); setContextMenu(null); }}>
            Open album
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => { onStartRadio(contextMenu.album, mode); setContextMenu(null); }}
          />
        </ContextMenu>
      )}
    </div>
  );
}
