import { useLocation } from "react-router-dom";
import { SearchView, type SearchViewProps } from "../features/search/SearchView";
import { ROUTES } from "../lib/routes";

/**
 * Stand-in for `AppRoutes` in acceptance suites that drive search: only `/search` renders the
 * real `SearchView`, other routes render an inert placeholder.
 */
export function AppRoutesSearchStub(props: SearchViewProps) {
  return useLocation().pathname === ROUTES.SEARCH
    ? <SearchView {...props} />
    : <div data-testid="route-content" />;
}
