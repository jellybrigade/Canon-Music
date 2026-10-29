import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./boundedFetch", () => ({ boundedNativeFetch: vi.fn() }));

import { boundedNativeFetch } from "./boundedFetch";
import { fetchCaaFrontCovers } from "./coverArtArchive";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const image = (overrides: Record<string, unknown>) => ({
  types: ["Front"],
  approved: true,
  image: "https://caa/orig.jpg",
  thumbnails: { "250": "https://caa/250.jpg", "500": "https://caa/500.jpg", "1200": "https://caa/1200.jpg" },
  ...overrides,
});

afterEach(() => {
  vi.mocked(boundedNativeFetch).mockReset();
});

describe("fetchCaaFrontCovers", () => {
  it("asks the release endpoint or the release-group endpoint by kind", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () => jsonResponse(200, { images: [] }));
    await fetchCaaFrontCovers("release", "rel-1");
    await fetchCaaFrontCovers("release-group", "rg-1");
    expect(vi.mocked(boundedNativeFetch).mock.calls.map(([url]) => url)).toEqual([
      "https://coverartarchive.org/release/rel-1",
      "https://coverartarchive.org/release-group/rg-1",
    ]);
  });

  it("keeps fronts that are also something else, and drops backs and unusable scans", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () =>
      jsonResponse(200, {
        images: [
          image({ image: "https://caa/front-booklet.jpg", types: ["Front", "Booklet"] }),
          image({ image: "https://caa/back.jpg", types: ["Back"] }),
          image({ image: "https://caa/raw.jpg", types: ["Front", "Raw/Unedited"] }),
          image({ image: "https://caa/mark.jpg", types: ["Front", "Watermark"] }),
          image({ image: "https://caa/runout.jpg", types: ["Front", "Matrix/Runout"] }),
        ],
      }),
    );
    const covers = await fetchCaaFrontCovers("release", "rel-1");
    expect(covers.map((cover) => cover.originalUrl)).toEqual(["https://caa/front-booklet.jpg"]);
  });

  it("uses the 250 and 1200 renditions, falling back to smaller ones or the legacy names", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () =>
      jsonResponse(200, {
        images: [
          image({}),
          image({
            image: "https://caa/legacy.jpg",
            thumbnails: { small: "https://caa/s.jpg", large: "https://caa/l.jpg" },
          }),
          image({ image: "https://caa/bare.jpg", thumbnails: {} }),
        ],
      }),
    );
    const covers = await fetchCaaFrontCovers("release", "rel-1");
    expect(covers.map(({ thumbUrl, fullUrl }) => ({ thumbUrl, fullUrl }))).toEqual([
      { thumbUrl: "https://caa/250.jpg", fullUrl: "https://caa/1200.jpg" },
      { thumbUrl: "https://caa/s.jpg", fullUrl: "https://caa/l.jpg" },
      { thumbUrl: "https://caa/bare.jpg", fullUrl: "https://caa/bare.jpg" },
    ]);
  });

  it("carries whether the image was approved", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () =>
      jsonResponse(200, { images: [image({ approved: false })] }),
    );
    expect((await fetchCaaFrontCovers("release", "rel-1"))[0]?.isApproved).toBe(false);
  });

  it("answers no covers when the archive has none for the id", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () => jsonResponse(404, {}));
    await expect(fetchCaaFrontCovers("release", "rel-1")).resolves.toEqual([]);
  });

  it("fails when the archive did not answer", async () => {
    vi.mocked(boundedNativeFetch).mockImplementation(async () => jsonResponse(503, {}));
    await expect(fetchCaaFrontCovers("release", "rel-1")).rejects.toThrow("503");
  });
});
