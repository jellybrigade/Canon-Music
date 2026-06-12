import { useState } from "react";
import {
  BUILTIN_PATTERNS,
  useAlbumSuffixAllowlist,
  useDisabledBuiltinIds,
} from "../hooks/useAlbumDisplayName";

function CustomRow({
  suffix,
  onRemove,
  onEdit,
}: {
  suffix: string;
  onRemove: () => void;
  onEdit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(suffix);

  function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== suffix) onEdit(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="title-cleanup-row">
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
      </li>
    );
  }

  return (
    <li className="title-cleanup-row">
      <span className="title-cleanup-suffix">({suffix})</span>
      <button className="title-cleanup-action title-cleanup-action--muted" onClick={() => { setDraft(suffix); setEditing(true); }}>
        Edit
      </button>
      <button className="title-cleanup-action title-cleanup-action--remove" onClick={onRemove} title="Remove">
        ×
      </button>
    </li>
  );
}

export function TitleCleanupTab() {
  const [allowlist, addSuffix, removeSuffix, editSuffix] = useAlbumSuffixAllowlist();
  const [disabledIds, disableBuiltin, enableBuiltin] = useDisabledBuiltinIds();
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

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
      <p className="title-cleanup-intro">
        When "Hide album suffixes" is on, Canon strips known edition labels like{" "}
        <em>(Deluxe Edition)</em> from album titles. Turn off any built-in rule or add
        your own.
      </p>

      {/* ── Built-in rules ── */}
      <section>
        <div className="title-cleanup-section-label">Built-in rules</div>
        <ul className="title-cleanup-list">
          {BUILTIN_PATTERNS.map((p) => {
            const disabled = disabledIds.includes(p.id);
            return (
              <li key={p.id} className={`title-cleanup-row${disabled ? " title-cleanup-row--disabled" : ""}`}>
                <span className="title-cleanup-builtin-label">{p.label}</span>
                <button
                  className={`title-cleanup-toggle${disabled ? " title-cleanup-toggle--off" : ""}`}
                  onClick={() => void (disabled ? enableBuiltin(p.id) : disableBuiltin(p.id))}
                  title={disabled ? "Enable" : "Disable"}
                >
                  {disabled ? "Enable" : "Disable"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Custom rules ── */}
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
          <button
            className="title-cleanup-add-btn"
            onClick={handleAdd}
            disabled={!inputValue.trim()}
          >
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
                onRemove={() => void removeSuffix(suffix)}
                onEdit={(next) => void editSuffix(suffix, next)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
