import { useState } from "react";
import { Download } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { installAndRestart, type DownloadProgress } from "../lib/updater";
import "./UpdatePrompt.css";

interface ChangelogSection {
  heading: string;
  items: string[];
}

function parseChangelog(body: string): ChangelogSection[] | null {
  const lines = body.trim().split("\n");
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      const name = (heading[1] ?? "").trim();
      // skip version header lines like "Canon v0.5.1"
      if (/^canon\s+v\d/i.test(name)) continue;
      current = { heading: name, items: [] };
      sections.push(current);
    } else if (current && line.match(/^[-*]\s+/)) {
      current.items.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }

  return sections.length > 0 ? sections : null;
}

const SECTION_COLORS: Record<string, string> = {
  added: "changelog-badge--added",
  fixed: "changelog-badge--fixed",
  changed: "changelog-badge--changed",
  removed: "changelog-badge--removed",
};

interface Props {
  update: Update;
  onDismiss: () => void;
}

export function UpdatePrompt({ update, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInstall() {
    setInstalling(true);
    setError(null);
    try {
      await installAndRestart(update, setProgress);
    } catch (e) {
      setInstalling(false);
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pct =
    progress && progress.total && progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : null;

  return (
    <div className="update-prompt-backdrop">
      <div className="update-prompt">
        <div className="update-prompt-header">
          <Download size={18} className="update-prompt-icon" />
          <span className="update-prompt-title">Canon {update.version} is ready</span>
        </div>

        {update.body && (() => {
          const sections = parseChangelog(update.body);
          return (
            <div className="update-prompt-changelog">
              <p className="update-prompt-changelog-label">What&apos;s new</p>
              {sections ? (
                <div className="update-prompt-changelog-sections">
                  {sections.map((section) => {
                    const colorClass = SECTION_COLORS[section.heading.toLowerCase()] ?? "changelog-badge--changed";
                    return (
                      <div key={section.heading} className="changelog-section">
                        <span className={`changelog-badge ${colorClass}`}>{section.heading}</span>
                        {section.items.length > 0 && (
                          <ul className="changelog-items">
                            {section.items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <pre className="update-prompt-changelog-body">{update.body.trim()}</pre>
              )}
            </div>
          );
        })()}

        {installing && (
          <div className="update-prompt-progress">
            <div className="update-prompt-progress-track">
              <div
                className="update-prompt-progress-fill"
                style={{ width: pct !== null ? `${pct}%` : "100%" }}
                data-indeterminate={pct === null}
              />
            </div>
            <span className="update-prompt-progress-label">
              {pct !== null ? `Downloading… ${pct}%` : "Downloading…"}
            </span>
          </div>
        )}

        {error && <p className="update-prompt-error">{error}</p>}

        <div className="update-prompt-actions">
          <button
            className="update-prompt-btn"
            onClick={onDismiss}
            disabled={installing}
          >
            Later
          </button>
          <button
            className="update-prompt-btn update-prompt-btn--primary"
            onClick={() => { void handleInstall(); }}
            disabled={installing}
          >
            {installing ? "Installing…" : "Install & Restart"}
          </button>
        </div>
      </div>
    </div>
  );
}
