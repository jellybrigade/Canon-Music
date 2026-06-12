import { useState } from "react";
import { Server, Tag, Play, Info, Activity } from "lucide-react";
import type { ServerWithCredential } from "../hooks/useServer";
import { ServerTab } from "./settings/ServerTab";
import { TagsTab } from "./settings/TagsTab";
import { PlaybackTab } from "./settings/PlaybackTab";
import { AboutTab } from "./settings/AboutTab";
import { DiagnosticsTab } from "./settings/DiagnosticsTab";
import "./SettingsView.css";

type SyncStatus = "idle" | "syncing" | "done" | "partial" | "error";
type TabId = "server" | "tags" | "playback" | "about" | "diagnostics";

interface Props {
  syncStatus: SyncStatus;
  syncError: string;
  lastSyncedAt: number | null;
  serverWithCredential: ServerWithCredential | undefined;
  onRemoveServer: () => void;
  hideTagBadge: boolean;
  setHideTagBadge: (v: boolean) => Promise<void>;
}

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "server",      label: "Server",      icon: <Server size={15} /> },
  { id: "tags",        label: "Tags",        icon: <Tag size={15} /> },
  { id: "playback",    label: "Playback",    icon: <Play size={15} /> },
  { id: "about",       label: "About",       icon: <Info size={15} /> },
  { id: "diagnostics", label: "Diagnostics", icon: <Activity size={15} /> },
];

export function SettingsView({ syncStatus, syncError, lastSyncedAt, serverWithCredential, onRemoveServer, hideTagBadge, setHideTagBadge }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("server");
  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;

  const tabContent = (tab: TabId, query: string) => {
    switch (tab) {
      case "server":
        return <ServerTab serverWithCredential={serverWithCredential} onRemoveServer={onRemoveServer} searchQuery={query} />;
      case "tags":
        return <TagsTab searchQuery={query} hideTagBadge={hideTagBadge} setHideTagBadge={setHideTagBadge} />;
      case "playback":
        return <PlaybackTab searchQuery={query} />;
      case "about":
        return <AboutTab searchQuery={query} />;
      case "diagnostics":
        return <DiagnosticsTab syncStatus={syncStatus} syncError={syncError} lastSyncedAt={lastSyncedAt} searchQuery={query} />;
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <input
            className="settings-search-input"
            type="search"
            placeholder="Search settings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {!isSearching && (
          <div className="settings-tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="settings-tab-content">
          {isSearching
            ? TABS.map((tab) => (
                <div key={tab.id}>{tabContent(tab.id, search)}</div>
              ))
            : tabContent(activeTab, "")}
        </div>
      </div>
    </div>
  );
}
