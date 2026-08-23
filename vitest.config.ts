import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: that config is Tauri-shaped (fixed port, strictPort,
// src-tauri watch excludes) and its `defineConfig` is async, neither of which vitest needs.
export default defineConfig({
  test: {
    // Default node so pure-logic tests stay fast. DOM-touching files opt in per file with
    // `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    },
  },
});
