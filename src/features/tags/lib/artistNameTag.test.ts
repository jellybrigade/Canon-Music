import { describe, expect, it } from "vitest";
import { isArtistNameTag } from "./artistNameTag";

describe("isArtistNameTag", () => {
  it("matches a tag spelling the artist's name, whatever its case or spacing", () => {
    expect(isArtistNameTag("sting", ["Sting"])).toBe(true);
    expect(isArtistNameTag(" STING ", ["Sting"])).toBe(true);
    expect(isArtistNameTag("my bloody valentine", ["My Bloody Valentine"])).toBe(true);
  });

  it("checks every name it is given and skips missing ones", () => {
    expect(isArtistNameTag("the police", [null, "Sting", "The Police"])).toBe(true);
    expect(isArtistNameTag("sting", [null, undefined, ""])).toBe(false);
  });

  it("leaves a tag that only resembles the name alone", () => {
    expect(isArtistNameTag("swing", ["Sting"])).toBe(false);
    expect(isArtistNameTag("sting pop", ["Sting"])).toBe(false);
  });

  it("never matches on a name with no letters or digits", () => {
    expect(isArtistNameTag("!!!", ["!!!"])).toBe(false);
  });
});
