const liveWrites = new Map<string, AbortController>();

/** Runs `write` as the only live write for `key`. A newer call withdraws this one, whose retry
 *  could otherwise land after it and put the older value back; the withdrawn call settles
 *  quietly, since the newer write now speaks for the key. */
export async function latestWrite(key: string, write: (signal: AbortSignal) => Promise<void>): Promise<void> {
  liveWrites.get(key)?.abort();
  const controller = new AbortController();
  liveWrites.set(key, controller);
  try {
    await write(controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) throw err;
  } finally {
    if (liveWrites.get(key) === controller) liveWrites.delete(key);
  }
}
