import { useServers, useServerWithCredential } from "../hooks/useServer";
import { getCoverArtUrl } from "../lib/navidrome";
import { useTagAlbums } from "../hooks/useTagMappings";
import { CanonCombobox } from "./CanonCombobox";
import type { TagKind } from "../lib/canonicalize";

// ── Sentinel constants ────────────────────────────────────────────────────────

export const ACCEPTED = "__accepted__";
export const IGNORED = "__ignored__";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ArtAlbum = { album_id: string; album_name: string; artwork_url: string | null };
export type KindFilter = "all" | "genre" | "mood";
export interface SegOption { value: string; label: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

export function applyKindFilter<T extends { kind: TagKind }>(rows: T[], kind: KindFilter): T[] {
  return kind === "all" ? rows : rows.filter((r) => r.kind === kind);
}

export function applySearch<T extends { raw_value: string }>(rows: T[], search: string): T[] {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter((r) => r.raw_value.toLowerCase().includes(q));
}

// ── AlbumArtStrip ─────────────────────────────────────────────────────────────

export function AlbumArtStrip({ rawValue, kind, size = 24 }: { rawValue: string; kind: TagKind; size?: number }) {
  const { data: albums = [] } = useTagAlbums(rawValue, kind);
  const { data: servers } = useServers();
  const { data: swc } = useServerWithCredential(servers?.[0]?.id);

  const tiles = albums
    .map((a) => ({
      ...a,
      url:
        swc && a.artwork_url
          ? getCoverArtUrl(swc.server.url, swc.server.username, swc.credential, a.artwork_url, size * 2)
          : null,
    }))
    .filter((a) => a.url);

  if (!tiles.length) return null;

  return (
    <div className="tags-art-strip">
      {tiles.map((a) => (
        <div
          key={a.album_id}
          className="tags-art-thumb"
          title={a.album_name}
          style={{ width: size, height: size }}
        >
          <img src={a.url!} alt="" width={size} height={size} loading="lazy" decoding="async" />
        </div>
      ))}
    </div>
  );
}

// ── TagSourceLabels ───────────────────────────────────────────────────────────

export const SOURCE_META: Record<string, { cls: string; label: string }> = {
  "lastfm":                { cls: "src-lfm",     label: "Last.fm" },
  "musicbrainz":           { cls: "src-mb",      label: "MusicBrainz" },
  "musicbrainz-folksonomy":{ cls: "src-mb-folk", label: "Folksonomy" },
  "file":                  { cls: "src-file",    label: "File tags" },
};

function srcCls(s: string) {
  return SOURCE_META[s]?.cls ?? (s.startsWith("musicbrainz") ? "src-mb" : "src-file");
}

/** Colored dot per source — use SOURCE_META for a legend. */
export function TagSourceDots({ sources }: { sources: string | null }) {
  if (!sources) return null;
  const parts = sources.split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <span className="tag-sources">
      {parts.map((s) => (
        <span
          key={s}
          className={`tag-src-dot ${srcCls(s)}`}
          title={SOURCE_META[s]?.label ?? s}
        />
      ))}
    </span>
  );
}

// ── SegToggle ─────────────────────────────────────────────────────────────────

export function SegToggle({ value, options, onChange }: {
  value: string;
  options: SegOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="tags-seg">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`tags-seg-btn${value === opt.value ? " tags-seg-btn--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Re-export CanonCombobox so tabs only need one import for tag-related components
export { CanonCombobox };

// ── Pagination ────────────────────────────────────────────────────────────────

export function Pagination({ page, total, pageSize, onChange }: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  function pages(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 4) return [1, 2, 3, 4, 5, "…", totalPages];
    if (page >= totalPages - 3) return [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, "…", page - 1, page, page + 1, "…", totalPages];
  }

  return (
    <div className="pagination">
      <button className="pg-btn" disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button>
      {pages().map((p, i) =>
        p === "…"
          ? <span key={`e${i}`} className="pg-ellipsis">…</span>
          : <button key={p} className={`pg-btn${page === p ? " pg-btn--active" : ""}`} onClick={() => onChange(p)}>{p}</button>
      )}
      <button className="pg-btn" disabled={page === totalPages} onClick={() => onChange(page + 1)}>›</button>
    </div>
  );
}
