import { useSetting } from "../hooks/useSetting";
import "./SettingsView.css";

export function SettingsView() {
  const [lastfmKey, setLastfmKey] = useSetting("lastfm.api_key", "");
  const [stalenessDays, setStalenessDays] = useSetting("tags.staleness_days", "90");
  const [pullMode, setPullMode] = useSetting("tags.pull_mode_default", "review");

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

      <section className="settings-section">
        <h3 className="settings-section-title">Last.fm</h3>
        <label className="settings-field">
          <span>API Key</span>
          <input
            type="text"
            placeholder="Paste your Last.fm API key"
            value={lastfmKey}
            onChange={(e) => void setLastfmKey(e.target.value)}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Tags</h3>
        <label className="settings-field">
          <span>Staleness threshold (days)</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={stalenessDays}
            onChange={(e) => void setStalenessDays(e.target.value)}
            className="settings-staleness-input"
          />
        </label>
        <div className="settings-field">
          <span>Default pull mode</span>
          <div className="settings-radio-group">
            <label>
              <input
                type="radio"
                name="pull_mode"
                value="review"
                checked={pullMode === "review"}
                onChange={() => void setPullMode("review")}
              />
              Review in Inbox
            </label>
            <label>
              <input
                type="radio"
                name="pull_mode"
                value="silent"
                checked={pullMode === "silent"}
                onChange={() => void setPullMode("silent")}
              />
              Silent
            </label>
          </div>
        </div>
      </section>


    </div>
  );
}
