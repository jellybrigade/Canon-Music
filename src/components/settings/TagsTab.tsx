import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QK } from "../../lib/query-keys";
import { getDb } from "../../db";
import { normalizeAlbum } from "../../lib/tag-normalize";
import { autoIdentifyAlbum } from "../../lib/album-identify";
import { persistAlbumIdentity } from "../../hooks/useAlbumIdentity";
import { getMinTagCount, setMinTagCount, setApiKey as setLastfmApiKey } from "../../lib/lastfm";
import { getFanartApiKey, setFanartApiKey } from "../../lib/fanart";
import { getMinFolksonomyCount, setMinFolksonomyCount } from "../../lib/musicbrainz";
import { keychain } from "../../keychain";
import { useBoolSetting, useSetting } from "../../hooks/useSetting";
import { useTagsStore } from "../../store/tags";
import { useRapToHipHop } from "../../hooks/useTagMappings";
import { SettingRow } from "./SettingRow";

interface Props {
  searchQuery: string;
  hideTagBadge: boolean;
  setHideTagBadge: (v: boolean) => Promise<void>;
}

function useLastRefreshed() {
  return useQuery({
    queryKey: QK.albumsLastComputedAt(),
    queryFn: async () => {
      const db = await getDb();
      type Row = { last_at: number | null };
      const rows = await db.select<Row[]>("SELECT MAX(computed_at) as last_at FROM albums");
      return rows[0]?.last_at ?? null;
    },
  });
}

