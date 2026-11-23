import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SoapCall {
  action: string;
  body: string;
  resolve: (xml: string) => void;
}

const calls: SoapCall[] = [];
const heldActions = new Set<string>();
const answers = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { soapAction?: string; body?: string }) => {
    if (command !== "upnp_soap") return Promise.resolve("");
    const action = /#(\w+)"$/.exec(args.soapAction ?? "")?.[1] ?? "";
    return new Promise<string>((resolve) => {
      calls.push({ action, body: args.body ?? "", resolve });
      if (!heldActions.has(action)) resolve(answers.get(action) ?? "");
    });
  },
}));

import type { DlnaRenderer } from "../../../clients/dlna";
import { DlnaTarget, LoadSupersededError } from "./playbackTarget";
import type { CurrentTrack } from "./playerTypes";

const renderer: DlnaRenderer = {
  name: "Living room",
  baseUrl: "http://192.168.1.20:49152",
  avTransportControlUrl: "http://192.168.1.20:49152/AVTransport/control",
  renderingControlUrl: "http://192.168.1.20:49152/RenderingControl/control",
  supportsVolume: true,
};

const streamUrl = "http://music.lan:4533/rest/stream?u=me&t=tok&s=salt&id=track-1&maxBitRate=192";

const track: CurrentTrack = {
  id: "srv:track-1",
  title: "Song",
  artist: "Artist",
  duration: 300,
  coverArtUrl: null,
  artworkRef: null,
};

const TRANSPORT_ACTIONS = new Set(["Play", "Pause", "Stop", "SetAVTransportURI"]);

function positionAnswer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `<RelTime>0:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}</RelTime>`;
}

function actions(filter: (action: string) => boolean = (a) => TRANSPORT_ACTIONS.has(a)): string[] {
  return calls.map((c) => c.action).filter(filter);
}

function releaseHeld(action: string, xml = "") {
  const call = calls.find((c) => c.action === action && heldActions.has(action));
  if (!call) throw new Error(`no held ${action} call`);
  heldActions.delete(action);
  call.resolve(xml);
}

function makeTarget(readMaxBitrate: () => number = () => 320, onTrackEnd: () => void = () => {}) {
  return new DlnaTarget({ renderer, onTrackEnd, readMaxBitrate });
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  calls.length = 0;
  heldActions.clear();
  answers.clear();
  vi.useRealTimers();
});

describe("DlnaTarget position after a seek", () => {
  it("keeps the seek target when a position read in flight across the seek returns the old time", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    heldActions.add("GetPositionInfo");
    await vi.advanceTimersByTimeAsync(2000);
    expect(actions((a) => a === "GetPositionInfo")).toHaveLength(1);

    await target.seek(120);
    releaseHeld("GetPositionInfo", positionAnswer(10));
    await flush();
    expect(await target.getPosition()).toBeCloseTo(120, 1);

    // The stale reading must not use up the seek's discard: the renderer is still behind.
    answers.set("GetPositionInfo", positionAnswer(10));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await target.getPosition()).toBeCloseTo(125, 1);
    target.teardown();
  });

  it("ignores the first reading after a seek, then trusts the next", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    await target.seek(120);
    const readsBefore = actions((a) => a === "GetPositionInfo").length;

    answers.set("GetPositionInfo", positionAnswer(10));
    await vi.advanceTimersByTimeAsync(3000);
    expect(actions((a) => a === "GetPositionInfo")).toHaveLength(readsBefore + 1);
    expect(await target.getPosition()).toBeCloseTo(123, 1);

    answers.set("GetPositionInfo", positionAnswer(200));
    await vi.advanceTimersByTimeAsync(5000);
    expect(actions((a) => a === "GetPositionInfo")).toHaveLength(readsBefore + 2);
    expect(await target.getPosition()).toBeCloseTo(200, 0);
    target.teardown();
  });

  it("does not apply a previous track's position read to the next track", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    heldActions.add("GetPositionInfo");
    await vi.advanceTimersByTimeAsync(2000);

    await target.load(streamUrl, { ...track, id: "srv:track-2" });
    releaseHeld("GetPositionInfo", positionAnswer(100));
    await flush();

    expect(await target.getPosition()).toBeLessThan(1);
    target.teardown();
  });
});

