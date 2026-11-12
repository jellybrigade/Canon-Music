import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);

import { getDb } from "../../../db";
import { invoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { sqlNorm, sqlNormExpression } from "../lib/canonicalize";
import { deleteTagMapping, lockTagMapping, saveTagMapping, setRapToHipHop } from "./useTagMappings";

let db: FakeDatabase;

beforeEach(async () => {
  resetTauriMocks();
  db = await createMigratedTestDb();
  db.raw.prepare("DELETE FROM tag_mappings").run();
  vi.mocked(getDb).mockResolvedValue(db as never);
});

function mapping(rawValue: string, canonicalId: string, options: { norm: string; locked?: number }) {
  db.raw
    .prepare(
      "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, locked, norm_value) VALUES (?, 'genre', ?, 'manual', ?, ?)",
    )
    .run(rawValue, canonicalId, options.locked ?? 0, options.norm);
}

function rows() {
  return db.raw.prepare("SELECT raw_value, canonical_id, locked FROM tag_mappings ORDER BY raw_value").all() as {
    raw_value: string;
    canonical_id: string;
    locked: number;
  }[];
}

describe("tag mapping writes act on the whole spelling group", () => {
  it("locks and unlocks every spelling of the group", async () => {
    mapping("Hip-Hop", "hip-hop", { norm: "hip hop" });
    mapping("HIP_HOP", "hip-hop", { norm: "hip hop" });
    mapping("Rock", "rock", { norm: "rock" });

    await lockTagMapping({ rawValue: "hip hop", kind: "genre", locked: true });
    expect(rows().map((r) => [r.raw_value, r.locked])).toEqual([
      ["HIP_HOP", 1],
      ["Hip-Hop", 1],
      ["Rock", 0],
    ]);

    await lockTagMapping({ rawValue: "Hip-Hop", kind: "genre", locked: false });
    expect(rows().every((r) => r.locked === 0)).toBe(true);
  });
});

// Save, delete and the Rap rule are one Rust transaction each (`library_write/tag_mappings.rs`, tested there).
describe("tag mapping writes in Rust", () => {
  it("sends the spelling group's key with each write", async () => {
    await saveTagMapping({ rawValue: "Hip-Hop", kind: "genre", canonicalId: "hip-hop" });
    await deleteTagMapping({ rawValue: "HIP_HOP", kind: "genre" });
    await setRapToHipHop(true);

    expect(invoke.mock.calls).toEqual([
      [
        "save_tag_mapping",
        {
          rawValue: "Hip-Hop",
          kind: "genre",
          normValue: "hip hop",
          canonicalId: "hip-hop",
          source: "manual",
          matchType: null,
        },
      ],
      ["delete_tag_mapping", { rawValue: "HIP_HOP", kind: "genre", normValue: "hip hop" }],
      ["set_rap_to_hip_hop", { enabled: true }],
    ]);
  });

  it("keys spelling groups in Rust the way TS does", () => {
    const rust = readFileSync(
      new URL("../../../../src-tauri/src/library_write/tag_mappings.rs", import.meta.url),
      "utf8",
    );
    expect(rust).toContain(`const RAW_VALUE_NORM: &str = "${sqlNormExpression("raw_value")}";`);
    expect(rust).toContain(`const RAP_GROUP: &str = "${sqlNorm("Rap")}";`);
  });
});
