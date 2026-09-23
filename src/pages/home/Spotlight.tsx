import { ArrowUpRight, ListEnd, Play } from "lucide-react";
import { useAlbumDisplayName } from "../../hooks/useAlbumDisplayName";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import type { NavidromeAlbum } from "../../clients/navidrome";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { useAlbumCoverMap } from "../../hooks/useCoverCache";
import type { AlbumStatRow } from "../../hooks/useListeningStats";
import { useAlbumAccent } from "../../hooks/useAlbumAccent";
import "./Spotlight.css";

export interface SpotlightPick {
  kicker: string;
  album: AlbumRow;
}

export function naviToAlbumRow(album: NavidromeAlbum, serverId: string): AlbumRow {
  return {
    id: `${serverId}:${album.id}`,
    server_id: serverId,
    name: album.name,
    artist: album.artist,
    year: album.year ?? null,
    artwork_url: album.coverArt ?? null,
  };
}


const FEAT_RE = /\s*\(?(?:feat\.?|ft\.?|featuring)\s+.*/i;

export function stripFeaturedArtists(artist: string): string {
  return artist.replace(FEAT_RE, "").trim();
}

// Returns candidate picks in priority order (not deduped), caller dedupes by album id.
export function buildSpotlightCandidates(
  currentArtist: string | null,
  currentAlbumId: string | null,
  onRepeat: AlbumStatRow[],
  rediscover: AlbumStatRow[],
  recentRaw: NavidromeAlbum[] | undefined,
  frequentRaw: NavidromeAlbum[] | undefined,
  allAlbums: AlbumRow[] | undefined,
  serverId: string,
  unplayedWithArt: AlbumRow[],
): SpotlightPick[] {
  const picks: SpotlightPick[] = [];

  if (currentArtist) {
    const displayArtist = stripFeaturedArtists(currentArtist);
    const fromStats =
      onRepeat.find(a => a.artist === currentArtist && a.id !== currentAlbumId) ??
      rediscover.find(a => a.artist === currentArtist && a.id !== currentAlbumId);
    const fromFrequent = frequentRaw?.find(a => {
      const id = `${serverId}:${a.id}`;
      return a.artist === currentArtist && id !== currentAlbumId && !!a.coverArt;
    });
    const fromAlbums = allAlbums?.find(
      a => a.artist === currentArtist && a.id !== currentAlbumId && a.artwork_url
    );
    const fromArtist = fromStats
      ?? (fromFrequent ? naviToAlbumRow(fromFrequent, serverId) : undefined)
      ?? fromAlbums;
    if (fromArtist) picks.push({ kicker: `More from ${displayArtist}`, album: fromArtist });
  }

  const recentNotCurrent = recentRaw?.find(a => `${serverId}:${a.id}` !== currentAlbumId);
  if (recentNotCurrent) picks.push({ kicker: "Jump back in", album: naviToAlbumRow(recentNotCurrent, serverId) });
  if (rediscover[0]) picks.push({ kicker: "Rediscover", album: rediscover[0] });
  if (onRepeat[0]) picks.push({ kicker: "On repeat", album: onRepeat[0] });

  if (unplayedWithArt.length > 0) {
    const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    for (let i = 0; i < 3; i++) {
      const pick = unplayedWithArt[(dayIndex + i) % unplayedWithArt.length];
      if (pick) picks.push({ kicker: "Discover something new", album: pick });
    }
  }

  return picks;
}

export function dedupePicks(candidates: SpotlightPick[], max: number): SpotlightPick[] {
  const seen = new Set<string>();
  const picks: SpotlightPick[] = [];
  for (const c of candidates) {
    if (seen.has(c.album.id)) continue;
    seen.add(c.album.id);
    picks.push(c);
    if (picks.length >= max) break;
  }
  return picks;
}



interface SpotlightProps {
  pick: SpotlightPick;
  serverWithCred: ServerWithCredential;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (name: string) => void;
  playAlbum: (album: AlbumRow) => void;
  onAddToQueue?: (album: AlbumRow) => void;
  onCardContextMenu: (e: React.MouseEvent, album: AlbumRow) => void;
  primary?: boolean;
}

export function Spotlight({ pick, serverWithCred, onSelectAlbum, onSelectArtist, playAlbum, onAddToQueue, onCardContextMenu, primary }: SpotlightProps) {
  const { server, credential } = serverWithCred;
  const albumDisplayName = useAlbumDisplayName();
  const coverMap = useAlbumCoverMap();

  const artUrl = coverMap.get(pick.album.id)
    ?? (pick.album.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, pick.album.artwork_url, primary ? 400 : 200)
      : null);

  const accentColor = useAlbumAccent(pick.album.id, pick.album.accent_color, artUrl, server.id);

  return (
    <section
      className={primary ? "home-spotlight home-spotlight--primary" : "home-spotlight"}
      style={accentColor ? ({ "--spotlight-accent": accentColor } as React.CSSProperties) : undefined}
    >
      <button
        type="button"
        className="home-spotlight__art-wrap"
        onClick={() => playAlbum(pick.album)}
        onContextMenu={(e) => onCardContextMenu(e, pick.album)}
        title="Play"
        aria-label={`Play ${pick.album.name}`}
      >
        {artUrl
          ? <img className="home-spotlight__art" src={artUrl} alt={pick.album.name} loading="lazy" />
          : <div className="home-spotlight__art home-spotlight__art--placeholder" />}
        <span className="home-spotlight__art-play">
          <Play size={primary ? 28 : 18} fill="currentColor" />
        </span>
      </button>
      <div className="home-spotlight__text">
        <p className="home-spotlight__kicker">{pick.kicker}</p>
        <h2 className="home-spotlight__title">{albumDisplayName(pick.album.name, pick.album.id)}</h2>
        {(pick.album.artist || pick.album.year) && (
          <p className="home-spotlight__meta">
            {pick.album.artist && onSelectArtist ? (
              <button className="home-spotlight__artist-link" onClick={() => onSelectArtist(pick.album.artist!)}>
                {pick.album.artist}
              </button>
            ) : pick.album.artist}
            {pick.album.artist && pick.album.year && " · "}
            {pick.album.year}
          </p>
        )}
        {primary && (
          <div className="home-spotlight__cta">
            <button
              className="home-spotlight__play-btn"
              onClick={() => playAlbum(pick.album)}
            >
              <Play size={14} fill="currentColor" /> Play
            </button>
            {onAddToQueue && (
              <button
                className="home-spotlight__queue-btn"
                onClick={() => onAddToQueue(pick.album)}
              >
                <ListEnd size={14} /> Add to Queue
              </button>
            )}
            <button
              className="home-spotlight__open-btn"
              onClick={() => onSelectAlbum(pick.album)}
            >
              Open
            </button>
          </div>
        )}
      </div>
      {!primary && (
        <div className="home-spotlight__actions">
          <button
            className="home-spotlight__play-icon"
            onClick={() => playAlbum(pick.album)}
            title="Play"
            aria-label={`Play ${pick.album.name}`}
          >
            <Play size={16} fill="currentColor" />
          </button>
          <button
            className="home-spotlight__open"
            onClick={() => onSelectAlbum(pick.album)}
            title="Open"
            aria-label="Open"
          >
            <ArrowUpRight size={16} />
          </button>
          {onAddToQueue && (
            <button
              className="home-spotlight__open"
              onClick={() => onAddToQueue(pick.album)}
              title="Add to Queue"
              aria-label="Add to Queue"
            >
              <ListEnd size={16} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
