import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTagIssues } from "../hooks/useTagIssues";
import type { TagIssueRow } from "../hooks/useTagIssues";

const ISSUE_LABELS: Record<string, string> = {
  missing_genre: "Missing genre",
  missing_artist: "Missing artist",
  suspicious_genre: "Suspicious genre",
  inconsistent_album_artist: "Inconsistent album artist",
  duplicate_album: "Duplicate album",
};

function groupByType(rows: TagIssueRow[]): Map<string, TagIssueRow[]> {
  const map = new Map<string, TagIssueRow[]>();
  for (const row of rows) {
    const list = map.get(row.issue_type) ?? [];
    list.push(row);
    map.set(row.issue_type, list);
  }
  return map;
}

interface IssueGroupProps {
  type: string;
  rows: TagIssueRow[];
  onDismiss: (id: number) => void;
  onNavigate: (albumId: string) => void;
}

function IssueGroup({ type, rows, onDismiss, onNavigate }: IssueGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const label = ISSUE_LABELS[type] ?? type;

  return (
    <div className="issues-group">
      <button className="issues-group-header" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <AlertTriangle size={14} className="issues-group-icon" />
        <span className="issues-group-label">{label}</span>
        <span className="issues-group-count">{rows.length}</span>
      </button>

      {expanded && (
        <div className="issues-group-rows">
          {rows.map((row) => (
            <div key={row.id} className="issues-row">
              <div className="issues-row-info">
                <span className="issues-row-title">{row.track_title}</span>
                <span className="issues-row-meta">
                  {[row.track_artist, row.album_name].filter(Boolean).join(" · ")}
                </span>
                {row.details && (
                  <span className="issues-row-detail">{row.details}</span>
                )}
              </div>
              <div className="issues-row-actions">
                <button
                  className="issues-btn issues-btn--navigate"
                  onClick={() => onNavigate(row.album_id)}
                  title="Open album"
                >
                  Open
                </button>
                <button
                  className="issues-btn issues-btn--dismiss"
                  onClick={() => onDismiss(row.id)}
                  title="Dismiss"
                >
                  <CheckCircle2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  onNavigateAlbum: (albumId: string) => void;
}

export function TagIssuesView({ onNavigateAlbum }: Props) {
  const { data, isLoading, dismissIssue, dismissAll, issueCount } = useTagIssues();

  if (isLoading) return <main className="content-main"><p className="empty-state">Loading…</p></main>;

  const grouped = groupByType(data);

  return (
    <main className="content-main">
      <div className="issues-view">
        <div className="issues-header">
          <h1>Tag Issues</h1>
          {issueCount > 0 && (
            <span className="issues-count-badge">{issueCount}</span>
          )}
          {issueCount > 0 && (
            <button
              className="issues-dismiss-all-btn"
              onClick={() => void dismissAll.mutateAsync()}
            >
              Dismiss All
            </button>
          )}
        </div>

        {issueCount === 0 ? (
          <div className="issues-empty">
            <CheckCircle2 size={32} className="issues-empty-icon" />
            <p>No issues detected. Run a rescan to check for problems.</p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([type, rows]) => (
            <IssueGroup
              key={type}
              type={type}
              rows={rows}
              onDismiss={(id) => void dismissIssue.mutateAsync(id)}
              onNavigate={onNavigateAlbum}
            />
          ))
        )}
      </div>
    </main>
  );
}
