import { afterEach } from "vitest";

// jest-dom's matchers only mean something with a DOM; loading them into every node-only file
// cost about a second per file.
if (typeof document !== "undefined") await import("@testing-library/jest-dom/vitest");

// RTL registers its own afterEach(cleanup) only under `globals: true`, which this config does
// not set. Without this, every render/renderHook stays mounted for the rest of its file and its
// timers, listeners and effects keep running against later tests.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
