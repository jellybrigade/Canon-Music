import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: that config is Tauri-shaped (fixed port, strictPort,
// src-tauri watch excludes) and its `defineConfig` is async, neither of which vitest needs.
export default defineConfig({
  test: {
    // Default node so pure-logic tests stay fast. DOM-touching files opt in per file with
    // `// @vitest-environment jsdom`.
    environment: "node",
    // The heaviest suites are seconds of real CPU work, not waiting: the migration ladder
    // replays every block from every rung, and `scripts/run-local-checks.sh` runs the whole
    // suite beside cargo test and clippy, so wall time is several times the idle figure. The
    // 5s default measured that load rather than a defect. Raised here rather than per test,
    // which would be a list someone has to remember to add the next slow test to. A hung test
    // still fails, just later; what must stay short is Testing Library's own `findBy*` window,
    // and that is untouched (see `src/test/appMount.ts`).
    testTimeout: 15000,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    },
  },
});
