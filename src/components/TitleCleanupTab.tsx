import { useState } from "react";
import { useAlbumSuffixAllowlist } from "../hooks/useAlbumDisplayName";

export function TitleCleanupTab() {
  const [allowlist, addSuffix, removeSuffix] = useAlbumSuffixAllowlist();
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (allowlist.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setError("Already in the list.");
      return;
    }
    setError(null);
    void addSuffix(trimmed);
    setInputValue("");
  }

  return (
    <div className="title-cleanup-tab">
      <div className="title-cleanup-intro">
        <p>
          When "Hide album suffixes" is on, Canon strips known edition labels like{" "}
          <em>(Deluxe Edition)</em> from album titles. Add your own here — anything in
          parentheses that matches will be hidden across your whole library.
        </p>
      </div>

      <div className="title-cleanup-add-row">
        <input
          className="title-cleanup-input"
          type="text"
          placeholder="e.g. Special Edition"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button className="title-cleanup-add-btn" onClick={handleAdd} disabled={!inputValue.trim()}>
          Add
        </button>
      </div>
      {error && <div className="title-cleanup-error">{error}</div>}

      {allowlist.length === 0 ? (
        <div className="tags-empty">
          No custom suffixes yet. Albums with unrecognized parentheticals show a
          "Strip…" button in their detail view.
        </div>
      ) : (
        <ul className="title-cleanup-list">
          {allowlist.map((suffix) => (
            <li key={suffix} className="title-cleanup-row">
              <span className="title-cleanup-suffix">({suffix})</span>
              <button
                className="title-cleanup-remove"
                title="Remove"
                onClick={() => void removeSuffix(suffix)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
