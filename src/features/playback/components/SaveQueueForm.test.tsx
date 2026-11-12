// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../playlists/usePlaylists", () => ({ createPlaylist: vi.fn() }));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { createPlaylist } from "../../playlists/usePlaylists";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { SaveQueueForm } from "./SaveQueueForm";

const serverWithCredential = {
  server: { id: "s1", url: "http://a", username: "u" },
  credential: "c",
} as unknown as ServerWithCredential;

function track(id: string): CurrentTrack {
  return { id: `s1:${id}`, title: id, artist: null, duration: 60 };
}

const queue = [track("a"), track("b"), track("c")];

function renderForm(onDone = vi.fn()) {
  render(<SaveQueueForm serverWithCredential={serverWithCredential} onDone={onDone} />);
  return onDone;
}

const nameInput = () => screen.getByLabelText<HTMLInputElement>("Playlist name");
const saveButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "Save" });

beforeEach(() => {
  vi.mocked(createPlaylist).mockReset();
  usePlayerStore.setState({
    queue,
    queueIndex: 0,
    isShuffled: false,
    shuffleOrder: [],
    radioActive: false,
    radioSeed: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("SaveQueueForm", () => {
  it("prefills a radio queue's name from its seed", () => {
    usePlayerStore.setState({ radioActive: true, radioSeed: track("seed") });
    renderForm();
    expect(nameInput().value).toBe("seed");
  });

  it("prefills any other queue's name with the date", () => {
    renderForm();
    expect(nameInput().value).toMatch(/^Queue /);
  });

  it("saves the queue in listed order with one create call", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(undefined);
    const onDone = renderForm();
    fireEvent.change(nameInput(), { target: { value: "Friday" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(createPlaylist).toHaveBeenCalledWith("Friday", serverWithCredential, ["s1:a", "s1:b", "s1:c"]);
  });

  it("saves a shuffled queue in the order it plays", async () => {
    vi.mocked(createPlaylist).mockResolvedValue(undefined);
    usePlayerStore.setState({ isShuffled: true, shuffleOrder: [2, 0, 1] });
    const onDone = renderForm();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPlaylist).mock.calls[0]![2]).toEqual(["s1:c", "s1:a", "s1:b"]);
  });

  it("keeps the name and says why when the save fails", async () => {
    vi.mocked(createPlaylist).mockRejectedValue(new Error("Navidrome refused the playlist"));
    const onDone = renderForm();
    fireEvent.change(nameInput(), { target: { value: "Friday" } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Navidrome refused the playlist");
    expect(nameInput().value).toBe("Friday");
    expect(saveButton().disabled).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cannot save an empty queue or a blank name", () => {
    usePlayerStore.setState({ queue: [] });
    renderForm();
    expect(saveButton().disabled).toBe(true);
    cleanup();
    usePlayerStore.setState({ queue });
    renderForm();
    fireEvent.change(nameInput(), { target: { value: "  " } });
    expect(saveButton().disabled).toBe(true);
  });
});
