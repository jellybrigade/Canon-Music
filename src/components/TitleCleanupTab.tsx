import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  BUILTIN_PATTERNS,
  useAlbumSuffixAllowlist,
  useAlbumSuffixExclusions,
  useDisabledBuiltinIds,
  extractSuffix,
} from "../hooks/useAlbumDisplayName";
import { useAlbums } from "../hooks/useAlbums";

type AlbumEntry = { id: string; name: string; artist: string | null };

function AlbumList({
  albums,
  excludedIds,
  onExclude,
  onUnexclude,
}: {
  albums: AlbumEntry[];
  excludedIds: string[];
  onExclude: (id: string) => void;
  onUnexclude: (id: string) => void;
}) {
  const active = albums.filter((a) => !excludedIds.includes(a.id));
  const kept = albums.filter((a) => excludedIds.includes(a.id));
  return (
    <div className="title-cleanup-album-list">
      {active.map((a) => (
        <div key={a.id} className="title-cleanup-album-row">
          <span className="title-cleanup-album-name">{a.artist != null ? `${a.artist} - ${a.name}` : a.name}</span>
          <button
            className="title-cleanup-album-exclude"
            title="Keep suffix visible for this album"
            onClick={() => onExclude(a.id)}
          >
            ×
          </button>
        </div>
      ))}
      {kept.length > 0 && (
        <div className="title-cleanup-kept-section">
          <span className="title-cleanup-kept-label">Kept</span>
          {kept.map((a) => (
            <div key={a.id} className="title-cleanup-album-row title-cleanup-album-row--kept">
              <span className="title-cleanup-album-name">{a.artist != null ? `${a.artist} - ${a.name}` : a.name}</span>
              <button
                className="title-cleanup-album-unexclude"
                title="Re-apply suffix stripping"
                onClick={() => onUnexclude(a.id)}
              >
                ↩
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CountBtn({ albums, open, onToggle }: { albums: { id: string; name: string; artist: string | null }[]; open: boolean; onToggle: () => void }) {
  if (albums.length === 0) {
    return <span className="title-cleanup-count title-cleanup-count--zero">0 albums</span>;
  }
  return (
    <button
      className={`title-cleanup-count${open ? " title-cleanup-count--open" : ""}`}
      onClick={onToggle}
    >
      {albums.length} album{albums.length !== 1 ? "s" : ""}
    </button>
  );
}

function BuiltinRow({
  label,
  disabled,
  affectedAlbums,
  excludedIds,
  onToggle,
  onExclude,
  onUnexclude,
}: {
  label: string;
  disabled: boolean;
  affectedAlbums: AlbumEntry[];
  excludedIds: string[];
  onToggle: () => void;
  onExclude: (id: string) => void;
  onUnexclude: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const zero = affectedAlbums.length === 0;
  return (
    <li className={`title-cleanup-item${disabled || zero ? " title-cleanup-item--disabled" : ""}`}>
      <div className="title-cleanup-row">
        <span className="title-cleanup-builtin-label" title={label}>{label}</span>
        <CountBtn albums={affectedAlbums} open={open} onToggle={() => setOpen((v) => !v)} />
        <button
          className={`title-cleanup-toggle${disabled ? " title-cleanup-toggle--off" : ""}`}
          onClick={onToggle}
        >
          {disabled ? "Enable" : "Disable"}
        </button>
      </div>
      {open && (
        <AlbumList
          albums={affectedAlbums}
          excludedIds={excludedIds}
          onExclude={onExclude}
          onUnexclude={onUnexclude}
        />
      )}
    </li>
  );
}

function CustomRow({
  suffix,
  affectedAlbums,
  excludedIds,
  onRemove,
  onEdit,
  onExclude,
  onUnexclude,
}: {
  suffix: string;
  affectedAlbums: AlbumEntry[];
  excludedIds: string[];
  onRemove: () => void;
  onEdit: (next: string) => void;
  onExclude: (id: string) => void;
  onUnexclude: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(suffix);

  function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== suffix) onEdit(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="title-cleanup-item">
        <div className="title-cleanup-row">
          <input
            className="title-cleanup-edit-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") { setDraft(suffix); setEditing(false); }
            }}
          />
          <button className="title-cleanup-action" onClick={save}>Save</button>
          <button className="title-cleanup-action title-cleanup-action--muted" onClick={() => { setDraft(suffix); setEditing(false); }}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  const zero = affectedAlbums.length === 0;
  return (
    <li className={`title-cleanup-item${zero ? " title-cleanup-item--disabled" : ""}`}>
      <div className="title-cleanup-row">
        <span className="title-cleanup-suffix" title={`(${suffix})`}>({suffix})</span>
        <CountBtn albums={affectedAlbums} open={open} onToggle={() => setOpen((v) => !v)} />
        <button className="title-cleanup-action title-cleanup-action--muted" onClick={() => { setDraft(suffix); setEditing(true); }}>
          Edit
        </button>
        <button className="title-cleanup-action title-cleanup-action--remove" onClick={onRemove} title="Remove">
          ×
        </button>
      </div>
      {open && (
        <AlbumList
          albums={affectedAlbums}
          excludedIds={excludedIds}
          onExclude={onExclude}
          onUnexclude={onUnexclude}
        />
      )}
    </li>
  );
}

export function TitleCleanupTab() {
  const [allowlist, addSuffix, removeSuffix, editSuffix] = useAlbumSuffixAllowlist();
  const [disabledIds, disableBuiltin, enableBuiltin] = useDisabledBuiltinIds();
  const [excludedAlbumIds, excludeAlbum, unexcludeAlbum] = useAlbumSuffixExclusions();
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [builtinsOpen, setBuiltinsOpen] = useState(false);
  const { data: allAlbums = [] } = useAlbums();

  const suffixAlbumMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; artist: string | null }[]>();
    for (const album of allAlbums) {
      const suffix = extractSuffix(album.name);
      if (!suffix) continue;
      const key = suffix.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ id: album.id, name: album.name, artist: album.artist });
    }
    return map;
  }, [allAlbums]);

  function customMatches(suffix: string): { id: string; name: string; artist: string | null }[] {
    return suffixAlbumMap.get(suffix.toLowerCase()) ?? [];
  }

  const builtinMatchesMap = useMemo(() => {
    const result = new Map<string, { id: string; name: string; artist: string | null }[]>();
    for (const p of BUILTIN_PATTERNS) {
      const matches: { id: string; name: string; artist: string | null }[] = [];
      for (const [suffix, albums] of suffixAlbumMap) {
        if (p.pattern.test(suffix)) matches.push(...albums);
      }
      result.set(p.id, matches);
    }
    return result;
  }, [suffixAlbumMap]);

  const q = filter.trim().toLowerCase();

  const sortedAllowlist = useMemo(
    () =>
      [...allowlist]
        .filter((s) => !q || s.toLowerCase().includes(q))
        .sort((a, b) => customMatches(b).length - customMatches(a).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowlist, suffixAlbumMap, q],
  );

  const sortedBuiltins = useMemo(
    () =>
      [...BUILTIN_PATTERNS]
        .filter((p) => !q || p.label.toLowerCase().includes(q))
        .sort((a, b) => (builtinMatchesMap.get(b.id)?.length ?? 0) - (builtinMatchesMap.get(a.id)?.length ?? 0)),
    [builtinMatchesMap, q],
  );

  const builtinsMatchQuery = q.length > 0 && sortedBuiltins.length > 0;
  const showBuiltins = builtinsOpen || builtinsMatchQuery;

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (allowlist.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setInputError("Already in the list.");
      return;
    }
    setInputError(null);
    void addSuffix(trimmed);
    setInputValue("");
  }

  return (
    <div className="title-cleanup-tab">
      <div className="title-cleanup-inner">
        <p className="title-cleanup-intro">
          When "Hide album suffixes" is on, Canon strips known edition labels like{" "}
          <em>(Deluxe Edition)</em> from album titles. Turn off any built-in rule or add
          your own.
        </p>

        <div className="title-cleanup-filter-row">
          <input
            className="title-cleanup-input"
            type="text"
            placeholder="Filter rules…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <section>
          <div className="title-cleanup-section-label">Your rules</div>
          <div className="title-cleanup-add-row">
            <input
              className="title-cleanup-input"
              type="text"
              placeholder="e.g. Special Edition"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setInputError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
            <button className="title-cleanup-add-btn" onClick={handleAdd} disabled={!inputValue.trim()}>
              Add
            </button>
          </div>
          {inputError && <div className="title-cleanup-error">{inputError}</div>}
          {allowlist.length === 0 ? (
            <p className="title-cleanup-empty">
              No custom rules yet. Albums with unrecognized parentheticals show a
              "Strip…" button in their detail view.
            </p>
          ) : sortedAllowlist.length === 0 ? (
            <p className="title-cleanup-empty">No rules match "{filter}".</p>
          ) : (
            <ul className="title-cleanup-list">
              {sortedAllowlist.map((suffix) => (
                <CustomRow
                  key={suffix}
                  suffix={suffix}
                  affectedAlbums={customMatches(suffix)}
                  excludedIds={excludedAlbumIds}
                  onRemove={() => void removeSuffix(suffix)}
                  onEdit={(next) => void editSuffix(suffix, next)}
                  onExclude={(id) => void excludeAlbum(id)}
                  onUnexclude={(id) => void unexcludeAlbum(id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          <button
            className="title-cleanup-disclosure"
            onClick={() => setBuiltinsOpen((v) => !v)}
            aria-expanded={showBuiltins}
          >
            <ChevronRight size={13} className={`title-cleanup-disclosure-icon${showBuiltins ? " title-cleanup-disclosure-icon--open" : ""}`} />
            Built-in rules
            <span className="title-cleanup-disclosure-count">{BUILTIN_PATTERNS.length}</span>
          </button>
          {showBuiltins && (
            sortedBuiltins.length === 0 ? (
              <p className="title-cleanup-empty">No rules match "{filter}".</p>
            ) : (
              <ul className="title-cleanup-list">
                {sortedBuiltins.map((p) => (
                  <BuiltinRow
                    key={p.id}
                    label={p.label}
                    disabled={disabledIds.includes(p.id)}
                    affectedAlbums={builtinMatchesMap.get(p.id) ?? []}
                    excludedIds={excludedAlbumIds}
                    onToggle={() => void (disabledIds.includes(p.id) ? enableBuiltin(p.id) : disableBuiltin(p.id))}
                    onExclude={(id) => void excludeAlbum(id)}
                    onUnexclude={(id) => void unexcludeAlbum(id)}
                  />
                ))}
              </ul>
            )
          )}
        </section>
      </div>
    </div>
  );
}
