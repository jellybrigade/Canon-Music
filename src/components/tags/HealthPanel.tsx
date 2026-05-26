import { useState } from "react";
import { Activity, AlertTriangle, Clock, RefreshCw, Settings } from "lucide-react";
import { useTagStats, useStaleAlbums } from "../../hooks/useTrackTags";
import { useTagPull } from "../../hooks/useTagPull";
import { useSetting } from "../../hooks/useSetting";
import type { PullMode } from "../../hooks/useTagPull";
import type { AlbumRow } from "../../hooks/useAlbums";

interface Props {
  onNavigateSettings: () => void;
}

function PullModeModal({ onConfirm, onCancel }: { onConfirm: (mode: PullMode) => void; onCancel: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <div className="pull-mode-backdrop" onClick={onCancel}>
      <div className="pull-mode-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Canonize how?</h3>
        <p>Apply suggestions silently or queue them for review in your Inbox?</p>
        <div className="pull-mode-actions">
          <button className="pull-mode-btn" onClick={() => onConfirm("silent")}>Silent</button>
          <button className="pull-mode-btn pull-mode-btn--primary" onClick={() => onConfirm("review")}>Review in Inbox</button>
        </div>
        <label className="pull-mode-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for this session
        </label>
      </div>
    </div>
  );
}

export function HealthPanel({ onNavigateSettings }: Props) {
  const { data: stats } = useTagStats();
  const [staleDays] = useSetting("tags.staleness_days", "90");
  const staleNum = parseInt(staleDays, 10) || 90;
  const { data: staleAlbums } = useStaleAlbums(staleNum);
  const { pullForAlbum } = useTagPull();
  const [showModeModal, setShowModeModal] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");

  async function runBatchPull(mode: PullMode) {
    if (!staleAlbums || staleAlbums.length === 0) return;
    setPulling(true);
    setPullMsg(`Pulling ${staleAlbums.length} albums…`);
    let failed = 0;
    for (const album of staleAlbums) {
      try {
        await pullForAlbum.mutateAsync({ album: album as unknown as AlbumRow, mode });
      } catch {
        failed++;
      }
    }
    setPulling(false);
    setPullMsg(failed > 0 ? `Done (${failed} failed)` : "Done");
    setTimeout(() => setPullMsg(""), 3000);
  }

  const tiles = [
    {
      icon: <Activity size={18} />,
      label: "Canonical",
      value: `${stats?.pctCanonical ?? 0}%`,
      sub: `${stats?.canonical ?? 0} / ${stats?.total ?? 0} tags`,
    },
    {
      icon: <AlertTriangle size={18} />,
      label: "Off-tree",
      value: String(stats?.offTree ?? 0),
      sub: "tags not in RYM hierarchy",
    },
    {
      icon: <Clock size={18} />,
      label: "Stale albums",
      value: String(staleAlbums?.length ?? 0),
      sub: `not refreshed in ${staleNum} days`,
    },
  ];

  return (
    <div className="health-panel">
      {showModeModal && (
        <PullModeModal
          onConfirm={(mode) => { setShowModeModal(false); void runBatchPull(mode); }}
          onCancel={() => setShowModeModal(false)}
        />
      )}

      <div className="health-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="health-tile">
            <div className="health-tile-icon">{t.icon}</div>
            <div className="health-tile-value">{t.value}</div>
            <div className="health-tile-label">{t.label}</div>
            <div className="health-tile-sub">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="health-actions">
        <button
          className="health-action-btn"
          disabled={pulling || (staleAlbums?.length ?? 0) === 0}
          onClick={() => setShowModeModal(true)}
        >
          <RefreshCw size={14} className={pulling ? "health-spin" : ""} />
          {pulling ? pullMsg : `Pull ${staleAlbums?.length ?? 0} stale albums from Last.fm`}
        </button>
        {pullMsg && !pulling && <span className="health-msg">{pullMsg}</span>}
      </div>

      <div className="health-settings-link">
        <button className="health-settings-btn" onClick={onNavigateSettings}>
          <Settings size={13} /> Configure staleness threshold in Settings
        </button>
      </div>
    </div>
  );
}
