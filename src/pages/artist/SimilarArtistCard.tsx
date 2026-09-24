import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Mic2 } from "lucide-react";
import { ContextMenu } from "../../ui/ContextMenu";
import { StartRadioSubmenu } from "../../features/radio/components/StartRadioSubmenu";
import type { Server } from "../../types/server";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import { useStartRadio } from "../../features/radio/hooks/useStartRadio";
import { makeStreamUrlBuilder } from "../../lib/track";
import { resolvePortraitUrl } from "../../clients/lastfm";
import { useArtistImageMap, resolveArtistImageUrl } from "../../hooks/useArtistImageCache";
import { useEnrichArtist } from "../../features/enrichment/hooks/useEnrichArtist";
import { useArtistSeedTrack, buildTrackObj } from "./artistQueries";

interface SimilarArtistCardProps {
  name: string;
  owned: boolean;
  onSelect: () => void;
  server: Server;
  credential: NavidromeCredential;
}

export const SimilarArtistCard = memo(function SimilarArtistCard({ name, owned, onSelect, server, credential }: SimilarArtistCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  const { data: enrichment } = useEnrichArtist(name, { enabled: inView, serverWithCredential: { server, credential } });
  const artistImageMap = useArtistImageMap();
  const rawPortraitUrl = resolvePortraitUrl(enrichment);
  const portraitUrl = resolveArtistImageUrl(artistImageMap, name, rawPortraitUrl);

  const { data: seedTrack } = useArtistSeedTrack(name, server.id, { enabled: inView });
  const startRadio = useStartRadio();
  const streamUrlFor = useMemo(() => makeStreamUrlBuilder(server, credential), [server, credential]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    if (!owned || !seedTrack) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        ref={cardRef}
        className={`artist-similar-card${owned ? " artist-similar-card--owned" : " artist-similar-card--dim"}`}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
      >
        {portraitUrl ? (
          <img className="artist-similar-avatar" src={portraitUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="artist-similar-avatar artist-similar-avatar--fallback">
            <Mic2 size={28} strokeWidth={1.5} />
          </span>
        )}
        <span className="artist-similar-name">{name}</span>
        <span className="artist-similar-tag">{owned ? "in library" : "search →"}</span>
      </button>

      {menu && seedTrack && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              onSelect();
              setMenu(null);
            }}
          >
            Go to artist
          </button>
          <StartRadioSubmenu
            onSelect={(mode) => {
              const track = buildTrackObj(seedTrack, server, credential);
              void startRadio({ tracks: [track], streamUrlFor, mode });
              setMenu(null);
            }}
          />
        </ContextMenu>
      )}
    </>
  );
});
