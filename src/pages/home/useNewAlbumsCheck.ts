import { useLayoutEffect, useRef, useState } from "react";
import type { RunSyncOptions, SyncOutcome, SyncStatus } from "../../features/sync/useLibrarySync";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";

interface WatchBase {
  serverId: string;
  /** Ids shown when the user clicked: a front album outside these is one the check found. */
  idsAtClick: ReadonlySet<string>;
}

type Watch =
  | (WatchBase & { phase: "syncing" })
  | (WatchBase & { phase: "awaiting-read"; itemsAtSettle: AlbumRow[] | undefined });

type CheckRun = { serverId: string } & ({ phase: "running" } | { phase: "settled"; outcome: SyncOutcome });

const NOTES: Partial<Record<SyncOutcome["status"], string>> = {
  error: "Couldn't check for new albums",
  partial: "Sync incomplete",
};

interface Options {
  serverWithCred: ServerWithCredential;
  runSync: (s: ServerWithCredential, options?: RunSyncOptions) => boolean;
  items: AlbumRow[] | undefined;
  syncStatus: SyncStatus;
}

/** Newly Added's check button: syncs, and brings the carousel back to its start only when
 *  that sync put an album the user hadn't seen at the front. */
export function useNewAlbumsCheck({ serverWithCred, runSync, items, syncStatus }: Options) {
  const serverId = serverWithCred.server.id;
  const [watch, setWatch] = useState<Watch | null>(null);
  const [checkRun, setCheckRun] = useState<CheckRun | null>(null);
  const [scrollToStartRequest, setScrollToStartRequest] = useState(0);
  // Read by the settle callback, which outlives the render that created it; only committed
  // items, so a discarded render can't stand in for the read the check is waiting on.
  const committedItemsRef = useRef(items);
  useLayoutEffect(() => {
    committedItemsRef.current = items;
  }, [items]);

  // A run left behind on another server may never settle here, so its busy state can't follow back.
  if (checkRun && checkRun.serverId !== serverId) setCheckRun(null);

  // Albums can land mid-sync through progress refreshes, or after it in the read the settle
  // requested; the first read after settle is the last one this check is owed. A later sync
  // starting means that read never came, and anything it brings is not this check's.
  if (watch) {
    const frontId = items?.[0]?.id;
    const isNewAtFront = frontId !== undefined && !watch.idsAtClick.has(frontId);
    const isOwedReadOver =
      watch.phase === "awaiting-read" && (items !== watch.itemsAtSettle || syncStatus === "syncing");
    if (watch.serverId !== serverId) {
      setWatch(null);
    } else if (isNewAtFront || isOwedReadOver) {
      setWatch(null);
      if (isNewAtFront) setScrollToStartRequest((n) => n + 1);
    }
  }

  function checkForNewAlbums() {
    const idsAtClick = new Set(items?.map((album) => album.id));
    const isStarted = runSync(serverWithCred, {
      queueIfBusy: true,
      onSettled: (outcome) => {
        setCheckRun({ serverId, phase: "settled", outcome });
        setWatch((current) =>
          current && outcome.albumsChanged
            ? { ...current, phase: "awaiting-read", itemsAtSettle: committedItemsRef.current }
            : null,
        );
      },
    });
    if (!isStarted) return;
    setCheckRun({ serverId, phase: "running" });
    setWatch({ serverId, idsAtClick, phase: "syncing" });
  }

  const ownRun = checkRun?.serverId === serverId ? checkRun : null;
  const outcome = ownRun?.phase === "settled" ? ownRun.outcome : null;
  return {
    checkForNewAlbums,
    isChecking: ownRun?.phase === "running",
    note: outcome ? (NOTES[outcome.status] ?? null) : null,
    noteDetail: outcome?.error ?? "",
    scrollToStartRequest,
  };
}
