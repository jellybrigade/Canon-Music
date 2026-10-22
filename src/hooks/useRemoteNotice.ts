import { useCallback, useEffect, useState } from "react";
import { fetchRemoteNotice, type RemoteNotice } from "../clients/notice";
import { useSetting } from "./useSetting";

export function useRemoteNotice() {
  const [fetchedNotice, setFetchedNotice] = useState<RemoteNotice | null>(null);
  const [lastSeenNoticeId, setLastSeenNoticeId, isLastSeenLoaded] = useSetting("notice.last_seen_id", "");

  useEffect(() => {
    let cancelled = false;
    void fetchRemoteNotice().then((notice) => {
      if (!cancelled) setFetchedNotice(notice);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const remoteNotice = isLastSeenLoaded && fetchedNotice?.id !== lastSeenNoticeId ? fetchedNotice : null;
  const dismissRemoteNotice = useCallback(async () => {
    if (remoteNotice) await setLastSeenNoticeId(remoteNotice.id);
  }, [remoteNotice, setLastSeenNoticeId]);

  return { remoteNotice, dismissRemoteNotice };
}
