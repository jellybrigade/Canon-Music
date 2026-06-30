import { memo, useEffect, useState } from "react";
import { Calendar, Info } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BandsintownEvent } from "../lib/bandsintown";
import "./TourCard.css";

interface Props {
  artistName: string;
  enabled: boolean;
  loading: boolean;
  events: BandsintownEvent[];
  onEnable: () => void;
}

function isoToParts(iso: string): { month: string; day: string; weekday: string; time: string } | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return {
      month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
      day: String(d.getDate()),
      weekday: d.toLocaleString("en-US", { weekday: "short" }),
      time: d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
    };
  } catch {
    return null;
  }
}

const TOUR_LIMIT = 5;

export const TourCard = memo(function TourCard({ artistName, enabled, loading, events, onEnable }: Props) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [artistName]);

  const visible = showAll ? events : events.slice(0, TOUR_LIMIT);
  const hidden = Math.max(0, events.length - visible.length);

  return (
    <div className="tour-card">
      <div className="tour-card-header">
        <Calendar size={12} className="tour-card-icon" />
        <span className="tour-card-title">On tour</span>
      </div>

      {!enabled ? (
        <div className="tour-card-prompt">
          <div className="tour-card-prompt-row">
            <span className="tour-card-prompt-text">See upcoming tour dates?</span>
            <span
              className="tour-card-prompt-info"
              title="When enabled, the current artist's name is sent to the Bandsintown API to fetch tour dates. No personal account information leaves your device."
              tabIndex={0}
            >
              <Info size={12} />
            </span>
          </div>
          <p className="tour-card-prompt-desc">Optional. Loads concerts for the current artist via Bandsintown.</p>
          <button className="tour-card-enable-btn" onClick={onEnable}>Enable</button>
        </div>
      ) : (
        <>
          {loading && events.length === 0 && (
            <p className="tour-card-empty">Loading…</p>
          )}
          {!loading && events.length === 0 && (
            <p className="tour-card-empty">No upcoming shows</p>
          )}
          {visible.length > 0 && (
            <ul className="tour-card-list">
              {visible.map((ev, idx) => {
                const parts = isoToParts(ev.datetime);
                const place = [ev.venueCity, ev.venueRegion, ev.venueCountry].filter(Boolean).join(", ");
                return (
                  <li
                    key={`${ev.datetime}-${ev.venueName}-${idx}`}
                    className={`tour-card-item${ev.url ? " tour-card-item--link" : ""}`}
                    onClick={() => ev.url && openUrl(ev.url).catch(() => {})}
                    role={ev.url ? "button" : undefined}
                    tabIndex={ev.url ? 0 : undefined}
                    onKeyDown={ev.url ? (e) => { if (e.key === "Enter") openUrl(ev.url).catch(() => {}); } : undefined}
                  >
                    {parts && (
                      <div className="tour-card-date">
                        <div className="tour-card-date-month">{parts.month}</div>
                        <div className="tour-card-date-day">{parts.day}</div>
                      </div>
                    )}
                    <div className="tour-card-meta">
                      <div className="tour-card-venue">{ev.venueName || place}</div>
                      <div className="tour-card-place">
                        {parts && <span className="tour-card-when">{parts.weekday}, {parts.time}</span>}
                        {parts && place && <span className="tour-card-sep"> · </span>}
                        <span>{place}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {(hidden > 0 || (showAll && events.length > TOUR_LIMIT)) && (
            <button className="tour-card-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
          <p className="tour-card-credit">Tour data via Bandsintown</p>
        </>
      )}
    </div>
  );
});
