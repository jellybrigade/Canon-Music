import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { installAndRestart, type DownloadProgress } from "../lib/updater";
import "./UpdatePrompt.css";

interface ChangelogSection {
  heading: string;
  items: string[];
}

interface VersionChangelog {
  version: string;
  sections: ChangelogSection[] | null;
  raw: string;
}

function parseChangelog(body: string): ChangelogSection[] | null {
  const lines = body.trim().split("\n");
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      const name = (heading[1] ?? "").trim();
      if (/^canon\s+v\d/i.test(name)) continue;
      current = { heading: name, items: [] };
      sections.push(current);
    } else if (current && line.match(/^[-*]\s+/)) {
      current.items.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }

  return sections.length > 0 ? sections : null;
}

function semverCompare(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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
  const [changelogs, setChangelogs] = useState<VersionChangelog[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const currentVersion = await getVersion();
        const resp = await fetch(
          "https://api.github.com/repos/jellybrigade/Canon-Music/releases?per_page=50"
        );
        if (!resp.ok) throw new Error("fetch failed");
        const releases = (await resp.json()) as { tag_name: string; body: string }[];

        const filtered = releases
          .filter((r) => {
            const ver = r.tag_name.replace(/^v/, "");
            return (
              semverCompare(ver, currentVersion) > 0 &&
              semverCompare(ver, update.version) <= 0
            );
          })
          .sort((a, b) => semverCompare(b.tag_name, a.tag_name));

        if (filtered.length > 0) {
          setChangelogs(
            filtered.map((r) => ({
              version: r.tag_name.replace(/^v/, ""),
              sections: parseChangelog(r.body ?? ""),
              raw: r.body ?? "",
            }))
          );
          return;
        }
      } catch {
        // fall through to default
      }

      if (update.body) {
        setChangelogs([
          {
            version: update.version,
            sections: parseChangelog(update.body),
            raw: update.body,
          },
        ]);
      }
    })();
  }, [update.version, update.body]);

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

  const multiVersion = changelogs && changelogs.length > 1;

  return (
    <div className="update-prompt-backdrop">
      <div className="update-prompt">
        <div className="update-prompt-header">
          <Download size={18} className="update-prompt-icon" />
          <span className="update-prompt-title">Canon {update.version} is ready</span>
        </div>

        {changelogs && changelogs.length > 0 && (
          <div className="update-prompt-changelog">
            <p className="update-prompt-changelog-label">
              {multiVersion ? `What's new — ${changelogs.length} versions` : "What's new"}
            </p>
            <div className="update-prompt-changelog-sections">
              {changelogs.map((cl) => (
                <div key={cl.version} className="changelog-release">
                  {multiVersion && (
                    <p className="changelog-version-label">v{cl.version}</p>
                  )}
                  {cl.sections ? (
                    cl.sections.map((section) => {
                      const colorClass =
                        SECTION_COLORS[section.heading.toLowerCase()] ??
                        "changelog-badge--changed";
                      return (
                        <div key={section.heading} className="changelog-section">
                          <span className={`changelog-badge ${colorClass}`}>
                            {section.heading}
                          </span>
                          {section.items.length > 0 && (
                            <ul className="changelog-items">
                              {section.items.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <pre className="update-prompt-changelog-body">{cl.raw.trim()}</pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
