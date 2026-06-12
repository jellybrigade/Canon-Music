import { useMemo, useState } from "react";
import {
  BUILTIN_PATTERNS,
  useAlbumSuffixAllowlist,
  useDisabledBuiltinIds,
  extractSuffix,
} from "../hooks/useAlbumDisplayName";
import { useAlbums } from "../hooks/useAlbums";

function AlbumList({ albums }: { albums: { name: string; artist: string | null }[] }) {
  return (
    <ul className="title-cleanup-album-list">
      {albums.map((a) => <li key={`${a.artist}-${a.name}`}>{a.artist != null ? `${a.artist} — ${a.name}` : a.name}</li>)}
    </ul>
  );
}

function CountBtn({ albums, open, onToggle }: { albums: { name: string; artist: string | null }[]; open: boolean; onToggle: () => void }) {
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
  onToggle,
}: {
  label: string;
  disabled: boolean;
  affectedAlbums: { name: string; artist: string | null }[];
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`title-cleanup-item${disabled ? " title-cleanup-item--disabled" : ""}`}>
      <div className="title-cleanup-row">
        <span className="title-cleanup-builtin-label">{label}</span>
        <CountBtn albums={affectedAlbums} open={open} onToggle={() => setOpen((v) => !v)} />
        <button
          className={`title-cleanup-toggle${disabled ? " title-cleanup-toggle--off" : ""}`}
          onClick={onToggle}
        >
          {disabled ? "Enable" : "Disable"}
        </button>
      </div>
      {open && <AlbumList albums={affectedAlbums} />}
    </li>
  );
}

function CustomRow({
  suffix,
  affectedAlbums,
  onRemove,
  onEdit,
}: {
  suffix: string;
  affectedAlbums: { name: string; artist: string | null }[];
  onRemove: () => void;
  onEdit: (next: string) => void;
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

  return (
    <li className="title-cleanup-item">
      <div className="title-cleanup-row">
        <span className="title-cleanup-suffix">({suffix})</span>
        <CountBtn albums={affectedAlbums} open={open} onToggle={() => setOpen((v) => !v)} />
        <button className="title-cleanup-action title-cleanup-action--muted" onClick={() => { setDraft(suffix); setEditing(true); }}>
          Edit
        </button>
        <button className="title-cleanup-action title-cleanup-action--remove" onClick={onRemove} title="Remove">
          ×
        </button>
      </div>
      {open && <AlbumList albums={affectedAlbums} />}
    </li>
  );
}

export function TitleCleanupTab() {
  const [allowlist, addSuffix, removeSuffix, editSuffix] = useAlbumSuffixAllowlist();
  const [disabledIds, disableBuiltin, enableBuiltin] = useDisabledBuiltinIds();
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const { data: allAlbums = [] } = useAlbums();

  const suffixAlbumMap = useMemo(() => {
    const map = new Map<string, { name: string; artist: string | null }[]>();
    for (const album of allAlbums) {
      const suffix = extractSuffix(album.name);
      if (!suffix) continue;
      const key = suffix.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ name: album.name, artist: album.artist });
    }
    return map;
  }, [allAlbums]);

  function customMatches(suffix: string): { name: string; artist: string | null }[] {
    return suffixAlbumMap.get(suffix.toLowerCase()) ?? [];
  }

  function builtinMatches(pattern: RegExp): { name: string; artist: string | null }[] {
    const results: { name: string; artist: string | null }[] = [];
    for (const [suffix, albums] of suffixAlbumMap) {
      if (pattern.test(suffix)) results.push(...albums);
    }
    return results;
  }

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
          ) : (
            <ul className="title-cleanup-list">
              {allowlist.map((suffix) => (
                <CustomRow
                  key={suffix}
                  suffix={suffix}
                  affectedAlbums={customMatches(suffix)}
                  onRemove={() => void removeSuffix(suffix)}
                  onEdit={(next) => void editSuffix(suffix, next)}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="title-cleanup-section-label">Built-in rules</div>
          <ul className="title-cleanup-list">
            {BUILTIN_PATTERNS.map((p) => (
              <BuiltinRow
                key={p.id}
                label={p.label}
                disabled={disabledIds.includes(p.id)}
                affectedAlbums={builtinMatches(p.pattern)}
                onToggle={() => void (disabledIds.includes(p.id) ? enableBuiltin(p.id) : disableBuiltin(p.id))}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
