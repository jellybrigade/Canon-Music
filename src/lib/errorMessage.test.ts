import { describe, expect, it } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
  it("reads the message of an Error", () => {
    expect(errorMessage(new TypeError("Load failed"))).toBe("Load failed");
  });

  it("stringifies a thrown non-Error", () => {
    expect(errorMessage("database is locked")).toBe("database is locked");
    expect(errorMessage(42)).toBe("42");
  });
});