describe("DlnaTarget pause and resume", () => {
  it("sends five rapid toggles as at most two calls, in order, ending on the last click", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    calls.length = 0;
    heldActions.add("Pause");

    target.pause();
    target.resume();
    target.pause();
    target.resume();
    target.pause();
    expect(actions()).toEqual(["Pause"]);

    releaseHeld("Pause");
    await flush();
    expect(actions()).toEqual(["Pause", "Pause"]);
    target.teardown();
  });

  it("ends on Play when the last click resumes", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    calls.length = 0;
    heldActions.add("Pause");

    target.pause();
    target.resume();
    target.pause();
    target.resume();

    releaseHeld("Pause");
    await flush();
    expect(actions()).toEqual(["Pause", "Play"]);
    target.teardown();
  });

  it("drops a queued resume once playback is stopped", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    calls.length = 0;
    heldActions.add("Pause");

    target.pause();
    target.resume();
    target.stop();

    releaseHeld("Pause");
    await flush();
    expect(actions()).toEqual(["Pause", "Stop"]);
  });

  it("starts the next track only after a pause in flight has landed", async () => {
    const target = makeTarget();
    await target.load(streamUrl, track);
    calls.length = 0;
    heldActions.add("Pause");

    target.pause();
    target.resume();
    const loading = target.load(streamUrl, { ...track, id: "srv:track-2" });
    await flush();
    expect(actions()).toEqual(["Pause"]);

    releaseHeld("Pause");
    await loading;
    await flush();
    expect(actions()).toEqual(["Pause", "SetAVTransportURI", "Play"]);
    target.teardown();
  });
});

describe("DlnaTarget teardown during a load", () => {
  it("never starts a track whose load was still running when the target was torn down", async () => {
    const target = makeTarget();
    heldActions.add("SetAVTransportURI");
    const loading = target.load(streamUrl, track);
    await flush();

    target.teardown();
    releaseHeld("SetAVTransportURI");
    await expect(loading).rejects.toBeInstanceOf(LoadSupersededError);
    await vi.advanceTimersByTimeAsync(10000);

    expect(actions((a) => a !== "Stop")).toEqual(["SetAVTransportURI"]);
    expect(actions((a) => a === "GetPositionInfo" || a === "GetTransportInfo")).toEqual([]);
  });
});

describe("DlnaTarget cast bitrate", () => {
  it("reads the bitrate again on each load", async () => {
    const readMaxBitrate = vi.fn<() => number>().mockReturnValueOnce(192).mockReturnValueOnce(0);
    const target = makeTarget(readMaxBitrate);

    await target.load(streamUrl, track);
    await target.load(streamUrl, { ...track, id: "srv:track-2" });

    const setUris = calls.filter((c) => c.action === "SetAVTransportURI").map((c) => c.body);
    expect(setUris).toHaveLength(2);
    expect(setUris[0]).toContain("maxBitRate=192");
    expect(setUris[1]).not.toContain("maxBitRate");
    expect(readMaxBitrate).toHaveBeenCalledTimes(2);
    target.teardown();
  });
});

describe("DlnaTarget overlapping loads", () => {
  it("sends a newer load only after the older one, and never starts the older track", async () => {
    const target = makeTarget();
    heldActions.add("SetAVTransportURI");
    const first = target.load(streamUrl, track);
    await flush();
    const second = target.load(streamUrl.replace("track-1", "track-2"), { ...track, id: "srv:track-2" });
    await flush();

    expect(actions()).toEqual(["SetAVTransportURI"]);
    releaseHeld("SetAVTransportURI");
    await expect(first).rejects.toBeInstanceOf(LoadSupersededError);
    await second;

    const setUris = calls.filter((c) => c.action === "SetAVTransportURI").map((c) => c.body);
    expect(actions()).toEqual(["SetAVTransportURI", "SetAVTransportURI", "Play"]);
    expect(setUris[1]).toContain("track-2");
    target.teardown();
  });
});

describe("DlnaTarget end of track", () => {
  it("ignores a STOPPED reply that left before the next track loaded", async () => {
    const onTrackEnd = vi.fn();
    const target = makeTarget(() => 320, onTrackEnd);
    await target.load(streamUrl, { ...track, duration: 10 });
    heldActions.add("GetTransportInfo");
    await vi.advanceTimersByTimeAsync(9000);
    expect(actions((a) => a === "GetTransportInfo")).toHaveLength(1);

    await target.load(streamUrl, { ...track, id: "srv:track-2", duration: 300 });
    releaseHeld("GetTransportInfo", "<CurrentTransportState>STOPPED</CurrentTransportState>");
    await flush();

    expect(onTrackEnd).not.toHaveBeenCalled();
    target.teardown();
  });
});
