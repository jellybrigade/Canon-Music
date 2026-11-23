import { afterEach, describe, expect, it, vi } from "vitest";

const soapBodies: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { body?: string }) => {
    if (command === "upnp_soap" && args.body) soapBodies.push(args.body);
    return Promise.resolve("");
  },
}));

import type { DlnaRenderer } from "../../../clients/dlna";
import { DlnaTarget } from "./playbackTarget";
import type { CurrentTrack } from "./playerTypes";

const renderer: DlnaRenderer = {
  name: "Living room",
  baseUrl: "http://192.168.1.20:49152",
  avTransportControlUrl: "http://192.168.1.20:49152/AVTransport/control",
  renderingControlUrl: "http://192.168.1.20:49152/RenderingControl/control",
  supportsVolume: true,
};

const streamUrl =
  "http://music.lan:4533/navidrome/rest/stream?u=me&t=tok&s=salt&v=1.16.1&c=canon&f=json&id=track-1&maxBitRate=192";

function track(overrides: Partial<CurrentTrack> = {}): CurrentTrack {
  return {
    id: "srv:track-1",
    title: "Song",
    artist: "Artist",
    duration: 200,
    coverArtUrl: "cover://localhost/cover/srv/al-9?size=64",
    artworkRef: "al-9",
    ...overrides,
  };
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// The DIDL document is XML-escaped inside the SOAP body, and the URL is escaped again inside the DIDL.
function sentAlbumArtUri(): string | null {
  const setUri = soapBodies.find((body) => body.includes("SetAVTransportURI"));
  if (!setUri) return null;
  const didl = unescapeXml(setUri);
  const match = /<upnp:albumArtURI>([^<]*)<\/upnp:albumArtURI>/.exec(didl);
  return match?.[1] === undefined ? null : unescapeXml(match[1]);
}

async function castTrack(target: DlnaTarget, castTrackInput: CurrentTrack) {
  await target.load(streamUrl, castTrackInput);
  target.teardown();
}

afterEach(() => {
  soapBodies.length = 0;
});

describe("DlnaTarget cover art", () => {
  it("hands the renderer a cover it can fetch, on the stream's server and login", async () => {
    await castTrack(new DlnaTarget({ renderer, onTrackEnd: () => {}, readMaxBitrate: () => 320 }), track());

    const art = sentAlbumArtUri();
    expect(art).not.toBeNull();
    const url = new URL(art ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("http://music.lan:4533/navidrome/rest/getCoverArt");
    expect(url.searchParams.get("id")).toBe("al-9");
    expect(url.searchParams.get("size")).toBe("600");
    expect(url.searchParams.get("u")).toBe("me");
    expect(url.searchParams.get("t")).toBe("tok");
    expect(url.searchParams.get("s")).toBe("salt");
    expect(url.searchParams.has("maxBitRate")).toBe(false);
  });

  it("sends no cover for a track without one", async () => {
    await castTrack(
      new DlnaTarget({ renderer, onTrackEnd: () => {}, readMaxBitrate: () => 320 }),
      track({ coverArtUrl: null, artworkRef: null }),
    );

    expect(soapBodies.some((body) => body.includes("SetAVTransportURI"))).toBe(true);
    expect(sentAlbumArtUri()).toBeNull();
  });
});
