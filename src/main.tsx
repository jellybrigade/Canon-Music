import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { initLogger } from "./lib/logger";
import { getDb } from "./db";
import { purgeStrandedServers } from "./features/sync/sync";

initLogger();

// Fire and forget, outside getDb's memo: a failed repair must not poison the database
// promise the whole app waits on, and there is nothing the user could do about it anyway.
void getDb()
  .then((db) => purgeStrandedServers(db))
  .catch((err: unknown) => console.error("startup: failed to purge removed servers:", err));

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
