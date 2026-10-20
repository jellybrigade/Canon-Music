import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("uses the singular noun for exactly one", () => {
    expect(plural(1, "album")).toBe("album");
  });

  it("uses the plural noun for zero and for more than one", () => {
    expect(plural(0, "album")).toBe("albums");
    expect(plural(9, "play")).toBe("plays");
  });

  it("takes an irregular plural form", () => {
    expect(plural(1, "alias", "aliases")).toBe("alias");
    expect(plural(2, "alias", "aliases")).toBe("aliases");
  });
});
