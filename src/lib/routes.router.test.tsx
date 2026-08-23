// @vitest-environment jsdom
//
// The other half of `routes.test.ts`. That file asserts the round trip by hand-slicing the
// path and calling `decodeURIComponent` on it, which is a restatement of what the builder did
// rather than a test of what a route actually receives. This file drives the real router, so
// it pins the contract the routes consume: react-router decodes a `:param` segment exactly
// once, and `useParams` hands back the string that went into `encodeURIComponent`.
//
// That is worth pinning because all three detail routes used to decode the param a second
// time (see `src/app/App.routeParamDecode.test.tsx`), and every character except `%` is
// idempotent under a second decode - so a hand-decoding test agrees with a broken route on
// almost every input.
import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { albumPath, artistPath, playlistPath } from "./routes";

const AWKWARD = [
  "AC/DC",
  "Sigur Rós",
  "P!nk",
  "Panic! At The Disco?",
  "#1 Record",
  "a b",
  "album&more",
  "срв:al1",
  "srv-a:alb1",
  "a+b",
  // The percent family - the only inputs a second decode can see.
  "100%",
  "srv-a:50%",
  "%%",
  "%20",
  "%41",
  "50%25",
  "%E2",
];

function ParamProbe({ name }: { name: "albumId" | "artistName" | "playlistId" }) {
  const params = useParams();
  return <div data-testid="param">{params[name]}</div>;
}

function paramAt(pattern: string, name: "albumId" | "artistName" | "playlistId", path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={<ParamProbe name={name} />} />
      </Routes>
    </MemoryRouter>,
  );
  const value = screen.getByTestId("param").textContent;
  cleanup();
  return value;
}

describe("what a route receives for a path the builders produced", () => {
  it.each(AWKWARD)("albumPath(%s) arrives at the route unchanged", (id) => {
    expect(paramAt("/album/:albumId", "albumId", albumPath(id))).toBe(id);
  });

  it.each(AWKWARD)("artistPath(%s) arrives at the route unchanged", (name) => {
    expect(paramAt("/artist/:artistName", "artistName", artistPath(name))).toBe(name);
  });

  it.each(AWKWARD)("playlistPath(%s) arrives at the route unchanged", (id) => {
    expect(paramAt("/playlist/:playlistId", "playlistId", playlistPath(id))).toBe(id);
  });
});

describe("the decode budget the routes have to respect", () => {
  it("hands back a param a second decode would throw on", () => {
    // The value is already decoded, so it holds a bare `%`. This is what made the second
    // decode in the detail routes a crash rather than a mismatch.
    const param = paramAt("/artist/:artistName", "artistName", artistPath("100%"));
    expect(param).toBe("100%");
    expect(() => decodeURIComponent(param!)).toThrow(URIError);
  });

  it("hands back a param a second decode would silently rewrite", () => {
    const param = paramAt("/artist/:artistName", "artistName", artistPath("%20"));
    expect(param).toBe("%20");
    expect(decodeURIComponent(param!)).toBe(" ");
  });

  it("survives a second decode for everything that is not a percent sign", () => {
    // Why the defect went unnoticed for as long as it did: after one decode these hold no
    // `%XX` sequence at all, so decoding again is a no-op and the broken routes looked right.
    for (const input of ["AC/DC", "a b", "#1 Record", "album&more", "Sigur Rós", "a+b"]) {
      const param = paramAt("/artist/:artistName", "artistName", artistPath(input));
      expect(param).toBe(input);
      expect(decodeURIComponent(param!)).toBe(input);
    }
  });

  it("cannot round-trip an uppercase %2F, and that is react-router's, not ours", () => {
    // `encodeURIComponent` produces `%252F`; the router decodes that to `%2F` and then
    // restores `%2F` to `/` so a param can never introduce a path segment. The name comes back
    // as "a/b". Lowercase `%2f` is not restored and survives. Nothing in the app can fix this,
    // so it is pinned rather than asserted away - a name holding the literal text "%2F"
    // addresses the same route as one holding a slash.
    expect(paramAt("/artist/:artistName", "artistName", artistPath("a%2Fb"))).toBe("a/b");
    expect(paramAt("/artist/:artistName", "artistName", artistPath("a%2fb"))).toBe("a%2fb");
  });
});
