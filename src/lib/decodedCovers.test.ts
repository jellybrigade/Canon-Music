import { beforeEach, describe, expect, it } from "vitest";
import { DECODED_COVERS_MAX, forgetDecodedCovers, isCoverDecoded, markCoverDecoded } from "./decodedCovers";

beforeEach(() => {
  forgetDecodedCovers();
});

describe("decoded covers", () => {
  it("remembers a cover once it has been decoded", () => {
    expect(isCoverDecoded("cover://a")).toBe(false);
    markCoverDecoded("cover://a");
    expect(isCoverDecoded("cover://a")).toBe(true);
  });

  it("forgets the least recently shown cover past the cap", () => {
    for (let index = 0; index < DECODED_COVERS_MAX; index++) markCoverDecoded(`cover://${index}`);
    markCoverDecoded("cover://0");
    markCoverDecoded("cover://new");
    expect(isCoverDecoded("cover://0")).toBe(true);
    expect(isCoverDecoded("cover://1")).toBe(false);
    expect(isCoverDecoded("cover://new")).toBe(true);
  });
});
