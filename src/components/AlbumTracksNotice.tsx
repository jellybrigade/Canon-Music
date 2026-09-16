import { useAlbumTracksNoticeStore } from "../store/albumTracksNotice";

export function AlbumTracksNotice({ abovePlayer }: { abovePlayer: boolean }) {
  const notice = useAlbumTracksNoticeStore((s) => s.notice);
  const dismiss = useAlbumTracksNoticeStore((s) => s.dismiss);
  if (!notice) return null;
  return (
    <div className={`normalizing-bar${abovePlayer ? " normalizing-bar--above-player" : ""}`} role="status">
      {notice.message}
      <button className="normalizing-bar__dismiss" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
