import { openUrl } from "@tauri-apps/plugin-opener";
import { Megaphone, X } from "lucide-react";
import type { RemoteNotice } from "../clients/notice";
import "./RemoteNoticeBanner.css";

interface Props {
  notice: RemoteNotice;
  onDismiss: () => void;
}

export function RemoteNoticeBanner({ notice, onDismiss }: Props) {
  const { link } = notice;
  return (
    <div className="remote-notice-banner">
      <Megaphone size={16} className="remote-notice-banner-icon" />
      <span className="remote-notice-banner-message">{notice.message}</span>
      {link && (
        <button className="remote-notice-banner-link" onClick={() => void openUrl(link.href)}>
          Open {link.host}
        </button>
      )}
      <button className="remote-notice-banner-dismiss" onClick={onDismiss} aria-label="Dismiss notice">
        <X size={14} />
      </button>
    </div>
  );
}
