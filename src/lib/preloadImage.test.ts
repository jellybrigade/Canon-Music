// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetDecodedCovers, isCoverDecoded } from "./decodedCovers";
import { preloadImage } from "./preloadImage";

beforeEach(() => {
  forgetDecodedCovers();
});

// jsdom has no decode(); the webview does.
function stubDecode(decode: () => Promise<void>) {
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: decode });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
});

describe("preloadImage", () => {
  it("remembers a cover it decoded", async () => {
    stubDecode(() => Promise.resolve());
    await preloadImage("cover://a");
    expect(isCoverDecoded("cover://a")).toBe(true);
  });

  it("does not remember a cover that failed", async () => {
    stubDecode(() => Promise.reject(new Error("broken")));
    await expect(preloadImage("cover://a")).rejects.toThrow("broken");
    expect(isCoverDecoded("cover://a")).toBe(false);
  });
});
