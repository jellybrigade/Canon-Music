import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initLogger } from "./lib/logger";

initLogger();

// Suppress WebKit's default context menu on non-input elements, custom menus are attached per-component.
document.addEventListener("contextmenu", (e) => {
  const t = e.target as Element;
  if (!t.closest("input, textarea, [contenteditable]")) e.preventDefault();
});

// Without these, uncaught async errors (rejected promises, errors outside React's
// render cycle) vanish silently, no log, no visible sign anything happened, which
// is indistinguishable from "the app just froze/crashed" from the user's side.
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
});
window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error ?? e.message);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
