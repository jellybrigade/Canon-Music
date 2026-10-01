import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCredentialRejected,
  noteEnvelope,
  resetCredentialRejections,
  subscribeCredentialRejections,
} from "./credentialRejections";

const BASE = "http://music.example";

afterEach(() => {
  resetCredentialRejections();
});

describe("credential rejections", () => {
  it.each([40, 44])("records code %i as the saved credential being refused", (code) => {
    noteEnvelope(BASE, { status: "failed", error: { code } });

    expect(isCredentialRejected(BASE)).toBe(true);
  });

  it.each([41, 50, 70])("does not read code %i as a refused credential", (code) => {
    noteEnvelope(BASE, { status: "failed", error: { code } });

    expect(isCredentialRejected(BASE)).toBe(false);
  });

  it("clears once the server accepts a request again", () => {
    noteEnvelope(BASE, { status: "failed", error: { code: 40 } });
    noteEnvelope(BASE, { status: "ok" });

    expect(isCredentialRejected(BASE)).toBe(false);
  });

  it("keeps one server's refusal off another", () => {
    noteEnvelope(BASE, { status: "failed", error: { code: 40 } });

    expect(isCredentialRejected("http://other.example")).toBe(false);
  });

  it("matches the address however the caller spelled its trailing slash or /rest suffix", () => {
    noteEnvelope(`${BASE}/rest/`, { status: "failed", error: { code: 40 } });

    expect(isCredentialRejected(`${BASE}/`)).toBe(true);
  });

  it("notifies subscribers only when the answer changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCredentialRejections(listener);

    for (let i = 0; i < 5; i++) noteEnvelope(BASE, { status: "ok" });
    for (let i = 0; i < 5; i++) noteEnvelope(BASE, { status: "failed", error: { code: 40 } });
    for (let i = 0; i < 5; i++) noteEnvelope(BASE, { status: "ok" });

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    noteEnvelope(BASE, { status: "failed", error: { code: 40 } });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
