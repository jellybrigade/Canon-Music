import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { GitMerge, X } from "lucide-react";
import { useArtists } from "../hooks/useArtists";
import { useSetArtistAlias } from "../hooks/useArtistAliases";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import "./ArtistMergeModal.css";

interface Props {
  aliasArtistName: string;
  onClose: () => void;
}

export function ArtistMergeModal({ aliasArtistName, onClose }: Props) {
  const { data: allArtists = [] } = useArtists();
  const setAlias = useSetArtistAlias();
  const dismiss = useOverlayDismiss(onClose);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const q = query.toLowerCase().trim();
    return allArtists
      .filter((a) => a.name !== aliasArtistName)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [allArtists, aliasArtistName, query]);

  async function handleConfirm() {
    if (!selected) return;
    await setAlias.mutateAsync({ aliasName: aliasArtistName, canonicalName: selected });
    onClose();
  }

  return createPortal(
    <div className="merge-overlay" {...dismiss}>
      <div className="merge-dialog">
        <div className="merge-header">
          <h2 className="merge-title">
            <GitMerge size={16} />
            Merge Artist
          </h2>
          <button className="merge-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="merge-body">
          <p className="merge-description">
            Treat <strong>{aliasArtistName}</strong> as an alias of another artist.
            Their albums will appear under the canonical artist.
          </p>

          <label className="merge-field">
            <span className="merge-field-label">Canonical artist</span>
            <input
              className="merge-search"
              type="text"
              placeholder="Search artists…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              autoFocus
            />
          </label>

          <div className="merge-list">
            {candidates.map((a) => (
              <button
                key={a.name}
                className={`merge-candidate${selected === a.name ? " merge-candidate--selected" : ""}`}
                onClick={() => setSelected(a.name)}
              >
                {a.name}
                <span className="merge-candidate-meta">
                  {a.album_count} {a.album_count === 1 ? "album" : "albums"}
                </span>
              </button>
            ))}
            {candidates.length === 0 && (
              <p className="merge-empty">No artists match.</p>
            )}
          </div>
        </div>

        <div className="merge-footer">
          <button className="merge-btn" onClick={onClose}>Cancel</button>
          <button
            className="merge-btn merge-btn--primary"
            onClick={() => void handleConfirm()}
            disabled={!selected || setAlias.isPending}
          >
            {setAlias.isPending ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
