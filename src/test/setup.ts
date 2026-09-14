// Runs before every test file, in both the node and jsdom environments.
//
// jest-dom's matchers are only meaningful in jsdom, but registering them in node is harmless
// and keeps a single setup file, so a component test never fails because it forgot one.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// RTL registers its own afterEach(cleanup) only under `globals: true`, which this config does
// not set. Without this, every render/renderHook stays mounted for the rest of its file and its
// timers, listeners and effects keep running against later tests.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
