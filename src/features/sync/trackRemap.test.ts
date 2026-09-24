import { describe, expect, it } from "vitest";

import { planTrackIdRemap } from "./trackRemap";

const local = (id: string, path: string | null) => ({ id, file_path: path });
const remote = (id: string, path: string | null) => ({ id, path });

describe("planTrackIdRemap", () => {
  it("pairs a stale local row with the fetched track sharing its file path", () => {
    expect(
      planTrackIdRemap([local("srv:old", "/m/a.flac")], [remote("srv:new", "/m/a.flac")])
    ).toEqual([{ oldId: "srv:old", newId: "srv:new" }]);
  });

  it("leaves a track whose id the server kept alone", () => {
    expect(
      planTrackIdRemap([local("srv:same", "/m/a.flac")], [remote("srv:same", "/m/a.flac")])
    ).toEqual([]);
  });

  it("remaps only the ids that moved, in a partly rewritten album", () => {
    expect(
      planTrackIdRemap(
        [local("srv:a", "/m/1.flac"), local("srv:b", "/m/2.flac")],
        [remote("srv:a", "/m/1.flac"), remote("srv:z", "/m/2.flac")]
      )
    ).toEqual([{ oldId: "srv:b", newId: "srv:z" }]);
  });

  it("drops a track genuinely deleted server side, leaving it to the prune", () => {
    expect(planTrackIdRemap([local("srv:gone", "/m/gone.flac")], [remote("srv:a", "/m/a.flac")])).toEqual([]);
  });

  it("refuses a local row with no file path, which is no evidence of identity", () => {
    expect(planTrackIdRemap([local("srv:old", null)], [remote("srv:new", null)])).toEqual([]);
    expect(planTrackIdRemap([local("srv:old", "")], [remote("srv:new", "")])).toEqual([]);
  });

  it("refuses a path two local rows share, since neither can claim the new id", () => {
    expect(
      planTrackIdRemap(
        [local("srv:one", "/m/dup.flac"), local("srv:two", "/m/dup.flac")],
        [remote("srv:new", "/m/dup.flac")]
      )
    ).toEqual([]);
  });

  it("refuses a path two fetched tracks share", () => {
    expect(
      planTrackIdRemap(
        [local("srv:old", "/m/dup.flac")],
        [remote("srv:new1", "/m/dup.flac"), remote("srv:new2", "/m/dup.flac")]
      )
    ).toEqual([]);
  });

  it("refuses a fetched id the mirror already holds, which would collide on write", () => {
    expect(
      planTrackIdRemap(
        [local("srv:old", "/m/a.flac"), local("srv:new", "/m/b.flac")],
        [remote("srv:new", "/m/a.flac")]
      )
    ).toEqual([]);
  });

  it("matches paths exactly, since case and spacing are the server's own bytes", () => {
    expect(
      planTrackIdRemap([local("srv:old", "/m/A.flac")], [remote("srv:new", "/m/a.flac")])
    ).toEqual([]);
  });

  it("plans nothing for an album whose tracks all still resolve", () => {
    expect(
      planTrackIdRemap(
        [local("srv:a", "/m/1.flac"), local("srv:b", "/m/2.flac")],
        [remote("srv:a", "/m/1.flac"), remote("srv:b", "/m/2.flac")]
      )
    ).toEqual([]);
  });

  it("plans nothing when either side is empty", () => {
    expect(planTrackIdRemap([], [remote("srv:new", "/m/a.flac")])).toEqual([]);
    expect(planTrackIdRemap([local("srv:old", "/m/a.flac")], [])).toEqual([]);
  });
});
