// loadSettings selects a hand-kept key list and then branches on each row's key; a branch whose
// key is missing from the list never runs (the radio similarity scale reset on every restart).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(fileURLToPath(new URL("./playerSettings.ts", import.meta.url)), "utf8");

describe("loadSettings key list", () => {
  it("selects every key it has a branch for", () => {
    const selectList = SOURCE.match(/FROM settings WHERE key IN \(([^)]*)\)/)?.[1] ?? "";
    const selected = new Set([...selectList.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const branched = [...SOURCE.matchAll(/(?:row|r2?)\.key === "([^"]+)"/g)].map((m) => m[1]);

    expect(selected.size).toBeGreaterThan(0);
    expect(branched.length).toBeGreaterThan(0);
    expect(branched.filter((key) => !selected.has(key))).toEqual([]);
  });
});
