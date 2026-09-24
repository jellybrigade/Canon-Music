import { useCallback, useEffect, useMemo, useState } from "react";
import { extractAccent } from "../lib/artColor";
import { Play, Shuffle, Radio, Disc, ExternalLink, GitMerge, MoreHorizontal, ChevronDown, Mic2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlbumGrid } from "../components/AlbumGrid";
import { ArtistIdentifyDialog } from "../features/enrichment/components/IdentifyDialog";
import { ArtistMergeModal } from "../features/enrichment/components/ArtistMergeModal";
import { ContextMenu } from "../ui/ContextMenu";
import { StartRadioSubmenu } from "../features/radio/components/StartRadioSubmenu";
import type { ArtistRow, AlbumRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import { useStartRadio } from "../features/radio/hooks/useStartRadio";
import { usePlayerStore } from "../features/playback/store/player";
import { makeStreamUrlBuilder } from "../lib/track";
import { normalizeTrackTitle, resolvePortraitUrl } from "../clients/lastfm";
import { useArtistImageMap, resolveArtistImageUrl } from "../hooks/useArtistImageCache";
import { shuffleArray } from "../lib/shuffle";
import { mostPlayedHere } from "../lib/artistRanking";
import { useEnrichArtist } from "../features/enrichment/hooks/useEnrichArtist";
import { useArtistAlbums } from "../hooks/useArtistAlbums";
import { useSimilarInLibrary } from "../features/enrichment/hooks/useSimilarInLibrary";
import { useLoved } from "../hooks/useLoved";
import { useArtistCanonicalOf, useAliasesOfCanonical, useRemoveArtistAlias } from "../features/enrichment/hooks/useArtistAliases";
import { useBoolSetting } from "../hooks/useSetting";
import { fetchBandsintownEvents, type BandsintownEvent } from "../clients/bandsintown";
import { TourCard } from "../components/TourCard";
import { type TopTrack, useArtistTopTracks, useArtistGenres, useAppearsOnAlbums, useLastfmTopAlbums, useLastfmTopTracks, buildTrackObj, useMatchedTracks, lastfmOnlyTracks, POPULAR_TRACKS_MAX } from "./artist/artistQueries";
import { type ReleaseGroup, groupAlbums } from "./artist/releaseGroups";
import { formatCount, TrackRow } from "./artist/TrackRow";
import { SimilarArtistCard } from "./artist/SimilarArtistCard";
import "./ArtistDetail.css";

interface Props {
  artist: ArtistRow;
  serverWithCredential: ServerWithCredential;
  onClose: () => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist?: (artistName: string) => void;
}

const POPULAR_TRACKS_MIN = 5;
const ESSENTIAL_MIN_ALBUMS = 3;
const ESSENTIAL_RATIO = 0.25;
const SIMILAR_ARTISTS_MAX = 12;

function timeAgo(unixSecs: number): string {
  const diffDays = Math.floor((Date.now() / 1000 - unixSecs) / 86400);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}
export function ArtistDetail({ artist, serverWithCredential, onClose, onSelectAlbum, onSelectArtist }: Props) {
  const { server, credential } = serverWithCredential;
  const { data: albums } = useArtistAlbums(artist.name, server.id);
  const { data: appearsOnAlbums } = useAppearsOnAlbums(artist.name, server.id);
  const { data: canonGenres = [] } = useArtistGenres(artist.name, server.id);
  const { data: rawTracks } = useArtistTopTracks(artist.name, server.id);
  const { data: enrichment, isRefreshing, error: enrichError, refresh } = useEnrichArtist(artist.name, { serverWithCredential });
  const [showIdentify, setShowIdentify] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [popularExpanded, setPopularExpanded] = useState(false);
  const [lastfmOnlyExpanded, setLastfmOnlyExpanded] = useState(false);
  const [overflowMenuAnchor, setOverflowMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeReleaseGroup, setActiveReleaseGroup] = useState<ReleaseGroup | null>(null);
  const [similarTab, setSimilarTab] = useState<"in" | "out">("in");

  const [bandsintownEnabled, setBandsintownEnabled] = useBoolSetting("enrichment.bandsintown_enabled", false);
  const [tourEvents, setTourEvents] = useState<BandsintownEvent[]>([]);
  const [tourLoading, setTourLoading] = useState(false);
  useEffect(() => {
    if (!bandsintownEnabled) {
      setTourEvents([]);
      setTourLoading(false);
      return;
    }
    let cancelled = false;
    setTourLoading(true);
    fetchBandsintownEvents(artist.name).then((events) => {
      if (!cancelled) {
        setTourEvents(events);
        setTourLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setTourLoading(false);
    });
    return () => { cancelled = true; };
  }, [bandsintownEnabled, artist.name]);

  const { data: canonicalOf, isPending: canonicalOfPending } = useArtistCanonicalOf(artist.name);
  const { data: aliases = [] } = useAliasesOfCanonical(artist.name);
  const removeAlias = useRemoveArtistAlias();

  const lastfmName = enrichment?.lastfm_artist_name ?? artist.name;
  const { data: lastfmTitles } = useLastfmTopTracks(lastfmName);
  const { data: lastfmAlbums, isLoading: lastfmAlbumsLoading } = useLastfmTopAlbums(lastfmName);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const startRadio = useStartRadio();
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const { lovedTrackIds } = useLoved();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: TopTrack } | null>(null);

  const { data: matchedTracks } = useMatchedTracks(lastfmName, rawTracks, lastfmTitles);
  const topTracks = useMemo(() => {
    const source = matchedTracks ?? rawTracks ?? [];
    const rank = (t: TopTrack) => t.lastfmPlaycount ?? -1;
    return [...source].sort((a, b) => {
      const byPlaycount = rank(b) - rank(a);
      if (byPlaycount !== 0) return byPlaycount;
      return (a.lastfmRank ?? Infinity) - (b.lastfmRank ?? Infinity);
    });
  }, [matchedTracks, rawTracks]);
  const lovedTracks = useMemo(
    () => topTracks.filter((t) => lovedTrackIds.has(t.id)),
    [topTracks, lovedTrackIds]
  );
  // Popular is Last.fm's ranking, which is what the world plays. This is what this
  // server has played, from every client, and the two answer different questions - so
  // it is a second list rather than a fallback or a rename.
  const mostPlayedTracks = useMemo(
    () => mostPlayedHere(rawTracks ?? [], POPULAR_TRACKS_MIN),
    [rawTracks]
  );
  const lfmOnlyTracks = useMemo(
    () => (rawTracks && lastfmTitles ? lastfmOnlyTracks(rawTracks, lastfmTitles) : []),
    [rawTracks, lastfmTitles]
  );

  const popularTracks = topTracks.slice(0, popularExpanded ? POPULAR_TRACKS_MAX : POPULAR_TRACKS_MIN);

  const albumGroups = useMemo(() => (albums ? groupAlbums(albums) : []), [albums]);
  const ownedAlbumsOnly = albumGroups.find((g) => g.group === "album")?.items ?? [];

  const essentialAlbums = useMemo(() => {
    if (ownedAlbumsOnly.length <= ESSENTIAL_MIN_ALBUMS) return [];
    if (lastfmAlbumsLoading) return [];
    const cap = Math.ceil(ownedAlbumsOnly.length * ESSENTIAL_RATIO);
    if (lastfmAlbums && lastfmAlbums.length > 0) {
      const localByNorm = new Map(ownedAlbumsOnly.map((a) => [normalizeTrackTitle(a.name), a]));
      const matched: AlbumRow[] = [];
      for (const lfmAlbum of lastfmAlbums) {
        const local = localByNorm.get(normalizeTrackTitle(lfmAlbum.name));
        if (local && !matched.includes(local)) matched.push(local);
        if (matched.length >= cap) break;
      }
      if (matched.length < cap) {
        for (const album of ownedAlbumsOnly) {
          if (matched.length >= cap) break;
          if (!matched.includes(album)) matched.push(album);
        }
      }
      if (matched.length > 0) return matched;
    }
    return ownedAlbumsOnly.slice(0, cap);
  }, [ownedAlbumsOnly, lastfmAlbums, lastfmAlbumsLoading]);

  const artistImageMap = useArtistImageMap();
  const rawPortraitUrl = resolvePortraitUrl(enrichment);
  const portraitUrl = resolveArtistImageUrl(artistImageMap, artist.name, rawPortraitUrl);

  const [accentColor, setAccentColor] = useState<string | null>(null);
  useEffect(() => {
    setAccentColor(null);
    if (!portraitUrl) return;
    let cancelled = false;
    void extractAccent(portraitUrl).then((color) => {
      if (!cancelled) setAccentColor(color);
    });
    return () => { cancelled = true; };
  }, [portraitUrl]);

  // Parsed defensively: a malformed or legacy `similar_json` value would otherwise
  // throw inside render and blank the whole artist page via the error boundary.
  const similar: string[] = useMemo(() => {
    if (!enrichment?.similar_json) return [];
    try {
      const parsed: unknown = JSON.parse(enrichment.similar_json);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((n): n is string => typeof n === "string").slice(0, SIMILAR_ARTISTS_MAX);
    } catch {
      return [];
    }
  }, [enrichment?.similar_json]);
  const { data: inLibrarySet } = useSimilarInLibrary(similar);
  const similarInLibrary = useMemo(
    () => similar.filter((name) => inLibrarySet?.has(name)),
    [similar, inLibrarySet]
  );
  const similarNotInLibrary = useMemo(
    () => similar.filter((name) => !inLibrarySet?.has(name)),
    [similar, inLibrarySet]
  );
  const effectiveSimilarTab = similarInLibrary.length === 0 ? "out" : similarTab;
  const bio = enrichment?.bio ?? null;

  const metaItems: string[] = [
    enrichment?.listeners != null ? `${formatCount(enrichment.listeners)} listeners` : null,
    enrichment?.playcount != null ? `${formatCount(enrichment.playcount)} scrobbles` : null,
    `${artist.album_count} ${artist.album_count === 1 ? "album" : "albums"} in library`,
  ].filter((x): x is string => x !== null);

  const toTrackObj = useCallback(
    (track: TopTrack) => buildTrackObj(track, server, credential),
    [server, credential]
  );

  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);

  const handleAlbumClick = useCallback(
    (albumId: string) => {
      const album = albums?.find((a) => a.id === albumId) ?? appearsOnAlbums?.find((a) => a.id === albumId);
      if (album) onSelectAlbum(album);
    },
    [albums, appearsOnAlbums, onSelectAlbum]
  );

  const handlePlayTrack = useCallback(
    (track: TopTrack) => {
      if (!topTracks.length) return;
      const startIndex = topTracks.findIndex((t) => t.id === track.id);
      playQueue(topTracks.map(toTrackObj), streamUrlFor, startIndex >= 0 ? startIndex : 0);
    },
    [topTracks, playQueue, streamUrlFor]
  );

  function handlePlayAll() {
    if (!topTracks.length) return;
    playQueue(topTracks.map(toTrackObj), streamUrlFor, 0);
  }

  function handleShuffleAll() {
    if (!topTracks.length) return;
    const shuffled = shuffleArray(topTracks);
    playQueue(shuffled.map(toTrackObj), streamUrlFor, 0);
  }

  function handleStartRadio() {
    const seed = topTracks[0];
    if (!seed) return;
    const track = toTrackObj(seed);
    void startRadio({ tracks: [track], streamUrlFor });
  }

  const handleTrackContextMenu = useCallback((e: React.MouseEvent, track: TopTrack) => {
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const defaultGroup = albumGroups[0]?.group ?? null;
  const currentGroup = activeReleaseGroup && albumGroups.some((g) => g.group === activeReleaseGroup)
    ? activeReleaseGroup
    : defaultGroup;
  const currentGroupItems = albumGroups.find((g) => g.group === currentGroup)?.items ?? [];

  const heroArt = portraitUrl ? (
    <img className="artist-hero-art" src={portraitUrl} alt={artist.name} loading="lazy" decoding="async" />
  ) : (
    <div className="artist-hero-art artist-hero-art--fallback">
      <Mic2 size={38} strokeWidth={1.5} />
    </div>
  );

  return (
    <div className="artist-detail">
      <div className="artist-hero">
        <button className="artist-back-btn" onClick={onClose}>← Artists</button>

        <div
          className="artist-hero-main"
          style={accentColor ? ({ "--artist-accent": accentColor } as React.CSSProperties) : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setOverflowMenuAnchor({ x: e.clientX, y: e.clientY });
          }}
        >
          {heroArt}
          <div className="artist-hero-info">
            <h1 className="artist-hero-name">{artist.name}</h1>
            <div className="artist-hero-meta-row">
              {metaItems.map((item, i) => (
                <span key={i}>{i > 0 ? `· ${item}` : item}</span>
              ))}
              {canonicalOf && (
                <span className="artist-alias-badge">alias of {canonicalOf}</span>
              )}
              {aliases.length > 0 && (
                <span className="artist-alias-badge">
                  {aliases.length} {aliases.length === 1 ? "alias" : "aliases"}
                </span>
              )}
            </div>
            {canonGenres.length > 0 && (
              <p className="artist-hero-genres">{canonGenres.join(" / ")}</p>
            )}

            {aliases.length > 0 && (
              <div className="artist-aliases-row">
                {aliases.map((a) => (
                  <span key={a} className="artist-alias-chip">
                    {a}
                    <button
                      className="artist-alias-remove"
                      onClick={() => void removeAlias.mutateAsync(a)}
                      title={`Remove alias: ${a}`}
                      aria-label={`Remove alias ${a}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="artist-hero-actions">
              {topTracks.length > 0 && (
                <button className="artist-play-btn" onClick={handlePlayAll}>
                  <Play size={13} fill="currentColor" />
                  Play
                </button>
              )}
              {topTracks.length > 1 && (
                <button className="artist-icon-btn" onClick={handleShuffleAll} title="Shuffle" aria-label="Shuffle">
                  <Shuffle size={13} />
                </button>
              )}
              {topTracks.length > 0 && (
                <button className="artist-icon-btn" onClick={handleStartRadio} title="Start Radio" aria-label="Start Radio">
                  <Radio size={13} />
                </button>
              )}
              <button
                className="artist-icon-btn"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setOverflowMenuAnchor({ x: rect.left, y: rect.bottom });
                }}
                title="More"
                aria-label="More"
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="artist-body">
        {topTracks.length > 0 && (
          <section className="artist-section">
            <div className="artist-popfav-grid">
              <div className="artist-popfav-col">
                <h2 className="artist-section-title">Popular</h2>
                <div className="artist-top-tracks">
                  {popularTracks.map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      rank={i}
                      currentTrack={currentTrack}
                      isPlaying={isPlaying}
                      server={server}
                      credential={credential}
                      onPlay={handlePlayTrack}
                      lastfmPlaycount={track.lastfmPlaycount}
                      lastfmCombined={track.lastfmCombined}
                      onAlbumClick={handleAlbumClick}
                      onContextMenu={handleTrackContextMenu}
                    />
                  ))}
                </div>
                {topTracks.length > POPULAR_TRACKS_MIN && (
                  <button className="artist-show-more-btn" onClick={() => setPopularExpanded((v) => !v)}>
                    {popularExpanded ? "Show less" : `Show ${Math.min(POPULAR_TRACKS_MAX, topTracks.length) - POPULAR_TRACKS_MIN} more`}
                    <ChevronDown size={13} className={popularExpanded ? "artist-chevron--up" : ""} />
                  </button>
                )}
              </div>

              {mostPlayedTracks.length > 0 && (
                <div className="artist-popfav-col">
                  <h2 className="artist-section-title">Most played here</h2>
                  <div className="artist-top-tracks">
                    {mostPlayedTracks.map((track, i) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        rank={i}
                        currentTrack={currentTrack}
                        isPlaying={isPlaying}
                        server={server}
                        credential={credential}
                        onPlay={handlePlayTrack}
                        onAlbumClick={handleAlbumClick}
                        onContextMenu={handleTrackContextMenu}
                      />
                    ))}
                  </div>
                </div>
              )}

              {lovedTracks.length > 0 && (
                <div className="artist-popfav-col">
                  <h2 className="artist-section-title">Favorites</h2>
                  <div className="artist-top-tracks">
                    {lovedTracks.map((track) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        rank={-1}
                        currentTrack={currentTrack}
                        isPlaying={isPlaying}
                        server={server}
                        credential={credential}
                        onPlay={handlePlayTrack}
                        lastfmPlaycount={track.lastfmPlaycount}
                      lastfmCombined={track.lastfmCombined}
                        onAlbumClick={handleAlbumClick}
                        onContextMenu={handleTrackContextMenu}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {lfmOnlyTracks.length > 0 && (
              <div className="artist-lastfm-only">
                <button className="artist-lastfm-divider" onClick={() => setLastfmOnlyExpanded((v) => !v)}>
                  More on Last.fm (not in your library)
                  <ChevronDown size={12} className={lastfmOnlyExpanded ? "artist-chevron--up" : ""} />
                </button>
                {lastfmOnlyExpanded && (
                  <div className="artist-lastfm-only-list">
                    {lfmOnlyTracks.map((t) => (
                      <div key={t.name} className="artist-lastfm-only-row">
                        <span className="artist-lastfm-only-title">{t.name}</span>
                        {t.playcount > 0 && (
                          <span className="artist-lastfm-only-plays">{formatCount(t.playcount)} plays</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {essentialAlbums.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Essential</h2>
            <AlbumGrid
              albums={essentialAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {albumGroups.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Discography</h2>
            <div className="artist-tabs">
              {albumGroups.map(({ group, label, items }) => (
                <button
                  key={group}
                  className={`artist-tab-btn${group === currentGroup ? " artist-tab-btn--active" : ""}`}
                  onClick={() => setActiveReleaseGroup(group)}
                >
                  {label} ({items.length})
                </button>
              ))}
            </div>
            <AlbumGrid
              albums={currentGroupItems}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {appearsOnAlbums && appearsOnAlbums.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Appears On</h2>
            <AlbumGrid
              albums={appearsOnAlbums}
              serverWithCredential={serverWithCredential}
              onSelect={onSelectAlbum}
            />
          </section>
        )}

        {similar.length > 0 && (
          <section className="artist-section">
            <h2 className="artist-section-title">Fans also like</h2>
            <div className="artist-tabs">
              <button
                className={`artist-tab-btn${effectiveSimilarTab === "in" ? " artist-tab-btn--active" : ""}`}
                onClick={() => setSimilarTab("in")}
                disabled={similarInLibrary.length === 0}
              >
                In library ({similarInLibrary.length})
              </button>
              <button
                className={`artist-tab-btn${effectiveSimilarTab === "out" ? " artist-tab-btn--active" : ""}`}
                onClick={() => setSimilarTab("out")}
                disabled={similarNotInLibrary.length === 0}
              >
                Not in library ({similarNotInLibrary.length})
              </button>
            </div>
            <div className="artist-similar-strip">
              {(effectiveSimilarTab === "in" ? similarInLibrary : similarNotInLibrary).map((name) => (
                <SimilarArtistCard
                  key={name}
                  name={name}
                  owned={effectiveSimilarTab === "in"}
                  onSelect={() => onSelectArtist?.(name)}
                  server={server}
                  credential={credential}
                />
              ))}
            </div>
          </section>
        )}

        {bio && (
          <section className="artist-section">
            <h2 className="artist-section-title">About</h2>
            <div className="artist-about-split">
              <div className="artist-about-card">
                <div className={`artist-bio-wrap${bioExpanded ? " artist-bio-wrap--expanded" : ""}`}>
                  <p className="artist-bio">{bio}</p>
                </div>
                {bio.length > 260 && (
                  <button className="artist-bio-toggle" onClick={() => setBioExpanded((v) => !v)}>
                    {bioExpanded ? "Show less" : "Show more"}
                  </button>
                )}
                <div className="artist-about-links">
                  {enrichment?.mb_artist_id && (
                    <button onClick={() => void openUrl(`https://musicbrainz.org/artist/${enrichment.mb_artist_id}`)}>
                      MusicBrainz ↗
                    </button>
                  )}
                  <button onClick={() => void openUrl(`https://www.last.fm/music/${encodeURIComponent(lastfmName)}`)}>
                    Last.fm ↗
                  </button>
                </div>
              </div>
              <TourCard
                artistName={artist.name}
                enabled={bandsintownEnabled}
                loading={tourLoading}
                events={tourEvents}
                onEnable={() => void setBandsintownEnabled(true)}
              />
            </div>
          </section>
        )}

        <div className="artist-enrichment-footer">
          {enrichment?.enriched_at ? (
            <span>Last.fm updated {timeAgo(enrichment.enriched_at)}</span>
          ) : (
            <span>Last.fm not loaded</span>
          )}
          <button
            className="artist-enrichment-refresh"
            onClick={() => { void refresh(); }}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          {enrichError && <span className="artist-enrichment-error">{enrichError}</span>}
        </div>
      </div>

      {overflowMenuAnchor && (
        <ContextMenu
          x={overflowMenuAnchor.x}
          y={overflowMenuAnchor.y}
          onClose={() => setOverflowMenuAnchor(null)}
        >
          <button
            onClick={() => { setShowIdentify(true); setOverflowMenuAnchor(null); }}
          >
            <Disc size={13} /> {portraitUrl ? "Identify artist" : "Identify to add artwork"}
          </button>
          {!canonicalOfPending && !canonicalOf && (
            <button
              onClick={() => { setShowMerge(true); setOverflowMenuAnchor(null); }}
            >
              <GitMerge size={13} /> Merge into another artist
            </button>
          )}
          {enrichment?.confirmed_at && enrichment.mb_artist_id && (
            <button
              onClick={() => {
                void openUrl(`https://musicbrainz.org/artist/${enrichment.mb_artist_id}`);
                setOverflowMenuAnchor(null);
              }}
            >
              <ExternalLink size={13} /> Open on MusicBrainz
            </button>
          )}
        </ContextMenu>
      )}

      {showIdentify && (
        <ArtistIdentifyDialog
          artistName={artist.name}
          onClose={() => setShowIdentify(false)}
        />
      )}

      {showMerge && (
        <ArtistMergeModal
          aliasArtistName={artist.name}
          onClose={() => setShowMerge(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <button
            onClick={() => {
              handlePlayTrack(contextMenu.track);
              setContextMenu(null);
            }}
          >
            Play Now
          </button>
          <button
            onClick={() => {
              playNext(toTrackObj(contextMenu.track), streamUrlFor);
              setContextMenu(null);
            }}
          >
            Play Next
          </button>
          <button
            onClick={() => {
              addToQueue(toTrackObj(contextMenu.track), streamUrlFor);
              setContextMenu(null);
            }}
          >
            Add to Queue
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => {
              const track = toTrackObj(contextMenu.track);
              void startRadio({ tracks: [track], streamUrlFor, mode });
              setContextMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </div>
  );
}
