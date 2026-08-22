import { configure } from "@testing-library/react";
import { afterAll, vi } from "vitest";

/** Testing Library's own default, restored so no later suite inherits the raised window. */
const DEFAULT_ASYNC_UTIL_TIMEOUT_MS = 1000;

const SLOW_MOUNT_TIMEOUT_MS = 15000;

/**
 * Call at module scope in a suite that mounts the whole `App`.
 *
 * Such a mount costs a few hundred ms idle and several times that when vitest runs 60 files
 * across every core, or when `scripts/run-local-checks.sh` runs vitest and clippy together.
 * The default 1000ms `findBy*` window then measures the mount rather than the behaviour under
 * test, and the suite fails on machine load instead of on a defect. Raised per suite, not
 * globally, so an ordinary component test keeps the short window that makes a genuinely
 * missing element fail fast - and a wrong value still fails the moment the element appears,
 * whatever this is set to.
 */
export function allowSlowAppMounts() {
  configure({ asyncUtilTimeout: SLOW_MOUNT_TIMEOUT_MS });
  vi.setConfig({ testTimeout: SLOW_MOUNT_TIMEOUT_MS * 2 });
  afterAll(() => {
    configure({ asyncUtilTimeout: DEFAULT_ASYNC_UTIL_TIMEOUT_MS });
  });
}
