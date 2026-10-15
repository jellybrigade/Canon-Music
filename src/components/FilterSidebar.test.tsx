// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSidebar } from "./FilterSidebar";

function mount(overrides: Partial<Parameters<typeof FilterSidebar>[0]> = {}) {
  return render(
    <FilterSidebar
      genres={[]}
      genresError={null}
      onRetryGenres={vi.fn()}
      canonicalIdFilters={[]}
      toggleCanonicalIdFilter={vi.fn()}
      clearGenreFilters={vi.fn()}
      yearFromInput=""
      yearToInput=""
      setYearFromInput={vi.fn()}
      setYearToInput={vi.fn()}
      lovedOnly={false}
      toggleLovedOnly={vi.fn()}
      isOpen
      onToggle={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("FilterSidebar", () => {
  it("says the genre list failed to load and offers a retry, instead of dropping the section", () => {
    const onRetryGenres = vi.fn();
    const { container } = mount({ genresError: "db locked", onRetryGenres });

    expect(container.querySelector(".filter-sidebar-genre-error")?.textContent).toContain("Couldn't load genres");
    fireEvent.click(container.querySelector(".filter-sidebar-genre-retry")!);
    expect(onRetryGenres).toHaveBeenCalledTimes(1);
  });

  it("omits the genre section when the library simply has no genres", () => {
    const { container } = mount();

    expect(container.querySelector(".filter-sidebar-genre-error")).toBeNull();
    expect(container.querySelector(".filter-sidebar-genre-search")).toBeNull();
  });
});
