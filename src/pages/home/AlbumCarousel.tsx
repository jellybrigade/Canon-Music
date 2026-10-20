import { Play, Radio, RefreshCw } from "lucide-react";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import { useAlbumDisplayName } from "../../hooks/useAlbumDisplayName";
import { useAlbumCoverMap } from "../../hooks/useCoverCache";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import "./AlbumCarousel.css";
import { CarouselTrack } from "./CarouselTrack";

interface CarouselRefresh {
  onClick: () => void;
  /** Tooltip and accessible name. */
  label: string;
  isBusy?: boolean;
  note?: string | null;
  noteDetail?: string;
}

interface AlbumCarouselProps {
  title: string;
  subtitle?: string;
  items: AlbumRow[] | undefined;
  isLoading?: boolean;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  playAlbum: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  onRadio?: () => void;
  refresh?: CarouselRefresh;
  /** Each increment scrolls the carousel back to its first card. */
  scrollToStartRequest?: number;
}

export function AlbumCarousel({
  title,
  subtitle,
  items,
  isLoading,
  serverWithCred,
  onSelectAlbum,
  playAlbum,
  onCardContextMenu,
  onRadio,
  refresh,
  scrollToStartRequest = 0,
}: AlbumCarouselProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();

  if (!isLoading && (!items || items.length === 0)) return null;

  const skeletons = Array.from({ length: 6 });

  return (
    <section className="home-section">
      <div className="home-section__header">
        <h2 className="home-section__title">{title}</h2>
        {subtitle && <p className="home-section__subtitle">{subtitle}</p>}
        {onRadio && (
          <button
            className="home-section__radio-btn"
            onClick={onRadio}
            aria-label={`Start ${title} radio`}
            title="Start radio"
          >
            <Radio size={13} />
          </button>
        )}
        {refresh && (
          <button
            className="home-section__refresh-btn"
            onClick={refresh.onClick}
            disabled={refresh.isBusy}
            aria-label={refresh.label}
            title={refresh.label}
          >
            <RefreshCw size={13} className={refresh.isBusy ? "player-spin" : undefined} />
          </button>
        )}
        {refresh?.note && (
          <span className="home-section__note" role="status" title={refresh.noteDetail}>
            {refresh.note}
          </span>
        )}
      </div>
      <CarouselTrack scrollToStartRequest={scrollToStartRequest}>
        {isLoading
          ? skeletons.map((_, i) => (
              <div key={i} className="carousel-card carousel-card--skeleton">
                <div className="carousel-card__art-wrap" />
                <p className="carousel-card__name">&nbsp;</p>
                <p className="carousel-card__artist">&nbsp;</p>
              </div>
            ))
          : (items ?? []).map((item) => {
              const artUrl =
                coverMap.get(item.id) ??
                (item.artwork_url
                  ? getCoverArtUrl(server.url, server.username, credential, item.artwork_url, 300)
                  : null);
              return (
                <div
                  key={item.id}
                  className="carousel-card"
                  onClick={() => onSelectAlbum(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAlbum(item)}
                  onContextMenu={(e) => onCardContextMenu(e, item)}
                >
                  <div className="carousel-card__art-wrap">
                    {artUrl ? (
                      <img
                        className="carousel-card__art"
                        src={artUrl}
                        alt={item.name}
                        decoding="async"
                        loading="lazy"
                      />
                    ) : (
                      <div className="carousel-card__art" />
                    )}
                    <button
                      className="carousel-card__play"
                      onClick={(e) => {
                        e.stopPropagation();
                        void playAlbum(item);
                      }}
                      aria-label={`Play ${item.name}`}
                    >
                      <Play size={13} fill="currentColor" />
                    </button>
                  </div>
                  <p className="carousel-card__name">{albumDisplayName(item.name, item.id)}</p>
                  {item.artist && <p className="carousel-card__artist">{item.artist}</p>}
                </div>
              );
            })}
      </CarouselTrack>
    </section>
  );
}
