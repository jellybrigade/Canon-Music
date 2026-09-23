import { useLayoutEffect, useRef, useState } from "react";
import "./AlbumBio.css";

export function AlbumBio({ bio }: { bio: string }) {
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioNeedsClamp, setBioNeedsClamp] = useState(false);
  const bioTextRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    setBioExpanded(false);
    const el = bioTextRef.current;
    if (!el) {
      setBioNeedsClamp(false);
      return;
    }
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const lines = lineHeight > 0 ? Math.round(el.scrollHeight / lineHeight) : 0;
      setBioNeedsClamp(lines >= 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bio]);

  return (
    <div className="album-bio-section">
      <div className={`album-bio-wrap${bioNeedsClamp && !bioExpanded ? " album-bio-wrap--clamped" : ""}`}>
        <p className="album-bio" ref={bioTextRef}>{bio}</p>
      </div>
      {bioNeedsClamp && (
        <button className="album-bio-toggle" onClick={() => setBioExpanded((v) => !v)}>
          {bioExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
