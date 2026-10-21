import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteNotice } from "./notice";

function respondWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRemoteNotice", () => {
  it("names the site a notice link opens", async () => {
    respondWith({ id: "n1", message: "Hello", url: "https://www.example.org/post/1" });
    await expect(fetchRemoteNotice()).resolves.toEqual({
      id: "n1",
      message: "Hello",
      link: { href: "https://www.example.org/post/1", host: "example.org" },
    });
  });

  it("drops a link that is not a valid https address", async () => {
    respondWith({ id: "n1", message: "Hello", url: "not a url" });
    await expect(fetchRemoteNotice()).resolves.toEqual({ id: "n1", message: "Hello" });
    respondWith({ id: "n2", message: "Hello", url: "file:///etc/passwd" });
    await expect(fetchRemoteNotice()).resolves.toEqual({ id: "n2", message: "Hello" });
  });
});
