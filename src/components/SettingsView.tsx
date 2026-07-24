import { useState } from "react";
import { Server, Tag, Play, ChevronRight, Activity } from "lucide-react";
import type { ServerWithCredential } from "../hooks/useServer";
import type { Server as ServerRow } from "../types/server";
import { ServerTab } from "./settings/ServerTab";
import { TagsTab } from "./settings/TagsTab";
import { PlaybackTab } from "./settings/PlaybackTab";
import { AboutTab } from "./settings/AboutTab";
import { DiagnosticsTab } from "./settings/DiagnosticsTab";
import "./SettingsView.css";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";
type NavId = "server" | "metadata" | "playback" | "advanced";

interface Props {
  server: ServerRow | undefined;
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncedAt: number | null;
  serverWithCredential: ServerWithCredential | undefined;
  onRemoveServer: () => void;
  hideTagBadge: boolean;
  setHideTagBadge: (v: boolean) => Promise<void>;
}

const NAV_ITEMS: { id: NavId; label: string; icon: React.ReactNode }[] = [
  { id: "server",   label: "Server",   icon: <Server size={15} /> },
  { id: "metadata", label: "Metadata", icon: <Tag size={15} /> },
  { id: "playback", label: "Playback", icon: <Play size={15} /> },
  { id: "advanced", label: "Advanced", icon: <Activity size={15} /> },
];

export function SettingsView({ server, syncStatus, syncError, lastSyncedAt, serverWithCredential, onRemoveServer, hideTagBadge, setHideTagBadge }: Props) {
  const [activeNav, setActiveNav] = useState<NavId>("server");
  const [search, setSearch] = useState("");

  const panelContent = (nav: NavId, query: string) => {
    switch (nav) {
      case "server":
        return <ServerTab server={server} serverWithCredential={serverWithCredential} onRemoveServer={onRemoveServer} searchQuery={query} />;
      case "metadata":
        return <TagsTab searchQuery={query} hideTagBadge={hideTagBadge} setHideTagBadge={setHideTagBadge} />;
      case "playback":
        return <PlaybackTab searchQuery={query} />;
      case "advanced":
        return (
          <>
            <AboutTab searchQuery={query} />
            <div className="settings-advanced-divider" />
            <DiagnosticsTab syncStatus={syncStatus} syncError={syncError} lastSyncedAt={lastSyncedAt} searchQuery={query} serverWithCredential={serverWithCredential} />
          </>
        );
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`settings-nav-item${activeNav === item.id ? " settings-nav-item--active" : ""}`}
              onClick={() => setActiveNav(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {activeNav === item.id && <ChevronRight size={12} className="settings-nav-chevron" />}
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          <div className="settings-panel-header">
            <h2 className="settings-panel-title">{NAV_ITEMS.find((n) => n.id === activeNav)?.label}</h2>
            <input
              className="settings-search-input"
              type="search"
              placeholder="Search settings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="settings-panel-content">
            {search.trim()
              ? NAV_ITEMS.map((item) => <div key={item.id}>{panelContent(item.id, search)}</div>)
              : panelContent(activeNav, search)}
          </div>
        </div>
      </div>
    </div>
  );
}
