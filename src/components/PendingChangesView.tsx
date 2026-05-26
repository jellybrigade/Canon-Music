import { useState } from "react";
import { X } from "lucide-react";
import { checkSidecarHealth } from "../lib/sidecar";
import { keychain } from "../keychain";
import { usePendingEdits } from "../hooks/usePendingEdits";
import type { PendingEditRow } from "../hooks/usePendingEdits";
import type { WriteDryRunResult } from "../lib/sidecar";
import type { ServerWithCredential } from "../hooks/useServer";

interface Props {
  serverWithCredential: ServerWithCredential | undefined;
}

interface DiffState {
  trackId: string;
  albumId: string;
  result: WriteDryRunResult;
  pendingRows: PendingEditRow[];
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: "Title",
    artist: "Artist",
    album_artist: "Album Artist",
    genre: "Genre",
    track_number: "Track #",
    disc_number: "Disc #",
    year: "Year",
    comment: "Comment",
  };
  return labels[field] ?? field;
}

export function PendingChangesView({ serverWithCredential }: Props) {
  const { data: rows, isLoading, deletePendingEdit, dryRunTrack, applyTrack } = usePendingEdits();

  const [reviewState, setReviewState] = useState<DiffState | null>(null);
  const [reviewError, setReviewError] = useState<string>("");
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string>("");
  const [sidecarTestState, setSidecarTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [sidecarTestError, setSidecarTestError] = useState<string>("");

  const server = serverWithCredential?.server;
  const hasSidecar = !!server?.sidecar_url;

  async function handleTestSidecar() {
    if (!server?.sidecar_url || !server.sidecar_secret_key) return;
    setSidecarTestState("testing");
    setSidecarTestError("");
    try {
      const secret = await keychain.get(server.sidecar_secret_key, "secret");
      await checkSidecarHealth(server.sidecar_url, secret);
      setSidecarTestState("ok");
    } catch (err) {
      setSidecarTestState("error");
      setSidecarTestError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReviewApply(trackId: string, albumId: string, trackRows: PendingEditRow[]) {
    if (!serverWithCredential) return;
    setReviewLoading(trackId);
    setReviewError("");
    try {
      const result = await dryRunTrack(trackId, serverWithCredential);
      setReviewState({ trackId, albumId, result, pendingRows: trackRows });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewLoading(null);
    }
  }

  async function handleConfirmWrite() {
    if (!reviewState || !serverWithCredential) return;
    setApplyError("");
    try {
      await applyTrack.mutateAsync({
        trackId: reviewState.trackId,
        albumId: reviewState.albumId,
        serverWithCredential,
      });
      setReviewState(null);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    }
  }

  if (isLoading) {
    return (
      <main className="content-main">
        <header className="library-header"><h1>Pending Changes</h1></header>
        <p className="empty-state">Loading…</p>
      </main>
    );
  }

  // Group rows by track_id
  const groups = new Map<string, PendingEditRow[]>();
  for (const row of rows ?? []) {
    const existing = groups.get(row.track_id) ?? [];
    existing.push(row);
    groups.set(row.track_id, existing);
  }

  return (
    <main className="content-main">
      <header className="library-header">
        <h1>Pending Changes</h1>
        {hasSidecar && (
          <button
            className="rescan-btn"
            onClick={() => void handleTestSidecar()}
            disabled={sidecarTestState === "testing"}
          >
            {sidecarTestState === "testing" ? "Testing…" : "Test sidecar"}
          </button>
        )}
        {sidecarTestState === "ok" && <span className="sync-status">Sidecar reachable</span>}
        {sidecarTestState === "error" && (
          <span className="sync-status sync-status--error" title={sidecarTestError}>
            Sidecar unreachable
          </span>
        )}
      </header>

      {groups.size === 0 ? (
        <p className="empty-state">No pending changes. Right-click a track in Album Detail to edit tags.</p>
      ) : (
        <div className="pending-changes-list">
          {reviewError && <p className="pending-error">{reviewError}</p>}
          {Array.from(groups.entries()).map(([trackId, trackRows]) => {
            const first = trackRows[0];
            if (!first) return null;
            const canApply = hasSidecar && !!first.file_path;
            return (
              <div key={trackId} className="pending-track-card">
                <div className="pending-track-header">
                  <span className="pending-track-title">{first.track_title}</span>
                  <span className="pending-track-meta">{first.track_artist} — {first.album_name}</span>
                  {!first.file_path && (
                    <span className="pending-track-warning">No file path — rescan required</span>
                  )}
                  {!hasSidecar && (
                    <span className="pending-track-warning">Sidecar not configured</span>
                  )}
                </div>
                <table className="pending-field-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Current (DB)</th>
                      <th>New value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {trackRows.map((row) => (
                      <tr key={row.id}>
                        <td className="pending-field-name">{fieldLabel(row.field)}</td>
                        <td className="pending-field-old">{row.old_value ?? <em>empty</em>}</td>
                        <td className="pending-field-new">{row.new_value ?? <em>empty</em>}</td>
                        <td>
                          <button
                            className="pending-reject-btn"
                            onClick={() => void deletePendingEdit.mutateAsync(row.id)}
                            title="Reject this field change"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pending-actions">
                  <button
                    className="pending-review-btn"
                    onClick={() => void handleReviewApply(trackId, first.album_id, trackRows)}
                    disabled={!canApply || reviewLoading === trackId}
                    title={!canApply ? (!hasSidecar ? "Configure sidecar in server settings" : "Rescan required") : undefined}
                  >
                    {reviewLoading === trackId ? "Loading diff…" : "Review & Apply"}
                  </button>
                  <button
                    className="pending-reject-all-btn"
                    onClick={async () => {
                      for (const row of trackRows) {
                        await deletePendingEdit.mutateAsync(row.id);
                      }
                    }}
                  >
                    Reject All
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reviewState && (
        <div className="diff-overlay" onClick={() => { if (!applyTrack.isPending) setReviewState(null); }}>
          <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="diff-modal-title">Confirm tag write</h2>
            <p className="diff-modal-track">
              {reviewState.pendingRows[0]?.track_title} — {reviewState.pendingRows[0]?.track_artist}
            </p>
            <p className="diff-modal-path">{reviewState.result.resolved_path}</p>
            {reviewState.result.diff.length === 0 ? (
              <p className="diff-modal-nodiff">No changes detected in file (tags already match).</p>
            ) : (
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>In file (current)</th>
                    <th>Will write</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewState.result.diff.map((d) => {
                    const dbRow = reviewState.pendingRows.find((r) => r.field === d.field);
                    const drifted = dbRow && dbRow.old_value !== d.old_value;
                    return (
                      <tr key={d.field} className={drifted ? "diff-row--drifted" : ""}>
                        <td>{fieldLabel(d.field)}</td>
                        <td className="diff-old">
                          {d.old_value ?? <em>empty</em>}
                          {drifted && <span className="diff-drift-badge" title="File differs from what was shown when you queued this edit"> ⚠</span>}
                        </td>
                        <td className="diff-new">{d.new_value ?? <em>empty</em>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {applyError && <p className="diff-error">{applyError}</p>}
            <div className="diff-modal-actions">
              <button
                className="diff-confirm-btn"
                onClick={() => void handleConfirmWrite()}
                disabled={applyTrack.isPending || reviewState.result.diff.length === 0}
              >
                {applyTrack.isPending ? "Writing…" : "Confirm Write"}
              </button>
              <button
                className="diff-cancel-btn"
                onClick={() => setReviewState(null)}
                disabled={applyTrack.isPending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
