// Non-component, non-hook files are camelCase, so a file name reads the same as the identifier
// it exports. Only the stem before the first dot is checked: `player.waste.test.ts` names its
// module first and its aspect after.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const FEATURES = readdirSync(join(SRC_DIR, "features"));
const FEATURE_DIRS = FEATURES.flatMap((feature) =>
  ["lib", "store"]
    .map((kind) => `features/${feature}/${kind}`)
    .filter((dir) => existsSync(join(SRC_DIR, dir))),
);
const CHECKED_DIRS = ["lib", "clients", "store", "db", ...FEATURE_DIRS];
// A feature under ~15 files stays flat, so its components sit beside its logic files: every
// file there is PascalCase (a component) or camelCase. `pages` and `ui` mix the two the same way,
// and so does each page's folder of sections (`pages/home`).
const PAGE_SECTION_DIRS = readdirSync(join(SRC_DIR, "pages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `pages/${e.name}`);
const FLAT_DIRS = [
  "pages",
  ...PAGE_SECTION_DIRS,
  "ui",
  ...FEATURES.map((feature) => `features/${feature}`).filter(
    (dir) => !readdirSync(join(SRC_DIR, dir), { withFileTypes: true }).some((e) => e.isDirectory()),
  ),
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out.sort();
}

export function isCamelCaseFileName(name: string): boolean {
  const stem = name.split(".")[0] ?? "";
  return /^[a-z][a-zA-Z0-9]*$/.test(stem);
}

describe("isCamelCaseFileName", () => {
  it("accepts a camelCase stem with any suffixes", () => {
    expect(isCamelCaseFileName("queryKeys.ts")).toBe(true);
    expect(isCamelCaseFileName("player.waste.test.ts")).toBe(true);
    expect(isCamelCaseFileName("dlna.ts")).toBe(true);
  });

  it("rejects kebab, snake and PascalCase stems", () => {
    expect(isCamelCaseFileName("query-keys.ts")).toBe(false);
    expect(isCamelCaseFileName("query_keys.ts")).toBe(false);
    expect(isCamelCaseFileName("QueryKeys.ts")).toBe(false);
    expect(isCamelCaseFileName(".ts")).toBe(false);
  });
});

describe.each(CHECKED_DIRS)("src/%s file names", (dir) => {
  const files = filesUnder(join(SRC_DIR, dir));

  it("scans at least one file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("are all camelCase", () => {
    const offenders = files
      .map((path) => path.slice(SRC_DIR.length))
      .filter((path) => !isCamelCaseFileName(path.split("/").pop() ?? ""));
    expect(offenders).toEqual([]);
  });
});

describe.each(FLAT_DIRS)("src/%s file names", (dir) => {
  const files = readdirSync(join(SRC_DIR, dir));

  it("are all PascalCase components or camelCase", () => {
    const isPascalCase = (name: string) =>
      isCamelCaseFileName(name.charAt(0).toLowerCase() + name.slice(1));
    const offenders = files.filter((name) => !isCamelCaseFileName(name) && !isPascalCase(name));
    expect(offenders).toEqual([]);
  });
});
