// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: () => new Promise(() => {}) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { type LookedUpFacts, NO_LOOKED_UP_FACTS } from "../../features/albumFacts/lookedUpFacts";
import type { AlbumIdentityRow } from "../../features/enrichment/hooks/useAlbumIdentity";
import { AlbumHero } from "./AlbumHero";

afterEach(cleanup);

const album = { id: "a1", server_id: "s", name: "Come In", artist: "Weatherday", year: 2019, artwork_url: null };

function identity(fields: Partial<AlbumIdentityRow>): AlbumIdentityRow {
  return {
    album_id: "a1",
    mb_release_group_id: "rg",
    mb_release_id: null,
    mb_artist_id: null,
    lastfm_artist_name: null,
    lastfm_album_name: null,
    lastfm_match_confirmed: 0,
    combined_genres_json: null,
    combined_tags_json: null,
    label: null,
    country: null,
    catalog_number: null,
    barcode: null,
    release_date: null,
    first_release_date: null,
    confirmed_at: 1,
    auto_matched: 1,
    match_score: null,
    looked_up_at: 1,
    ...fields,
  };
}

function facts(albumIdentity: AlbumIdentityRow | null, lookedUp: Partial<LookedUpFacts> | string | null): string[] {
  const lookedUpFacts = {
    ...NO_LOOKED_UP_FACTS,
    ...(typeof lookedUp === "string" ? { label: lookedUp } : lookedUp),
  };
  const noop = () => {};
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <AlbumHero
        album={album}
        coverArtUrl={null}
        albumIdentity={albumIdentity}
        lookedUpFacts={lookedUpFacts}
        showUnidentified={false}
        tagsComputedAt={null}
        tagRefresh={{ isRefreshing: false, error: null, onRefresh: noop }}
        playAction="play"
        canPlay
        onPlayAlbum={noop}
        isLoved={false}
        onToggleLove={noop}
        onIdentify={noop}
        onClose={noop}
      />
    </QueryClientProvider>,
  );
  return [...container.querySelectorAll(".album-detail-facts span")].map((span) => span.textContent ?? "");
}

describe("AlbumHero facts", () => {
  it("shows a looked-up label beside the year for an album MusicBrainz hasn't matched", () => {
    expect(facts(null, "Sub Pop Records")).toEqual(["2019", "Sub Pop Records"]);
  });

  it("shows a looked-up label when the MusicBrainz match has none", () => {
    expect(facts(identity({ country: "SE" }), "Sub Pop Records")).toEqual(["2019", "Sub Pop Records", "SE"]);
  });

  it("keeps MusicBrainz's label over a looked-up one", () => {
    expect(facts(identity({ label: "Sub Pop", release_date: "2026-10-30" }), "Sub Pop Records")).toEqual([
      "2026",
      "Sub Pop",
    ]);
  });

  it("shows Discogs' label, country and catalog number for an album MusicBrainz hasn't matched", () => {
    expect(facts(null, { label: "Paper Bag Records", country: "Canada", catalogNumber: "PAPER166CD" })).toEqual([
      "2019",
      "Paper Bag Records",
      "Canada",
      "PAPER166CD",
    ]);
  });

  it("keeps MusicBrainz's label and catalog number together over a looked-up pair", () => {
    expect(
      facts(identity({ label: "Sub Pop", catalog_number: "SP1753" }), {
        label: "Paper Bag Records",
        country: "Canada",
        catalogNumber: "PAPER166CD",
      }),
    ).toEqual(["2019", "Sub Pop", "Canada", "SP1753"]);
  });

  it("drops a looked-up catalog number beside MusicBrainz's label", () => {
    expect(facts(identity({ label: "Sub Pop" }), { label: "Paper Bag Records", catalogNumber: "PAPER166CD" })).toEqual([
      "2019",
      "Sub Pop",
    ]);
  });

  it("shows only the year when nobody knows the label", () => {
    expect(facts(null, null)).toEqual(["2019"]);
  });
});
