import { useState } from "react";
import { Check, SkipForward, X, Edit3, AlertTriangle } from "lucide-react";
import { useTagsStore } from "../../store/tags";
import { useAcceptInboxItem } from "../../hooks/useTagPull";
import { CanonCombobox } from "./CanonCombobox";
import type { InboxItem, InboxTagRow } from "../../store/tags";
import type { TreeNode } from "../../lib/canonicalize";

interface Props {
  item: InboxItem;
  coverArtSrc?: string;
}

const MATCH_LABEL: Record<string, string> = {
  exact: "exact",
  fuzzy: "fuzzy",
  mapping: "saved",
  none: "off-tree",
};

const MATCH_CLASS: Record<string, string> = {
  exact: "inbox-badge--exact",
  fuzzy: "inbox-badge--fuzzy",
  mapping: "inbox-badge--saved",
  none: "inbox-badge--off-tree",
};

export function InboxCard({ item, coverArtSrc }: Props) {
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const updateTagRow = useTagsStore((s) => s.updateTagRow);
  const removeInboxItem = useTagsStore((s) => s.removeInboxItem);
  const acceptMutation = useAcceptInboxItem();

  const genreTags = item.tags.filter((t) => t.kind === "genre");
  const moodTags = item.tags.filter((t) => t.kind === "mood");

  async function handleAccept() {
    setSaving(true);
    try {
      await acceptMutation.mutateAsync(item);
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    removeInboxItem(item.albumId);
  }

  function handleToggleKept(tag: InboxTagRow) {
    updateTagRow(item.albumId, tag.rawValue, tag.kind, { kept: !tag.kept });
  }

  function handleCanonOverride(tag: InboxTagRow, _value: string, node: TreeNode | null) {
    updateTagRow(item.albumId, tag.rawValue, tag.kind, {
      overrideCanonicalId: node?.id,
      kept: true,
    });
    setEditingRow(null);
  }

  function renderTagSection(tags: InboxTagRow[], label: string) {
    if (tags.length === 0) return null;
    return (
      <div className="inbox-tag-section">
        <span className="inbox-tag-section-label">{label}</span>
        <div className="inbox-tag-rows">
          {tags.map((tag) => {
            const displayName = tag.overrideCanonicalId
              ? "(custom)"
              : tag.findResult.node?.name ?? tag.rawValue;
            const isEditing = editingRow === `${tag.rawValue}:${tag.kind}`;
            return (
              <div key={`${tag.rawValue}:${tag.kind}`} className={`inbox-tag-row${tag.kept ? "" : " inbox-tag-row--dropped"}`}>
                <button
                  className={`inbox-row-toggle${tag.kept ? " inbox-row-toggle--kept" : ""}`}
                  onClick={() => handleToggleKept(tag)}
                  title={tag.kept ? "Drop this tag" : "Keep this tag"}
                >
                  {tag.kept ? <Check size={11} /> : <X size={11} />}
                </button>
                <div className="inbox-row-content">
                  <span className="inbox-raw">{tag.rawValue}</span>
                  <span className="inbox-arrow">→</span>
                  {isEditing ? (
                    <CanonCombobox
                      value={tag.findResult.node?.name ?? ""}
                      kind={tag.kind}
                      onChange={(val, node) => handleCanonOverride(tag, val, node)}
                      className="inbox-combobox"
                    />
                  ) : (
                    <span className={`inbox-canonical${!tag.findResult.node ? " inbox-canonical--off-tree" : ""}`}>
                      {tag.findResult.node ? displayName : tag.rawValue}
                    </span>
                  )}
                  <span className={`inbox-badge ${MATCH_CLASS[tag.findResult.matchType] ?? ""}`}>
                    {tag.findResult.matchType === "none" && <AlertTriangle size={10} />}
                    {MATCH_LABEL[tag.findResult.matchType]}
                  </span>
                </div>
                <button
                  className="inbox-edit-btn"
                  title="Edit canonical"
                  onClick={() => setEditingRow(isEditing ? null : `${tag.rawValue}:${tag.kind}`)}
                >
                  <Edit3 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const keptCount = item.tags.filter((t) => t.kept).length;

  return (
    <div className="inbox-card">
      <div className="inbox-card-header">
        {coverArtSrc ? (
          <img className="inbox-art" src={coverArtSrc} alt={item.albumName} />
        ) : (
          <div className="inbox-art inbox-art--placeholder" />
        )}
        <div className="inbox-card-meta">
          <span className="inbox-album-name">{item.albumName}</span>
          <span className="inbox-album-artist">{item.albumArtist}</span>
          <span className="inbox-source-badge">{item.source === "lastfm" ? "Last.fm" : "Canonize"}</span>
        </div>
        <div className="inbox-card-actions">
          <button className="inbox-btn inbox-btn--skip" onClick={handleSkip} title="Skip (S)">
            <SkipForward size={14} />
          </button>
          <button
            className="inbox-btn inbox-btn--accept"
            onClick={() => void handleAccept()}
            disabled={saving || keptCount === 0}
            title={`Accept ${keptCount} tag${keptCount !== 1 ? "s" : ""} (A)`}
          >
            <Check size={14} />
            {saving ? "Saving…" : `Accept ${keptCount}`}
          </button>
        </div>
      </div>

      <div className="inbox-card-body">
        {renderTagSection(genreTags, "Genres")}
        {renderTagSection(moodTags, "Moods")}
        {item.tags.length === 0 && (
          <span className="inbox-empty">No tags found</span>
        )}
      </div>

      {acceptMutation.isError && (
        <div className="inbox-error">
          {acceptMutation.error instanceof Error ? acceptMutation.error.message : "Failed to save"}
        </div>
      )}
    </div>
  );
}

export function InboxCardStack() {
  const inboxItems = useTagsStore((s) => s.inboxItems);

  if (inboxItems.length === 0) {
    return (
      <div className="inbox-empty-state">
        <p>No pending reviews.</p>
        <p className="inbox-empty-hint">Pull tags from Last.fm or run "Canonize tags" on an album to fill the Inbox.</p>
      </div>
    );
  }

  return (
    <div className="inbox-stack">
      <div className="inbox-stack-header">
        <span>{inboxItems.length} album{inboxItems.length !== 1 ? "s" : ""} to review</span>
      </div>
      <div className="inbox-cards">
        {inboxItems.map((item) => (
          <InboxCard key={item.albumId} item={item} />
        ))}
      </div>
    </div>
  );
}
