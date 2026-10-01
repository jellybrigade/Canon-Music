import { configure } from "@testing-library/react";
import { afterAll, vi } from "vitest";

/** Testing Library's own default, restored so no later suite inherits the raised window. */
const DEFAULT_ASYNC_UTIL_TIMEOUT_MS = 1000;

const SLOW_MOUNT_TIMEOUT_MS = 15000;

/**
 * Call at module scope in a suite that mounts the whole `App`: raises the `findBy*` window so
 * a slow mount under load doesn't fail the suite. Per suite, so other tests keep failing fast.
 */
export function allowSlowAppMounts() {
  configure({ asyncUtilTimeout: SLOW_MOUNT_TIMEOUT_MS });
  vi.setConfig({ testTimeout: SLOW_MOUNT_TIMEOUT_MS * 2 });
  afterAll(() => {
    configure({ asyncUtilTimeout: DEFAULT_ASYNC_UTIL_TIMEOUT_MS });
  });
}
