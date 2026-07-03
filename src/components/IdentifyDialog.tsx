import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, XCircle, AlertCircle, Loader, Search, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery } from "@tanstack/react-query";
import { useAlbumIdentity, useIdentifyAlbum, useSaveAlbumIdentity, useConfirmedArtistMbid } from "../hooks/useAlbumIdentity";
import { useArtistIdentity, useIdentifyArtist, useSaveArtistIdentity } from "../hooks/useArtistIdentity";
import { searchReleaseGroups, searchArtists } from "../lib/musicbrainz";
import type { MbReleaseGroupCandidate, MbArtistCandidate } from "../lib/musicbrainz";
import { rankCandidates } from "../lib/fuzzy-match";
import "./IdentifyDialog.css";

function MusicBrainzBrowseLink({ kind, id }: { kind: "release-group" | "artist"; id: string }) {
  const url = `https://musicbrainz.org/${kind}/${id}`;
  const open = () => void openUrl(url);
  return (
    <span
      className="identify-candidate-browse"
      role="button"
      tabIndex={0}
      aria-label="Open on MusicBrainz"
      onClick={(e) => { e.stopPropagation(); open(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); open(); } }}
    >
      <ExternalLink size={13} />
    </span>
  );
}

// ── Album variant ──────────────────────────────────────────────────────────────

interface AlbumIdentifyDialogProps {
  albumId: string;
  artist: string;
  album: string;
  trackCount?: number;
  /** Known local release year — disambiguates same-titled releases from different years. */
  year?: number | null;
  /** MBID already confirmed for this artist elsewhere — disambiguates same-titled releases by different artists. */
  confirmedArtistMbid?: string | null;
  onClose: () => void;
}

