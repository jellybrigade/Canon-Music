// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnidentifiedView } from "./UnidentifiedView";
import { getDb } from "../../../db";
import { resetTauriMocks } from "../../../test/mocks/tauri";
import type { ServerWithCredential } from "../../../hooks/useServer";

const SRV: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://music.example",
    alt_url: null,
    display_name: "Home",
    username: "marcel",
    created_at: "2026-01-01T00:00:00Z",
  } as ServerWithCredential["server"],
  credential: { type: "md5", token: "tok", salt: "salt" } as ServerWithCredential["credential"],
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UnidentifiedView serverWithCredential={SRV} onSelectAlbum={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetTauriMocks();
});

afterEach(() => {
  cleanup();
});

describe("UnidentifiedView", () => {
  it("shows a failed read as an error, not as 'no failed matches'", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockRejectedValue(new Error("db locked")),
    } as never);
    const { container } = mount();

    await waitFor(() => expect(container.querySelector(".empty-state-hint")?.textContent).toBe("db locked"));
    expect(container.querySelector(".unidentified-empty")).toBeNull();
  });

  it("shows a skeleton, not 'no failed matches', while the read is pending", () => {
    vi.mocked(getDb).mockReturnValue(new Promise(() => {}));
    const { container } = mount();

    expect(container.querySelector(".skeleton-row-list")).not.toBeNull();
    expect(container.querySelector(".unidentified-empty")).toBeNull();
  });

  it("says there is nothing to fix once an empty read lands", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockResolvedValue([]) } as never);
    const { container } = mount();

    await waitFor(() => expect(container.querySelector(".unidentified-empty")).not.toBeNull());
  });
});
