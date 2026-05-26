import { useState } from "react";
import { Mail, BookOpen, Activity } from "lucide-react";
import { InboxCardStack } from "./tags/InboxCard";
import { VocabularyPanel } from "./tags/VocabularyPanel";
import { HealthPanel } from "./tags/HealthPanel";
import { useTagsStore } from "../store/tags";

type Tab = "inbox" | "vocabulary" | "health";

interface Props {
  onNavigateSettings: () => void;
}

export function TagsView({ onNavigateSettings }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const inboxCount = useTagsStore((s) => s.inboxItems.length);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "inbox", label: "Inbox", icon: <Mail size={14} /> },
    { id: "vocabulary", label: "Vocabulary", icon: <BookOpen size={14} /> },
    { id: "health", label: "Health", icon: <Activity size={14} /> },
  ];

  return (
    <div className="tags-view">
      <div className="tags-view-header">
        <h1>Tags</h1>
        <div className="tags-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tags-tab${activeTab === tab.id ? " tags-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "inbox" && inboxCount > 0 && (
                <span className="tags-tab-badge">{inboxCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="tags-view-body">
        {activeTab === "inbox" && <InboxCardStack />}
        {activeTab === "vocabulary" && <VocabularyPanel />}
        {activeTab === "health" && <HealthPanel onNavigateSettings={onNavigateSettings} />}
      </div>
    </div>
  );
}
