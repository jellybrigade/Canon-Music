import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Play, RefreshCw } from "lucide-react";
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
import { extractAccent } from "../lib/artColor";
import "../styles/home.css";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
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
  serverId: string,
  seed: number,
  perCategory = 2,
): ForYouGroup[] {
  const groups: ForYouGroup[] = [];
  const used = new Set<string>(spotlightId ? [spotlightId] : []);

  const groupFrom = (kicker: string, source: AlbumRow[]) => {
    if (source.length === 0) return;
    const start = source.length > perCategory ? seed % (source.length - perCategory + 1) : 0;
    const albums: AlbumRow[] = [];
    for (let i = 0; i < source.length && albums.length < perCategory; i++) {
      const a = source[(start + i) % source.length]!;
      if (used.has(a.id)) continue;
      used.add(a.id);
      albums.push(a);
    }
    if (albums.length > 0) groups.push({ kicker, albums });
  };

  groupFrom("Rediscover", rediscover as AlbumRow[]);
  groupFrom("On repeat", onRepeat as AlbumRow[]);
  groupFrom("Long time no hear", vault as AlbumRow[]);

  if (allAlbums) {
    const unheard = allAlbums.filter(
      a => a.artwork_url && !recentNavIds.has(stripPrefix(a.id, serverId))
    );
    groupFrom("New to library", unheard);
  }

  return groups;
}

// ── Spotlight ─────────────────────────────────────────────────────────────────

interface SpotlightProps {
  pick: SpotlightPick;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
}

function Spotlight({ pick, serverWithCred, onSelectAlbum, playAlbum }: SpotlightProps) {
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
      <div className="home-spotlight__art-wrap">
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
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onRefresh: () => void;
}

function ForYouRail({ groups, serverWithCred, onSelectAlbum, playAlbum, onRefresh }: ForYouRailProps) {
  const { server, credential } = serverWithCred;
  if (groups.length === 0) return null;

  return (
    <section className="home-rail">
      <div className="home-rail__header">
        <p className="home-section-label" style={{ margin: 0 }}>For You</p>
        <button className="home-rail__refresh" onClick={onRefresh} aria-label="Refresh suggestions">
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="home-rail__track">
        {groups.map((group, gi) => (
          <div key={group.kicker} className={`home-rail__group${gi > 0 ? " home-rail__group--separated" : ""}`}>
            <p className="home-rail__kicker">{group.kicker}</p>
            <div className="home-rail__tiles">
              {group.albums.map(album => {
                const artUrl = album.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 300)
                  : null;
                return (
                  <div
                    key={album.id}
                    className="home-rail__tile"
                    onClick={() => onSelectAlbum(album)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && onSelectAlbum(album)}
                  >
                    <div className="home-rail__art-wrap">
                      {artUrl
                        ? <img className="home-rail__art" src={artUrl} alt={album.name} loading="lazy" />
                        : <div className="home-rail__art" />}
                      <button
                        className="home-rail__play"
                        onClick={e => { e.stopPropagation(); playAlbum(album); }}
                        aria-label={`Play ${album.name}`}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    </div>
                    <p className="home-rail__name">{album.name}</p>
                    {album.artist && <p className="home-rail__artist">{album.artist}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
}

const CARD_WIDTH = 160 + 14;

function AlbumCarousel({ title, subtitle, items, isLoading, serverWithCred, onSelectAlbum, playAlbum }: AlbumCarouselProps) {
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
                  >
                    <div className="carousel-card__art-wrap">
                      {artUrl
                        ? <img className="carousel-card__art" src={artUrl} alt={item.name} loading="lazy" />
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

export function HomeView({ serverWithCredential, onSelectAlbum }: Props) {
  const { server } = serverWithCredential;
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const playAlbum = usePlayAlbum(serverWithCredential);
  const [forYouSeed, setForYouSeed] = useState(0);
  const refreshForYou = useCallback(() => setForYouSeed(s => s + 1), []);

  const { data: recentRaw, isLoading: recentLoading } = useCarouselAlbums(serverWithCredential, "recent");
  const { data: frequentRaw } = useCarouselAlbums(serverWithCredential, "frequent");
  const { data: allAlbums, isLoading: allLoading } = useAlbums("recently_added");
  const { onRepeat, rediscover, vault } = useListeningStats();
  const { lovedAlbumIds } = useLoved();

  const recentNavIds = useMemo(
    () => new Set(recentRaw?.slice(0, 20).map(a => a.id) ?? []),
    [recentRaw]
  );

  const spotlight = useMemo(
    () => buildSpotlight(
      currentTrack?.artist ?? null,
      currentTrack?.albumId ?? null,
      onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id,
    ),
    [currentTrack, onRepeat, rediscover, recentRaw, frequentRaw, allAlbums, server.id]
  );

  const forYouGroups = useMemo(
    () => buildForYouGroups(
      spotlight?.album.id ?? null,
      onRepeat, rediscover, vault, allAlbums, recentNavIds, server.id, forYouSeed,
    ),
    [spotlight, onRepeat, rediscover, vault, allAlbums, recentNavIds, server.id, forYouSeed]
  );

  const recentItems = useMemo(
    () => recentRaw?.map(a => naviToAlbumRow(a, server.id)),
    [recentRaw, server.id]
  );
  const onRepeatItems = useMemo(() => onRepeat.slice(0, 20) as AlbumRow[], [onRepeat]);
  const lovedItems = useMemo(
    () => allAlbums?.filter(a => lovedAlbumIds.has(a.id)),
    [allAlbums, lovedAlbumIds]
  );
  const newestItems = useMemo(() => allAlbums?.slice(0, 20), [allAlbums]);
  const vaultItems = useMemo(() => vault.slice(0, 20) as AlbumRow[], [vault]);

  const play = (album: AlbumRow) => void playAlbum(album);

  return (
    <div className="home-view">
      <header className="home-greeting">
        <h1 className="home-greeting__text">{getGreeting()}</h1>
        {allAlbums != null && (
          <span className="home-greeting__sub">{allAlbums.length.toLocaleString()} albums</span>
        )}
      </header>

      {spotlight && (
        <Spotlight
          pick={spotlight}
          serverWithCred={serverWithCredential}
          onSelectAlbum={onSelectAlbum}
          playAlbum={play}
        />
      )}

      <ForYouRail
        key={forYouSeed}
        groups={forYouGroups}
        serverWithCred={serverWithCredential}
        onSelectAlbum={onSelectAlbum}
        playAlbum={play}
        onRefresh={refreshForYou}
      />

      <AlbumCarousel title="Recently Played" subtitle="Where you left off" items={recentItems} isLoading={recentLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} />
      <AlbumCarousel title="On Repeat" subtitle="Your most-played" items={onRepeatItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} />
      <AlbumCarousel title="Loved" subtitle="Starred albums" items={lovedItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} />
      <AlbumCarousel title="Newly Added" subtitle="Fresh arrivals" items={newestItems} isLoading={allLoading} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} />
      <AlbumCarousel title="From the Vault" subtitle="Long-forgotten listens" items={vaultItems} serverWithCred={serverWithCredential} onSelectAlbum={onSelectAlbum} playAlbum={play} />
    </div>
  );
}