export function TagsTab({ searchQuery, hideTagBadge, setHideTagBadge }: Props) {
  const queryClient = useQueryClient();

  const [lastfmKey, setLastfmKeyState] = useState("");
  const [lastfmKeyFocused, setLastfmKeyFocused] = useState(false);
  useEffect(() => {
    keychain.get("canon.lastfm", "api_key")
      .then((k) => { if (k) setLastfmKeyState(k); })
      .catch(() => {});
  }, []);
  async function setLastfmKey(k: string) {
    setLastfmKeyState(k);
    await setLastfmApiKey(k);
  }
  const lastfmKeyDisplay = !lastfmKeyFocused && lastfmKey.length > 8
    ? `${lastfmKey.slice(0, 4)}••••••••${lastfmKey.slice(-4)}`
    : lastfmKey;

  const [fanartKey, setFanartKeyState] = useState("");
  const [fanartKeyFocused, setFanartKeyFocused] = useState(false);
  useEffect(() => {
    getFanartApiKey()
      .then((k) => { if (k) setFanartKeyState(k); })
      .catch(() => {});
  }, []);
  async function handleSetFanartKey(k: string) {
    setFanartKeyState(k);
    await setFanartApiKey(k);
  }
  const fanartKeyDisplay = !fanartKeyFocused && fanartKey.length > 8
    ? `${fanartKey.slice(0, 4)}••••••••${fanartKey.slice(-4)}`
    : fanartKey;

  const [mbAutoIdentify, setMbAutoIdentify] = useBoolSetting("mb.auto_identify", false);
  const [autoRefresh, setAutoRefresh] = useBoolSetting("tags.auto_refresh", true);
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "30");
  const [skipYearGenres, setSkipYearGenres] = useBoolSetting("tags.skip_year_genres", false);
  const { enabled: rapToHipHop, toggle: toggleRapToHipHop } = useRapToHipHop();

  const { data: minTagCount } = useQuery({
    queryKey: QK.settingsLastfmMinTagCount(),
    queryFn: getMinTagCount,
  });
  const { data: minFolksonomyCount } = useQuery({
    queryKey: QK.settingsMbMinFolksonomy(),
    queryFn: getMinFolksonomyCount,
  });

  const pullProgress = useTagsStore((s) => s.pullProgress);
  const setPullProgress = useTagsStore((s) => s.setPullProgress);
  const { data: lastRefreshedAt, refetch: refetchLastRefreshed } = useLastRefreshed();

  const handleRefreshAll = useCallback(async () => {
    const db = await getDb();
    type Row = { id: string; artist: string | null; name: string };

    const unmatched = await db.select<Row[]>(
      `SELECT a.id, a.artist, a.name FROM albums a
       WHERE NOT EXISTS (
         SELECT 1 FROM album_identity ai
         WHERE ai.album_id = a.id AND ai.confirmed_at IS NOT NULL
       )
       ORDER BY a.name`
    );
    if (unmatched.length > 0) {
      setPullProgress({ done: 0, total: unmatched.length });
      for (let i = 0; i < unmatched.length; i++) {
        const album = unmatched[i]!;
        try {
          const result = await autoIdentifyAlbum({ artist: album.artist ?? "", album: album.name });
          if (result.decision === "auto_confirmed" && result.detail) {
            const now = Math.floor(Date.now() / 1000);
            await persistAlbumIdentity({
              albumId: album.id,
              mbReleaseGroupId: result.detail.id,
              mbReleaseId: result.release?.id ?? null,
              mbArtistId: result.detail.artistMbid ?? null,
              lastfmArtistName: null,
              lastfmAlbumName: null,
              lastfmMatchConfirmed: false,
              combinedGenres: result.combinedGenres,
              combinedTags: result.combinedTags,
              label: result.release?.label ?? null,
              country: result.release?.country ?? null,
              catalogNumber: result.release?.catalogNumber ?? null,
              barcode: result.release?.barcode ?? null,
              releaseDate: result.release?.date ?? result.detail.firstReleaseDate ?? null,
              autoMatched: true,
              matchScore: Math.round(result.score * 100),
              confirmedAt: now,
            });
          } else {
            const now = Math.floor(Date.now() / 1000);
            await db.execute(
              `INSERT OR IGNORE INTO album_identity (album_id, auto_matched, match_score, looked_up_at)
               VALUES (?, 0, ?, ?)`,
              [album.id, Math.round(result.score * 100), now]
            );
          }
        } catch (e) {
          console.warn("MB sync failed for:", album.name, e);
        }
        setPullProgress({ done: i + 1, total: unmatched.length });
      }
      await queryClient.invalidateQueries({ queryKey: QK.albumIdentityAll() });
    }

    type FullRow = {
      id: string; artist: string | null; name: string;
      lastfm_artist_name: string | null; lastfm_album_name: string | null;
      combined_genres_json: string | null; combined_tags_json: string | null;
    };
    const albums = await db.select<FullRow[]>(
      `SELECT a.id, a.artist, a.name,
              ai.lastfm_artist_name, ai.lastfm_album_name, ai.combined_genres_json, ai.combined_tags_json
       FROM albums a
       LEFT JOIN album_identity ai ON ai.album_id = a.id
       ORDER BY a.name`
    );
    setPullProgress({ done: 0, total: albums.length });
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]!;
      try {
        const combinedMbGenres = album.combined_genres_json
          ? (JSON.parse(album.combined_genres_json) as Array<{ name: string; count: number }>)
          : null;
        const combinedMbTags = album.combined_tags_json
          ? (JSON.parse(album.combined_tags_json) as Array<{ name: string; count: number }>)
          : null;
        await normalizeAlbum(album.id, album.artist ?? "", album.name, {
          lastfmArtistName: album.lastfm_artist_name,
          lastfmAlbumName: album.lastfm_album_name,
          combinedMbGenres,
          combinedMbTags,
        });
      } catch (e) {
        console.warn("Last.fm sync failed for:", album.name, e);
      }
      setPullProgress({ done: i + 1, total: albums.length });
    }

    await queryClient.invalidateQueries({ queryKey: QK.normalizedTagsAll() });
    void refetchLastRefreshed();
    setPullProgress(null);
  }, [refetchLastRefreshed, queryClient, setPullProgress]);

  const fl = searchQuery.toLowerCase().trim();
  const show = (...labels: string[]) => !fl || labels.some(l => l.toLowerCase().includes(fl));

  return (
    <>
      {show("last.fm", "lastfm", "api key", "tag popularity", "tags") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Last.fm</h3>
          <p className="settings-section-desc">
            Canon keeps tags clean and enriched automatically. Genres are pulled from Last.fm in the background.
            Nothing is written to your files.
          </p>
          <SettingRow title="API key" stacked>
            <input
              type="text"
              placeholder="Paste your Last.fm API key"
              value={lastfmKeyDisplay}
              onFocus={() => setLastfmKeyFocused(true)}
              onBlur={() => setLastfmKeyFocused(false)}
              onChange={(e) => void setLastfmKey(e.target.value)}
            />
          </SettingRow>
          <SettingRow
            title="Min tag popularity"
            description="0–100. Lower = more tags included. Raise to cut noise."
          >
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={minTagCount ?? 25}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0 && v <= 100) {
                  void setMinTagCount(v).then(() => {
                    void queryClient.invalidateQueries({ queryKey: QK.settingsLastfmMinTagCount() });
                  });
                }
              }}
              className="settings-staleness-input"
            />
          </SettingRow>
        </section>
      )}

      {show("musicbrainz", "identify", "folksonomy", "mb", "album") && (
        <section className="settings-section">
          <h3 className="settings-section-title">MusicBrainz</h3>
          <p className="settings-section-desc">
            No API key required. Use the <strong>Identify…</strong> button on any album or artist to confirm
            MusicBrainz IDs. Confirmed identity enriches genres, label, country, and release date.
          </p>
          <SettingRow
            title="Auto-identify albums when opened"
            description="Runs MusicBrainz lookup automatically when you open an album."
          >
            <input
              type="checkbox"
              checked={mbAutoIdentify}
              onChange={(e) => void setMbAutoIdentify(e.target.checked)}
            />
          </SettingRow>
          <SettingRow
            title="Min folksonomy tag votes"
            description="0–100. Minimum vote count for MusicBrainz folksonomy tags."
          >
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={minFolksonomyCount ?? 2}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0 && v <= 100) {
                  void setMinFolksonomyCount(v).then(() => {
                    void queryClient.invalidateQueries({ queryKey: QK.settingsMbMinFolksonomy() });
                  });
                }
              }}
              className="settings-staleness-input"
            />
          </SettingRow>
        </section>
      )}

      {show("fanart", "fanart.tv", "portrait", "artist image", "api key") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Fanart.tv</h3>
          <p className="settings-section-desc">
            Richer artist portraits as a fallback when MusicBrainz / Wikidata has no image.
            Get a free personal API key at fanart.tv.
          </p>
          <SettingRow title="API key" stacked>
            <input
              type="text"
              placeholder="Paste your Fanart.tv API key"
              value={fanartKeyDisplay}
              onFocus={() => setFanartKeyFocused(true)}
              onBlur={() => setFanartKeyFocused(false)}
              onChange={(e) => void handleSetFanartKey(e.target.value)}
            />
          </SettingRow>
        </section>
      )}

      {show("refresh", "auto", "stale", "metadata", "launch") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Auto-refresh</h3>
          <SettingRow
            title="Auto-refresh metadata on launch"
            description="Re-pulls Last.fm tags for stale albums when Canon starts."
          >
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => void setAutoRefresh(e.target.checked)}
            />
          </SettingRow>
          <SettingRow
            title="Stale after (days)"
            description="Albums not refreshed within this window are re-pulled on next launch."
          >
            <input
              type="number"
              min={1}
              max={9999}
              value={stalenessDays}
              onChange={(e) => void setStalenessDays(e.target.value)}
              className="settings-staleness-input"
            />
          </SettingRow>
          <div className="settings-field settings-field--row">
            <button
              className="settings-btn"
              onClick={() => { void handleRefreshAll(); }}
              disabled={pullProgress !== null}
              title="Identify unmatched albums on MusicBrainz, then re-pull all Last.fm tags"
            >
              {pullProgress
                ? `Refreshing… ${pullProgress.done} / ${pullProgress.total}`
                : "Refresh all now"}
            </button>
            {lastRefreshedAt && pullProgress === null && (
              <span className="settings-hint">
                Last refreshed {new Date(lastRefreshedAt * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
        </section>
      )}

      {show("mapping", "rap", "hip hop", "genre", "badge", "tag issues", "hide", "year", "decade", "skip") && (
        <section className="settings-section">
          <h3 className="settings-section-title">Display</h3>
          <SettingRow
            title='Map "Rap" to Hip Hop'
            description="Treats Rap as an alias for Hip Hop in the genre tree."
          >
            <input
              type="checkbox"
              checked={rapToHipHop}
              onChange={(e) => { void toggleRapToHipHop.mutate(e.target.checked); }}
            />
          </SettingRow>
          <SettingRow
            title="Skip year/decade genre tags"
            description='Ignores tags like "1969", "90s", "2000s" during normalization. Takes effect on next refresh.'
          >
            <input
              type="checkbox"
              checked={skipYearGenres}
              onChange={(e) => void setSkipYearGenres(e.target.checked)}
            />
          </SettingRow>
          <SettingRow
            title="Hide tag issues badge"
            description="Suppresses the badge counter on the Tags sidebar item."
          >
            <input
              type="checkbox"
              checked={hideTagBadge}
              onChange={(e) => void setHideTagBadge(e.target.checked)}
            />
          </SettingRow>
        </section>
      )}
    </>
  );
}
