import { useEffect, useRef } from "react";

/**
 * Dismisses the command palette when a route navigates on its own (user navigation is
 * already covered by `useAppNavigation`). Keyed on `pathname` so a `?q` change doesn't close it.
 */
export function useDismissOnNavigate(pathname: string, dismiss: () => void) {
  const lastPathname = useRef(pathname);
  // Read through a ref so a caller passing a fresh closure each render doesn't
  // re-run the effect (which would dismiss on every render, not on navigation).
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    dismissRef.current();
  }, [pathname]);
}
