// @vitest-environment jsdom
//
// `SearchView` owns the one piece of state this route deliberately keeps out of the URL: the
// raw text in the box. The param is written on a 200ms debounce and always with `replace`, so
// the two can disagree for up to 200ms by design - which is exactly the window every case
// below is about.
//
// Boundaries only: the SQLite handle behind `useSearch`. `SearchResults` is stubbed - it is not
// a boundary but a virtualized subtree needing `ResizeObserver` and layout metrics jsdom does
// not have, and its pairing with this view is already covered against the real component in
// `src/app/App.modalInOverlay.test.tsx`. The stub reports its row counts so "results rendered"
// stays a real assertion.
vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("./SearchResults", () => ({
  SearchResults: (props: { albums: unknown[]; tracks: unknown[]; artists: unknown[] }) => (
    <div data-testid="results">
      {props.albums.length}/{props.tracks.length}/{props.artists.length}
    </div>
  ),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense } from "react";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { SearchView } from "./SearchView";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { Server } from "../../types/server";

const SRV = "srv-a";
const DEBOUNCE_MS = 200;

let db: FakeDatabase;

const server: Server = {
  id: SRV,
  type: "navidrome",
  url: "https://example.test",
  alt_url: null,
  display_name: "Test",
  username: "u",
  created_at: "2026-01-01",
};

const serverWithCred: ServerWithCredential = {
  server,
  credential: { type: "md5", token: "t", salt: "s" },
};

/**
 * `tracks_fts` has no triggers (see `migrations.ts` v5) - `sync.ts` writes it explicitly, so
 * seeding `tracks` alone leaves the index empty and every search returns nothing.
 */
function seedAbba() {
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist) VALUES (?, ?, 'navidrome', ?, ?)`,
    )
    .run("alb-1", SRV, "Arrival", "ABBA");
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES (?, ?, 'navidrome', ?, ?, ?)`,
    )
    .run("trk-1", SRV, "Dancing Queen", "ABBA", "alb-1");
  db.raw
    .prepare(`INSERT INTO tracks_fts (id, title, artist, album, genre) VALUES (?, ?, ?, ?, '')`)
    .run("trk-1", "Dancing Queen", "ABBA", "Arrival");
}

let navigateFromOutside: ((to: string) => void) | null = null;

/** Stands in for every navigation the rest of the app can aim at /search while it stays mounted. */
function NavigateProbe() {
  const navigate = useNavigate();
  navigateFromOutside = (to) => navigate(to);
  return null;
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="url">{pathname + search}</div>;
}

const leaveSearch = vi.fn();

function mount(
  entry = "/search",
  overrides: Partial<Parameters<typeof SearchView>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  // `show` exists so a case can unmount the view while the router it wrote to stays up. Asserting
  // the pending write after tearing the whole tree down would pass for free.
  const tree = (show: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Suspense fallback={null}>
          {show ? (
          <SearchView
            server={server}
            serverWithCred={serverWithCred}
            credError={null}
            credPending={false}
            retryCredential={vi.fn()}
            playlists={[]}
            searchInputRef={{ current: null }}
            queueClass=""
            leaveSearch={leaveSearch}
            openAlbum={vi.fn()}
            openArtist={vi.fn()}
            handlePlayTrack={vi.fn().mockResolvedValue(undefined)}
            handleStartRadioFromAlbum={vi.fn().mockResolvedValue(undefined)}
            handleStartRadioFromArtist={vi.fn().mockResolvedValue(undefined)}
            addAlbumToPlaylist={vi.fn()}
            {...overrides}
          />
          ) : null}
        </Suspense>
        <LocationProbe />
        <NavigateProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  return { ...view, hideSearchView: () => view.rerender(tree(false)) };
}

const input = () => document.querySelector(".search-bar-input") as HTMLInputElement | null;
const url = () => screen.getByTestId("url").textContent;
const emptyState = () => document.querySelector(".empty-state")?.textContent ?? null;

/** Let the debounce fire and the FTS round trip commit. Polled, not slept through. */
async function settle(ready: () => boolean, what: string) {
  for (let waited = 0; waited < 3000; waited += 25) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    if (ready()) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createMigratedTestDb();
});

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await db.close();
});

