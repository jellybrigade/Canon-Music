type QuitFlush = () => Promise<unknown>;

/** Quit waits this long for flushes; the Rust side exits on its own a little later regardless. */
export const QUIT_FLUSH_DEADLINE_MS = 3000;

const flushes = new Set<QuitFlush>();

/** Registers work that must finish before the app exits. Returns the unregister function. */
export function onQuit(flush: QuitFlush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/** Runs every registered flush and resolves once all settle or the deadline passes. */
export async function runQuitFlushes(deadlineMs = QUIT_FLUSH_DEADLINE_MS): Promise<void> {
  const settled = Promise.allSettled([...flushes].map((flush) => Promise.resolve().then(flush)));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    deadline = setTimeout(resolve, deadlineMs);
  });
  try {
    await Promise.race([settled, expired]);
  } finally {
    clearTimeout(deadline);
  }
}
