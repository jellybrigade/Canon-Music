// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/boundedFetch", () => ({ boundedNativeFetch: vi.fn() }));

import { boundedNativeFetch } from "../clients/boundedFetch";
import { extractAccent } from "./artColor";

let isImageLoadable: boolean;

class FakeImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => (isImageLoadable ? this.onload?.() : this.onerror?.()));
  }
}

const grayPixels = new Uint8ClampedArray(32 * 32 * 4).fill(128);

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: grayPixels }),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(boundedNativeFetch).mockReset();
});

describe("extractAccent", () => {
  it("tries again after a cover that could not be fetched, instead of remembering no color", async () => {
    isImageLoadable = false;
    vi.mocked(boundedNativeFetch).mockRejectedValue(new Error("timed out"));

    expect(await extractAccent("cover://srv/unreachable")).toBeNull();
    expect(await extractAccent("cover://srv/unreachable")).toBeNull();

    expect(boundedNativeFetch).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between callers asking for the same cover at once", async () => {
    isImageLoadable = false;
    vi.mocked(boundedNativeFetch).mockRejectedValue(new Error("timed out"));

    await Promise.all([extractAccent("cover://srv/shared"), extractAccent("cover://srv/shared")]);

    expect(boundedNativeFetch).toHaveBeenCalledTimes(1);
  });

  it("remembers a decoded cover that has no usable color", async () => {
    isImageLoadable = true;
    const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext);

    expect(await extractAccent("cover://srv/gray")).toBeNull();
    expect(await extractAccent("cover://srv/gray")).toBeNull();

    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