describe("SearchView", () => {
  it("renders a cold mount at ?q=abba pre-filled, focused and already searching", async () => {
    // The deep-link case, and the reason focus is a callback ref rather than an effect keyed on
    // the ref: on a cold mount the input does not exist when the first effect would run.
    seedAbba();
    mount("/search?q=abba");

    expect(input()!.value).toBe("abba");
    expect(document.activeElement).toBe(input());
    await waitFor(() => expect(screen.queryByTestId("results")).not.toBeNull());
    expect(screen.getByTestId("results").textContent).toBe("1/1/1");
  });

  it("shows the typed text immediately and moves ?q only after the debounce", async () => {
    seedAbba();
    mount();

    fireEvent.change(input()!, { target: { value: "abb" } });
    expect(input()!.value).toBe("abb");
    expect(url()).toBe("/search");

    await settle(() => url() !== "/search", "the debounced ?q write");
    expect(url()).toBe("/search?q=abb");
  });

  it("collapses a burst of keystrokes into one ?q write", async () => {
    // The debounce is what keeps typing off the history stack and off the database. Five
    // keystrokes, one param write, one search round.
    seedAbba();
    mount();
    for (const value of ["a", "ab", "abb", "abba", "abbas"]) {
      fireEvent.change(input()!, { target: { value } });
    }

    await settle(() => url() !== "/search", "the debounced ?q write");
    expect(url()).toBe("/search?q=abbas");
  });

  // A query is free text, and the characters below are the ones a URL round trip mangles: `+`
  // decodes to a space, `#` truncates, `/` and `%` are the two the path-param routes already
  // pin against a double decode. The box writes through `setSearchParams` and reads back
  // through `searchParams.get`, so the contract is that whatever was typed survives both.
  const AWKWARD = ["a+b", "a b", "#1 Record", "100%", "AC/DC", "Sigur Rós", "?"];

  it.each(AWKWARD)("keeps %s intact through the ?q write and back", async (query) => {
    seedAbba();
    mount();

    fireEvent.change(input()!, { target: { value: query } });
    await settle(() => url() !== "/search", "the debounced ?q write");

    // Read back the way a cold mount at that URL would: fresh view, param straight into the box.
    const written = url()!;
    cleanup();
    mount(written);
    expect(input()!.value).toBe(query);
  });

  it("empties the box and the param on the clear button without leaving /search", async () => {
    seedAbba();
    mount("/search?q=abba");

    await act(async () => {
      fireEvent.click(document.querySelector(".search-bar-clear") as HTMLElement);
    });

    expect(input()!.value).toBe("");
    expect(url()).toBe("/search");
    expect(document.activeElement).toBe(input());
    expect(leaveSearch).not.toHaveBeenCalled();
  });

  it("writes no ?q when it unmounts inside the debounce window", async () => {
    // The bug this route's debounce would otherwise introduce: the pending write lands on
    // whatever route the user navigated to, tacking a stray ?q onto it.
    seedAbba();
    const { hideSearchView } = mount();
    // The one case here measured in the debounce window rather than past it, so it is the one
    // that cannot be slept through: a loaded machine can spend the whole 200ms between the
    // keystroke and the unmount, and then the write it is asserting against has already landed.
    vi.useFakeTimers();
    fireEvent.change(input()!, { target: { value: "abba" } });
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS / 2); });

    await act(async () => { hideSearchView(); });
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS * 2); });

    expect(input()).toBeNull();
    expect(url()).toBe("/search");
  });

  it("empties the box when the query leaves the URL under it", async () => {
    // The sidebar Search item aims at /search with no ?q, and the route stays mounted through
    // it. The box used to keep the old term, clear button and all, beside a body that had gone
    // back to inviting a query.
    seedAbba();
    mount("/search?q=abba");
    expect(input()!.value).toBe("abba");

    await act(async () => { navigateFromOutside!("/search"); });

    expect(input()!.value).toBe("");
    expect(document.querySelector(".search-bar-clear")).toBeNull();
    expect(emptyState()).toBe("Start typing to search");
  });

  it("refills the box when the URL arrives with a different query", async () => {
    seedAbba();
    mount("/search?q=abba");

    await act(async () => { navigateFromOutside!("/search?q=beatles"); });

    expect(input()!.value).toBe("beatles");
  });

  it("leaves whitespace-only typing in the box though it writes no ?q", async () => {
    // The resync above must lose to the keystrokes it mirrors: "  " writes no param, so the
    // URL says "" while the box legitimately holds two spaces the user is typing around.
    seedAbba();
    mount();

    fireEvent.change(input()!, { target: { value: "  " } });
    await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS * 2)); });

    expect(input()!.value).toBe("  ");
    expect(url()).toBe("/search");
  });

  it("invites a query rather than reporting an empty result when ?q is absent", async () => {
    mount();
    expect(emptyState()).toBe("Start typing to search");
    expect(screen.queryByTestId("results")).toBeNull();
  });

  it("says it is connecting while the credential read is still in flight", async () => {
    // Not "Searching…": the old branch collapsed a pending credential into the search's own
    // loading copy, so a keychain read that never resolved read as a search that never
    // finished. Pending and failed are different answers and get different messages.
    mount("/search?q=abba", { serverWithCred: null, credPending: true });
    expect(emptyState()).toBe("Connecting to your server…");
  });

  it("offers a retry when the credential read has failed", async () => {
    const retryCredential = vi.fn();
    mount("/search?q=abba", { serverWithCred: null, credPending: false, retryCredential });

    expect(document.querySelector(".empty-state-title")!.textContent).toBe(
      "Canon could not read the saved credential",
    );
    fireEvent.click(document.querySelector(".empty-state-action") as HTMLElement);
    expect(retryCredential).toHaveBeenCalledTimes(1);
  });

  it("names the database as the failure when the search query throws", async () => {
    // Positive control below: without the seeded table the query would return empty, not throw,
    // and a wrong branch would read as "no results" instead of an error.
    await db.execute("DROP TABLE tracks_fts");
    mount("/search?q=abba");

    await settle(() => emptyState() !== "Searching…", "the query to fail");
    expect(emptyState()).toBe("Search failed. The library database could not be read.");
  });
});
