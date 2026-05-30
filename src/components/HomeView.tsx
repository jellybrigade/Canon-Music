import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCoverArtUrl } from "../lib/navidrome";
import type { NavidromeAlbum } from "../lib/navidrome";
import type { ServerWithCredential } from "../hooks/useServer";
import type { AlbumRow } from "../hooks/useAlbums";
import { useAlbums } from "../hooks/useAlbums";
import { useCarouselAlbums } from "../hooks/useCarouselAlbums";
import { useVaultAlbum } from "../hooks/useVaultAlbum";
import { usePlayerStore } from "../store/player";
import "../styles/home.css";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CarouselItem {
  id: string;
  name: string;
  artist: string | null;
  year: number | null;
  coverArtId: string | null;
  albumRow: AlbumRow;
}

interface SuggestionCard {
  type: "recent" | "rediscover" | "vault" | "new" | "artist";
  label: string;
  sublabel: string;
  accentColor: string;
  item: CarouselItem;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function albumRowToCarouselItem(album: AlbumRow): CarouselItem {
  return {
    id: album.id,
    name: album.name,
    artist: album.artist,
    year: album.year,
    coverArtId: album.artwork_url,
    albumRow: album,
  };
}

function navidromeAlbumToCarouselItem(album: NavidromeAlbum, serverId: string): CarouselItem {
  const albumRow: AlbumRow = {
    id: `${serverId}:${album.id}`,
    server_id: serverId,
    name: album.name,
    artist: album.artist,
    year: album.year ?? null,
    artwork_url: album.coverArt ?? null,
  };
  return {
    id: albumRow.id,
    name: album.name,
    artist: album.artist,
    year: album.year ?? null,
    coverArtId: album.coverArt ?? null,
    albumRow,
  };
}

function stripServerPrefix(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? id : id.slice(colon + 1);
}

function buildSuggestions(
  recentRaw: NavidromeAlbum[] | undefined,
  frequentRaw: NavidromeAlbum[] | undefined,
  newestRaw: AlbumRow[] | undefined,
  vaultAlbum: AlbumRow | null | undefined,
  currentTrack: { artist: string | null; albumId?: string | null } | null,
  serverId: string,
): SuggestionCard[] {
  const cards: SuggestionCard[] = [];
  const recentNavIds = new Set(recentRaw?.slice(0, 10).map(a => a.id) ?? []);

  // "Jump back in" — most recently played
  const firstRecent = recentRaw?.[0];
  if (firstRecent) {
    cards.push({
      type: "recent",
      label: "Jump back in",
      sublabel: "Continue where you left off",
      accentColor: "#396cd8",
      item: navidromeAlbumToCarouselItem(firstRecent, serverId),
    });
  }

  // "Rediscover" — most played but not recently heard
  if (frequentRaw) {
    const album = frequentRaw.find(a => !recentNavIds.has(a.id));
    if (album) {
      cards.push({
        type: "rediscover",
        label: "Rediscover",
        sublabel: "One of your most played",
        accentColor: "#d97706",
        item: navidromeAlbumToCarouselItem(album, serverId),
      });
    }
  }

  // "Long time no hear" — from vault SQLite query
  if (vaultAlbum) {
    cards.push({
      type: "vault",
      label: "Long time no hear",
      sublabel: "You haven't heard this in a while",
      accentColor: "#7c3aed",
      item: albumRowToCarouselItem(vaultAlbum),
    });
  }

  // "New to your library" — recently added, not yet played
  if (newestRaw) {
    const album = newestRaw.find(
      a => a.artwork_url && !recentNavIds.has(stripServerPrefix(a.id))
    );
    if (album) {
      cards.push({
        type: "new",
        label: "New to your library",
        sublabel: "Unplayed · Added recently",
        accentColor: "#16a34a",
        item: albumRowToCarouselItem(album),
      });
    }
  }

  // "More from [Artist]" — only while something is playing
  if (currentTrack?.artist) {
    const artist = currentTrack.artist;
    const currentNavAlbumId = currentTrack.albumId
      ? stripServerPrefix(currentTrack.albumId)
      : null;

    const fromFrequent = frequentRaw?.find(
      a => a.artist === artist && a.id !== currentNavAlbumId
    );

    if (fromFrequent) {
      cards.push({
        type: "artist",
        label: `More from ${artist}`,
        sublabel: "Keep the vibe going",
        accentColor: "#e11d48",
        item: navidromeAlbumToCarouselItem(fromFrequent, serverId),
      });
    } else {
      const fromNewest = newestRaw?.find(
        a => a.artist === artist && a.id !== currentTrack.albumId && a.artwork_url
      );
      if (fromNewest) {
        cards.push({
          type: "artist",
          label: `More from ${artist}`,
          sublabel: "Keep the vibe going",
          accentColor: "#e11d48",
          item: albumRowToCarouselItem(fromNewest),
        });
      }
    }
  }

  return cards;
}

// ── Suggestion Grid ───────────────────────────────────────────────────────────

interface SuggestionGridProps {
  suggestions: SuggestionCard[];
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
}

function SuggestionGrid({ suggestions, serverWithCred, onSelectAlbum }: SuggestionGridProps) {
  const { server, credential } = serverWithCred;

  if (suggestions.length === 0) return null;

  return (
    <div className="suggestion-grid">
      {suggestions.map((card) => {
        const artUrl = card.item.coverArtId
          ? getCoverArtUrl(server.url, server.username, credential, card.item.coverArtId, 400)
          : null;
        return (
          <div
            key={card.type}
            className="suggestion-card"
            onClick={() => onSelectAlbum(card.item.albumRow)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(card.item.albumRow)}
          >
            {artUrl && (
              <img className="suggestion-card__bg" src={artUrl} alt="" aria-hidden="true" />
            )}
            <div className="suggestion-card__overlay" />
            <div
              className="suggestion-card__chip"
              style={{ "--chip-accent": card.accentColor } as React.CSSProperties}
            >
              {card.label}
            </div>
            <div className="suggestion-card__content">
              {artUrl
                ? <img className="suggestion-card__art" src={artUrl} alt={card.item.name} />
                : <div className="suggestion-card__art suggestion-card__art--placeholder" />}
              <div className="suggestion-card__meta">
                <div className="suggestion-card__title">{card.item.name}</div>
                {card.item.artist && (
                  <div className="suggestion-card__artist">{card.item.artist}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Album Carousel ────────────────────────────────────────────────────────────

interface AlbumCarouselProps {
  title: string;
  items: CarouselItem[] | undefined;
  isLoading: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
}

const CARD_WIDTH = 160 + 16;

function AlbumCarousel({ title, items, isLoading, serverWithCred, onSelectAlbum }: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { server, credential } = serverWithCred;

  const scroll = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "next" ? CARD_WIDTH * 3 : -CARD_WIDTH * 3, behavior: "smooth" });
  };

  const skeletons = Array.from({ length: 6 });

  return (
    <div className="home-section">
      <h2 className="home-section__title">{title}</h2>
      <div className="album-carousel">
        <button className="album-carousel__arrow album-carousel__arrow--prev" onClick={() => scroll("prev")} aria-label="Scroll left">
          <ChevronLeft size={16} />
        </button>
        <div className="album-carousel__track" ref={trackRef}>
          {isLoading
            ? skeletons.map((_, i) => (
                <div key={i} className="carousel-card carousel-card--skeleton">
                  <div className="carousel-card__art" />
                  <div className="carousel-card__name">&nbsp;</div>
                  <div className="carousel-card__artist">&nbsp;</div>
                </div>
              ))
            : (items ?? []).map((item) => {
                const artUrl = item.coverArtId
                  ? getCoverArtUrl(server.url, server.username, credential, item.coverArtId, 300)
                  : null;
                return (
                  <div
                    key={item.id}
                    className="carousel-card"
                    onClick={() => onSelectAlbum(item.albumRow)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(item.albumRow)}
                  >
                    {artUrl ? (
                      <img className="carousel-card__art" src={artUrl} alt={item.name} loading="lazy" />
                    ) : (
                      <div className="carousel-card__art carousel-card__art--placeholder" />
                    )}
                    <div className="carousel-card__name">{item.name}</div>
                    {item.artist && <div className="carousel-card__artist">{item.artist}</div>}
                  </div>
                );
              })}
        </div>
        <button className="album-carousel__arrow album-carousel__arrow--next" onClick={() => scroll("next")} aria-label="Scroll right">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export function HomeView({ serverWithCredential, onSelectAlbum }: Props) {
  const { server } = serverWithCredential;
  const currentTrack = usePlayerStore(s => s.currentTrack);

  const { data: recentRaw, isLoading: recentLoading } = useCarouselAlbums(serverWithCredential, "recent");
  const { data: frequentRaw, isLoading: frequentLoading } = useCarouselAlbums(serverWithCredential, "frequent");
  const { data: newestRaw, isLoading: newestLoading } = useAlbums("recently_added");
  const { data: vaultAlbum } = useVaultAlbum();

  const recentItems = recentRaw?.map(a => navidromeAlbumToCarouselItem(a, server.id));
  const frequentItems = frequentRaw?.map(a => navidromeAlbumToCarouselItem(a, server.id));
  const newestItems = newestRaw?.slice(0, 20).map(albumRowToCarouselItem);

  const suggestions = useMemo(
    () => buildSuggestions(recentRaw, frequentRaw, newestRaw, vaultAlbum, currentTrack, server.id),
    [recentRaw, frequentRaw, newestRaw, vaultAlbum, currentTrack, server.id]
  );

  return (
    <div className="home-view">
      <SuggestionGrid
        suggestions={suggestions}
        serverWithCred={serverWithCredential}
        onSelectAlbum={onSelectAlbum}
      />
      <AlbumCarousel
        title="Recently Played"
        items={recentItems}
        isLoading={recentLoading}
        serverWithCred={serverWithCredential}
        onSelectAlbum={onSelectAlbum}
      />
      <AlbumCarousel
        title="Most Played"
        items={frequentItems}
        isLoading={frequentLoading}
        serverWithCred={serverWithCredential}
        onSelectAlbum={onSelectAlbum}
      />
      <AlbumCarousel
        title="Newly Added"
        items={newestItems}
        isLoading={newestLoading}
        serverWithCred={serverWithCredential}
        onSelectAlbum={onSelectAlbum}
      />
    </div>
  );
}
