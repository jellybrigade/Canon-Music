import { Megaphone, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { RemoteNotice } from "../lib/notice";
import "./RemoteNoticeBanner.css";

interface Props {
  notice: RemoteNotice;
  onDismiss: () => void;
}

export function RemoteNoticeBanner({ notice, onDismiss }: Props) {
  return (
    <div className="remote-notice-banner">
      <Megaphone size={16} className="remote-notice-banner-icon" />
      <span className="remote-notice-banner-message">{notice.message}</span>
      {notice.url && (
        <button
          className="remote-notice-banner-link"
          onClick={() => void openUrl(notice.url!)}
        >
          Learn more
        </button>
      )}
      <button
        className="remote-notice-banner-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notice"
      >
        <X size={14} />
      </button>
    </div>
  );
}