export function AlbumIdentifyDialog({ albumId, artist, album, trackCount, year, confirmedArtistMbid, onClose }: AlbumIdentifyDialogProps) {
  const { data: savedIdentity } = useAlbumIdentity(albumId);
  const saveIdentity = useSaveAlbumIdentity();

  const [mbRgId, setMbRgId] = useState("");
  const [mbReleaseId, setMbReleaseId] = useState("");
  const [mbArtistId, setMbArtistId] = useState("");
  const [lfmArtist, setLfmArtist] = useState("");
  const [lfmAlbum, setLfmAlbum] = useState("");
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  // Track original saved values and whether lfm fields were used as search queries.
  // If user edits lfm fields, clicks "Look up", then confirms without further edits,
  // those values were search queries — not intended overrides — so we restore originals.
  const [initialLfmArtist, setInitialLfmArtist] = useState("");
  const [initialLfmAlbum, setInitialLfmAlbum] = useState("");
  const [lfmArtistUsedForSearch, setLfmArtistUsedForSearch] = useState(false);
  const [lfmAlbumUsedForSearch, setLfmAlbumUsedForSearch] = useState(false);

  // Populate fields from saved identity when loaded
  useEffect(() => {
    if (!savedIdentity) return;
    setMbRgId(savedIdentity.mb_release_group_id ?? "");
    setMbReleaseId(savedIdentity.mb_release_id ?? "");
    setMbArtistId(savedIdentity.mb_artist_id ?? "");
    const a = savedIdentity.lastfm_artist_name ?? "";
    const b = savedIdentity.lastfm_album_name ?? "";
    setLfmArtist(a);
    setLfmAlbum(b);
    setInitialLfmArtist(a);
    setInitialLfmAlbum(b);
  }, [savedIdentity]);

  const effectiveMbRgId = selectedCandidate ?? (mbRgId.trim() || null);

  const { data: rawSearchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["mb-search-rg", artist, album],
    queryFn: () => searchReleaseGroups(artist, album),
    staleTime: 10 * 60 * 1000,
    enabled: !!(artist.trim() || album.trim()),
  });

  // Re-rank raw MB results by our fuzzy score (title + artist + year + known-artist
  // bonus) so the best match sorts first, and show that score instead of MB's own
  // relevance score — MB's score can tie same-titled releases by different
  // artists/years at 100%, which is exactly the ambiguity this needs to break.
  const rankedSearchResults = rawSearchResults
    ? rankCandidates(rawSearchResults, artist, album, year, confirmedArtistMbid)
    : undefined;
  const searchResults = rankedSearchResults?.map((r) => r.candidate);

  const { data: lookupResult, isFetching } = useIdentifyAlbum({
    albumId,
    artist: lfmArtist.trim() || artist,
    album: lfmAlbum.trim() || album,
    overrideMbRgId: effectiveMbRgId,
    overrideMbReleaseId: mbReleaseId.trim() || null,
    trackCount,
    year,
    confirmedArtistMbid,
    enabled: fetchEnabled,
  });

  function handleFetch() {
    setSelectedCandidate(null);
    setLfmArtistUsedForSearch(true);
    setLfmAlbumUsedForSearch(true);
    setFetchEnabled(true);
  }

  function handleSelectCandidate(candidate: MbReleaseGroupCandidate) {
    setSelectedCandidate(candidate.id);
    setMbRgId(candidate.id);
    if (!mbArtistId && candidate.artistMbid) setMbArtistId(candidate.artistMbid);
  }

  function handlePickSearchResult(c: MbReleaseGroupCandidate) {
    setSelectedCandidate(c.id);
    setMbRgId(c.id);
    if (c.artistMbid) setMbArtistId(c.artistMbid);
    setFetchEnabled(true);
  }

  async function handleConfirm() {
    const rgDetail = lookupResult?.mbDetail;
    const releaseDetail = lookupResult?.mbRelease;

    // If lfm fields were used as search queries (not changed after "Look up"), restore
    // the original saved values rather than persisting the search string as an override.
    const lastfmArtist = lfmArtistUsedForSearch ? (initialLfmArtist || null) : (lfmArtist.trim() || null);
    const lastfmAlbum = lfmAlbumUsedForSearch ? (initialLfmAlbum || null) : (lfmAlbum.trim() || null);

    await saveIdentity.mutateAsync({
      albumId,
      mbReleaseGroupId: effectiveMbRgId ?? rgDetail?.id ?? null,
      mbReleaseId: mbReleaseId.trim() || releaseDetail?.id || null,
      mbArtistId: mbArtistId.trim() || rgDetail?.artistMbid || null,
      lastfmArtistName: lastfmArtist,
      lastfmAlbumName: lastfmAlbum,
      lastfmMatchConfirmed: true,
      combinedGenres: lookupResult?.combinedGenres ?? [],
      combinedTags: lookupResult?.combinedTags ?? [],
      label: releaseDetail?.label ?? null,
      country: releaseDetail?.country ?? null,
      catalogNumber: releaseDetail?.catalogNumber ?? null,
      barcode: releaseDetail?.barcode ?? null,
      releaseDate: releaseDetail?.date ?? rgDetail?.firstReleaseDate ?? null,
    });
    onClose();
  }

  const rgDetail = lookupResult?.mbDetail;
  const releaseDetail = lookupResult?.mbRelease;
  const combinedGenres = lookupResult?.combinedGenres ?? [];
  const isAmbiguous = lookupResult?.mbStatus === "ambiguous";
  const candidates: MbReleaseGroupCandidate[] = lookupResult?.mbCandidates ?? [];

  return createPortal(
    <div className="identify-overlay" onClick={onClose}>
      <div className="identify-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="identify-header">
          <h2 className="identify-title">Identify Album</h2>
          <button className="identify-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="identify-body">
          {/* ── MB Search Results ── */}
          <section className="identify-section">
            <h3 className="identify-section-title">MusicBrainz</h3>
            {searchLoading && (
              <div className="identify-search-loading">
                <Loader size={13} className="identify-spinner" />
                <span>Searching…</span>
              </div>
            )}
            {rankedSearchResults && rankedSearchResults.length > 0 && (
              <div className="identify-candidates">
                {rankedSearchResults.map(({ candidate: c, score }) => (
                  <button
                    key={c.id}
                    className={`identify-candidate${selectedCandidate === c.id ? " identify-candidate--selected" : ""}`}
                    onClick={() => handlePickSearchResult(c)}
                  >
                    <div className="identify-candidate-header">
                      <span className="identify-candidate-title">{c.title}</span>
                      <span className="identify-candidate-score">{Math.round(score * 100)}%</span>
                      <MusicBrainzBrowseLink kind="release-group" id={c.id} />
                    </div>
                    <span className="identify-candidate-meta">
                      {c.artistName}
                      {c.firstReleaseDate ? ` · ${c.firstReleaseDate.slice(0, 4)}` : ""}
                      {c.primaryType ? ` · ${c.primaryType}` : ""}
                    </span>
                    <span className="identify-candidate-mbid">{c.id}</span>
                  </button>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && !searchLoading && (
              <p className="identify-hint identify-hint--warn">No results found — enter MBID manually below.</p>
            )}
          </section>

          {/* ── Album name / artist override ── */}
          <section className="identify-section">
            <h3 className="identify-section-title">Last.fm strings</h3>
            <p className="identify-hint">Override the artist/album name used for Last.fm lookups (e.g. fix typos, alternate titles).</p>
            <label className="identify-field">
              <span>Artist</span>
              <input
                type="text"
                placeholder={artist}
                value={lfmArtist}
                onChange={(e) => { setLfmArtist(e.target.value); setLfmArtistUsedForSearch(false); setFetchEnabled(false); }}
              />
            </label>
            <label className="identify-field">
              <span>Album</span>
              <input
                type="text"
                placeholder={album}
                value={lfmAlbum}
                onChange={(e) => { setLfmAlbum(e.target.value); setLfmAlbumUsedForSearch(false); setFetchEnabled(false); }}
              />
            </label>
          </section>

          {/* ── MusicBrainz IDs ── */}
          <section className="identify-section">
            <h3 className="identify-section-title">MusicBrainz</h3>
            <label className="identify-field">
              <span>Release Group MBID</span>
              <input
                type="text"
                placeholder="e.g. 76df3287-6cda-33eb-8e9a-044b5e15ffdd"
                value={mbRgId}
                onChange={(e) => { setMbRgId(e.target.value); setSelectedCandidate(null); setFetchEnabled(false); }}
              />
            </label>
            <label className="identify-field">
              <span>Release MBID (optional)</span>
              <input
                type="text"
                placeholder="specific pressing MBID"
                value={mbReleaseId}
                onChange={(e) => { setMbReleaseId(e.target.value); setFetchEnabled(false); }}
              />
            </label>
            <label className="identify-field">
              <span>Artist MBID (optional)</span>
              <input
                type="text"
                placeholder="artist MBID"
                value={mbArtistId}
                onChange={(e) => { setMbArtistId(e.target.value); setFetchEnabled(false); }}
              />
            </label>
          </section>

          {/* ── Fetch button ── */}
          <div className="identify-actions-row">
            <button
              className="identify-btn identify-btn--fetch"
              onClick={handleFetch}
              disabled={isFetching}
            >
              {isFetching ? <Loader size={14} className="identify-spinner" /> : <Search size={14} />}
              {isFetching ? "Looking up…" : "Look up"}
            </button>
          </div>

          {/* ── Results ── */}
          {lookupResult && !isFetching && (
            <section className="identify-section identify-results">
              {/* MusicBrainz result */}
              <div className="identify-source-row">
                <StatusBadge status={lookupResult.mbStatus} />
                <span className="identify-source-name">MusicBrainz</span>
              </div>

              {isAmbiguous && candidates.length > 0 && (
                <div className="identify-candidates">
                  <p className="identify-hint">{candidates.length === 1 ? "Select to confirm:" : "Multiple matches — select one:"}</p>
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      className={`identify-candidate${selectedCandidate === c.id ? " identify-candidate--selected" : ""}`}
                      onClick={() => handleSelectCandidate(c)}
                    >
                      <div className="identify-candidate-header">
                        <span className="identify-candidate-title">{c.title}</span>
                        <MusicBrainzBrowseLink kind="release-group" id={c.id} />
                      </div>
                      <span className="identify-candidate-meta">
                        {c.artistName} · {c.firstReleaseDate ?? "?"} · {c.primaryType ?? "Album"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {lookupResult.mbStatus === "found" && rgDetail && (
                <div className="identify-facts">
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">Album</span>
                    <span className="identify-fact-value">{rgDetail.title}</span>
                  </div>
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">Artist</span>
                    <span className="identify-fact-value">{rgDetail.artistName}</span>
                  </div>
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">Year</span>
                    <span className="identify-fact-value">
                      {rgDetail.firstReleaseDate?.slice(0, 4) ?? "—"}
                    </span>
                  </div>
                  {releaseDetail?.label && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Label</span>
                      <span className="identify-fact-value">{releaseDetail.label}</span>
                    </div>
                  )}
                  {releaseDetail?.country && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Country</span>
                      <span className="identify-fact-value">{releaseDetail.country}</span>
                    </div>
                  )}
                  {releaseDetail?.catalogNumber && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Catalog #</span>
                      <span className="identify-fact-value">{releaseDetail.catalogNumber}</span>
                    </div>
                  )}
                  {combinedGenres.length > 0 && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Genres</span>
                      <span className="identify-fact-value">
                        {combinedGenres.slice(0, 6).map((g) => g.name).join(" · ")}
                      </span>
                    </div>
                  )}
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">RG MBID</span>
                    <span className="identify-fact-value identify-fact-value--mono">{rgDetail.id}</span>
                  </div>
                </div>
              )}

              {lookupResult.mbStatus === "not_found" && (
                <p className="identify-hint identify-hint--warn">No match found on MusicBrainz. Try entering the MBID directly.</p>
              )}

              {lookupResult.mbStatus === "error" && (
                <p className="identify-hint identify-hint--error">{lookupResult.error}</p>
              )}
            </section>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="identify-footer">
          <button className="identify-btn" onClick={onClose}>Cancel</button>
          <button
            className="identify-btn identify-btn--primary"
            onClick={() => void handleConfirm()}
            disabled={saveIdentity.isPending}
          >
            {saveIdentity.isPending ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Artist variant ─────────────────────────────────────────────────────────────

interface ArtistIdentifyDialogProps {
  artistName: string;
  onClose: () => void;
}

export function ArtistIdentifyDialog({ artistName, onClose }: ArtistIdentifyDialogProps) {
  const { data: savedIdentity } = useArtistIdentity(artistName);
  const saveIdentity = useSaveArtistIdentity();

  const [mbArtistId, setMbArtistId] = useState("");
  const [lfmArtist, setLfmArtist] = useState("");
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [initialLfmArtist, setInitialLfmArtist] = useState("");
  const [lfmArtistUsedForSearch, setLfmArtistUsedForSearch] = useState(false);

  useEffect(() => {
    if (!savedIdentity) return;
    setMbArtistId(savedIdentity.mb_artist_id ?? "");
    const a = savedIdentity.lastfm_artist_name ?? "";
    setLfmArtist(a);
    setInitialLfmArtist(a);
  }, [savedIdentity]);

  const effectiveMbArtistId = selectedCandidate ?? (mbArtistId.trim() || null);

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["mb-search-artist", artistName],
    queryFn: () => searchArtists(artistName),
    staleTime: 10 * 60 * 1000,
    enabled: !!artistName.trim(),
  });

  // An MBID already confirmed for this artist via a previously matched album
  // (album_identity) or a prior artist-identify confirmation. If it's among
  // the search results, pre-select it — no need to make the user pick between
  // candidates when we already know the answer.
  const { data: confirmedArtistMbid } = useConfirmedArtistMbid(artistName);
  useEffect(() => {
    if (savedIdentity || selectedCandidate || !confirmedArtistMbid || !searchResults) return;
    const match = searchResults.find((c) => c.id === confirmedArtistMbid);
    if (match) {
      setSelectedCandidate(match.id);
      setMbArtistId(match.id);
      setFetchEnabled(true);
    }
  }, [savedIdentity, selectedCandidate, confirmedArtistMbid, searchResults]);

  const { data: lookupResult, isFetching } = useIdentifyArtist({
    artistName: lfmArtist.trim() || artistName,
    overrideMbArtistId: effectiveMbArtistId,
    enabled: fetchEnabled,
  });

  function handleFetch() {
    setSelectedCandidate(null);
    setLfmArtistUsedForSearch(true);
    setFetchEnabled(true);
  }

  function handleSelectCandidate(c: MbArtistCandidate) {
    setSelectedCandidate(c.id);
    setMbArtistId(c.id);
  }

  function handlePickSearchResult(c: MbArtistCandidate) {
    setSelectedCandidate(c.id);
    setMbArtistId(c.id);
    setFetchEnabled(true);
  }

  async function handleConfirm() {
    const lastfmArtist = lfmArtistUsedForSearch ? (initialLfmArtist || null) : (lfmArtist.trim() || lookupResult?.mbDetail?.name || null);
    await saveIdentity.mutateAsync({
      artistName,
      mbArtistId: effectiveMbArtistId ?? lookupResult?.mbDetail?.id ?? null,
      lastfmArtistName: lastfmArtist,
    });
    onClose();
  }

  const artistDetail = lookupResult?.mbDetail;
  const isAmbiguous = lookupResult?.mbStatus === "ambiguous";
  const candidates: MbArtistCandidate[] = lookupResult?.mbCandidates ?? [];

  return createPortal(
    <div className="identify-overlay" onClick={onClose}>
      <div className="identify-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="identify-header">
          <h2 className="identify-title">Identify Artist</h2>
          <button className="identify-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="identify-body">
          {/* ── MB Search Results ── */}
          <section className="identify-section">
            <h3 className="identify-section-title">MusicBrainz</h3>
            {searchLoading && (
              <div className="identify-search-loading">
                <Loader size={13} className="identify-spinner" />
                <span>Searching…</span>
              </div>
            )}
            {searchResults && searchResults.length > 0 && (
              <div className="identify-candidates">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    className={`identify-candidate${selectedCandidate === c.id ? " identify-candidate--selected" : ""}`}
                    onClick={() => handlePickSearchResult(c)}
                  >
                    <div className="identify-candidate-header">
                      <span className="identify-candidate-title">{c.name}</span>
                      {c.id === confirmedArtistMbid && (
                        <span className="identify-candidate-score">Matches identified album</span>
                      )}
                      {c.id !== confirmedArtistMbid && c.score != null && (
                        <span className="identify-candidate-score">{c.score}%</span>
                      )}
                      <MusicBrainzBrowseLink kind="artist" id={c.id} />
                    </div>
                    {(c.disambiguation ?? c.country) && (
                      <span className="identify-candidate-meta">
                        {[c.disambiguation, c.country].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span className="identify-candidate-mbid">{c.id}</span>
                  </button>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && !searchLoading && (
              <p className="identify-hint identify-hint--warn">No results found — enter MBID manually below.</p>
            )}
          </section>

          <section className="identify-section">
            <h3 className="identify-section-title">Last.fm override</h3>
            <label className="identify-field">
              <span>Artist name</span>
              <input
                type="text"
                placeholder={artistName}
                value={lfmArtist}
                onChange={(e) => { setLfmArtist(e.target.value); setLfmArtistUsedForSearch(false); setFetchEnabled(false); }}
              />
            </label>
          </section>

          <section className="identify-section">
            <h3 className="identify-section-title">MusicBrainz</h3>
            <label className="identify-field">
              <span>Artist MBID</span>
              <input
                type="text"
                placeholder="e.g. 65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab"
                value={mbArtistId}
                onChange={(e) => { setMbArtistId(e.target.value); setSelectedCandidate(null); setFetchEnabled(false); }}
              />
            </label>
          </section>

          <div className="identify-actions-row">
            <button
              className="identify-btn identify-btn--fetch"
              onClick={handleFetch}
              disabled={isFetching}
            >
              {isFetching ? <Loader size={14} className="identify-spinner" /> : <Search size={14} />}
              {isFetching ? "Looking up…" : "Look up"}
            </button>
          </div>

          {lookupResult && !isFetching && (
            <section className="identify-section identify-results">
              <div className="identify-source-row">
                <StatusBadge status={lookupResult.mbStatus} />
                <span className="identify-source-name">MusicBrainz</span>
              </div>

              {isAmbiguous && candidates.length > 0 && (
                <div className="identify-candidates">
                  <p className="identify-hint">{candidates.length === 1 ? "Select to confirm:" : "Multiple matches — select one:"}</p>
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      className={`identify-candidate${selectedCandidate === c.id ? " identify-candidate--selected" : ""}`}
                      onClick={() => handleSelectCandidate(c)}
                    >
                      <div className="identify-candidate-header">
                        <span className="identify-candidate-title">{c.name}</span>
                        <MusicBrainzBrowseLink kind="artist" id={c.id} />
                      </div>
                      {c.disambiguation && (
                        <span className="identify-candidate-meta">{c.disambiguation}</span>
                      )}
                      {c.country && (
                        <span className="identify-candidate-meta">{c.country}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {lookupResult.mbStatus === "found" && artistDetail && (
                <div className="identify-facts">
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">Name</span>
                    <span className="identify-fact-value">{artistDetail.name}</span>
                  </div>
                  {artistDetail.disambiguation && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Disambiguation</span>
                      <span className="identify-fact-value">{artistDetail.disambiguation}</span>
                    </div>
                  )}
                  {artistDetail.country && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Country</span>
                      <span className="identify-fact-value">{artistDetail.country}</span>
                    </div>
                  )}
                  {artistDetail.genres.length > 0 && (
                    <div className="identify-fact-row">
                      <span className="identify-fact-label">Genres</span>
                      <span className="identify-fact-value">
                        {artistDetail.genres.slice(0, 6).map((g) => g.name).join(" · ")}
                      </span>
                    </div>
                  )}
                  <div className="identify-fact-row">
                    <span className="identify-fact-label">MBID</span>
                    <span className="identify-fact-value identify-fact-value--mono">{artistDetail.id}</span>
                  </div>
                </div>
              )}

              {lookupResult.mbStatus === "not_found" && (
                <p className="identify-hint identify-hint--warn">No match found. Try entering the MBID directly.</p>
              )}

              {lookupResult.mbStatus === "error" && (
                <p className="identify-hint identify-hint--error">{lookupResult.error}</p>
              )}
            </section>
          )}
        </div>

        <div className="identify-footer">
          <button className="identify-btn" onClick={onClose}>Cancel</button>
          <button
            className="identify-btn identify-btn--primary"
            onClick={() => void handleConfirm()}
            disabled={saveIdentity.isPending}
          >
            {saveIdentity.isPending ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "found":
      return <CheckCircle size={16} className="identify-status identify-status--found" />;
    case "not_found":
      return <XCircle size={16} className="identify-status identify-status--not-found" />;
    case "ambiguous":
      return <AlertCircle size={16} className="identify-status identify-status--ambiguous" />;
    case "error":
      return <XCircle size={16} className="identify-status identify-status--error" />;
    default:
      return null;
  }
}
