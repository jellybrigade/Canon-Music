/** Tauri boundary mocks. Wire with `vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule)`.
 * `resetTauriMocks()` keeps registered listeners: stores call `listen()` once at import. */
import { vi } from "vitest";

type EventHandler = (event: { event: string; id: number; payload: unknown }) => void;

const listeners = new Map<string, Set<EventHandler>>();
let nextListenerId = 1;

/** `invoke(cmd, args)`. Default resolves undefined; per-command behavior via `onInvoke`. */
export const invoke = vi.fn(async (cmd: string, args?: unknown): Promise<unknown> => {
  const handler = invokeHandlers.get(cmd);
  return handler ? handler(args) : undefined;
});

const invokeHandlers = new Map<string, (args: unknown) => unknown>();

/** Commands whose unmocked `undefined` would throw on destructure and mask as an empty read. Seeded every reset. */
const defaultInvokeHandlers: Record<string, (args: unknown) => unknown> = {
  get_loved: () => ({ trackIds: [], albumIds: [], trackAlbumIds: [] }),
};

function seedDefaultHandlers(): void {
  for (const [cmd, handler] of Object.entries(defaultInvokeHandlers)) {
    invokeHandlers.set(cmd, handler);
  }
}

seedDefaultHandlers();

/** Register the return value (or throw) for one Tauri command. */
export function onInvoke(cmd: string, handler: (args: unknown) => unknown): void {
  invokeHandlers.set(cmd, handler);
}

export const listen = vi.fn(async (event: string, handler: EventHandler) => {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  const id = nextListenerId++;
  return () => {
    set!.delete(handler);
    void id;
  };
});

/**
 * Fire a Rust-side event at every registered listener. Rust events are broadcast, so all
 * listeners for the name receive it, which is the behavior several store guards rely on.
 */
export function emitTauriEvent(event: string, payload: unknown): void {
  for (const handler of listeners.get(event) ?? []) {
    handler({ event, id: 0, payload });
  }
}

export function listenerCount(event: string): number {
  return listeners.get(event)?.size ?? 0;
}

export function resetTauriMocks(): void {
  invokeHandlers.clear();
  seedDefaultHandlers();
  invoke.mockClear();
  listen.mockClear();
}

export const coreModule = { invoke, convertFileSrc: (p: string) => p };
export const eventModule = { listen, emit: vi.fn(), once: listen };
