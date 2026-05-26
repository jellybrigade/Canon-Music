import { Radio, X } from "lucide-react";
import { usePlayerStore } from "../store/player";

export function RadioView() {
  const { radioActive, setRadioActive, currentTrack, queue, queueIndex } = usePlayerStore();

  const upcoming = queue.slice(queueIndex + 1);

  return (
    <main className="content-main">
      <div className="radio-view">
        <div className="radio-header">
          <h1 className="radio-title">
            <Radio size={20} /> Radio
          </h1>
          {radioActive && (
            <button className="radio-stop-btn" onClick={() => setRadioActive(false)}>
              <X size={14} /> Stop Radio
            </button>
          )}
        </div>

        {!radioActive && (
          <div className="radio-idle">
            <p className="radio-idle-text">
              Start Radio from any track or album to auto-fill the queue with similar music.
            </p>
            {currentTrack && (
              <button
                className="radio-start-btn"
                onClick={() => setRadioActive(true)}
              >
                Start from "{currentTrack.title}"
              </button>
            )}
          </div>
        )}

        {radioActive && (
          <>
            {currentTrack && (
              <div className="radio-seed">
                <span className="radio-seed-label">Now seeding from</span>
                <span className="radio-seed-track">{currentTrack.title}</span>
                {currentTrack.artist && (
                  <span className="radio-seed-artist">{currentTrack.artist}</span>
                )}
              </div>
            )}

            <div className="radio-queue">
              <h2 className="radio-section-title">Up next ({upcoming.length})</h2>
              {upcoming.length === 0 ? (
                <p className="radio-empty">Filling queue…</p>
              ) : (
                upcoming.map((track, i) => (
                  <div key={`${track.id}-${i}`} className="radio-track-row">
                    <span className="radio-track-num">{i + 1}</span>
                    <div className="radio-track-info">
                      <span className="radio-track-title">{track.title}</span>
                      {track.artist && (
                        <span className="radio-track-artist">{track.artist}</span>
                      )}
                    </div>
                    {track.album && (
                      <span className="radio-track-album">{track.album}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
