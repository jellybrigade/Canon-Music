import { describe, expect, it } from "vitest";
import { creditedArtistKeys } from "./artistCredit";

describe("creditedArtistKeys", () => {
  it("keys a featured credit under its primary artist", () => {
    expect(creditedArtistKeys("Drake feat. Sampha")).toContain("drake");
    expect(creditedArtistKeys("Drake ft. Ye")).toContain("drake");
    expect(creditedArtistKeys("Drake featuring Rihanna")).toContain("drake");
  });

  it("keys every artist of a joint credit", () => {
    expect(creditedArtistKeys("JPEGMAFIA x Danny Brown")).toEqual(expect.arrayContaining(["jpegmafia", "danny brown"]));
    expect(creditedArtistKeys("Bladee & Lucy Bedroque")).toEqual(expect.arrayContaining(["bladee", "lucy bedroque"]));
    expect(creditedArtistKeys("Yung Lean, Bladee")).toEqual(expect.arrayContaining(["yung lean", "bladee"]));
  });

  it("keeps a duo's whole name as one of its keys", () => {
    expect(creditedArtistKeys("Simon & Garfunkel")).toContain("simon & garfunkel");
  });

  it("does not split on a letter x inside a name", () => {
    expect(creditedArtistKeys("Charli XCX")).toEqual(["charli xcx"]);
    expect(creditedArtistKeys("Malcolm X")).toEqual(["malcolm x"]);
  });

  it("returns nothing for a missing or blank credit", () => {
    expect(creditedArtistKeys(null)).toEqual([]);
    expect(creditedArtistKeys("  ")).toEqual([]);
  });
});
