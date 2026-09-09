import { useLocation } from "react-router-dom";
import { SearchView, type SearchViewProps } from "../components/SearchView";
import { ROUTES } from "../lib/routes";

/**
 * Stand-in for `AppRoutes` in the acceptance suites that drive search. Every other route pulls
 * its own data and none of those files assert on it, but `/search` is their subject, so that
 * one path renders the real `SearchView`. `AppViewProps` already carries every prop it needs;
 * the rest ride along and are ignored.
 */
export function AppRoutesSearchStub(props: SearchViewProps) {
  return useLocation().pathname === ROUTES.SEARCH
    ? <SearchView {...props} />
    : <div data-testid="route-content" />;
}
