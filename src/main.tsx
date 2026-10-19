import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { ROUTER_MODE } from "./lib/appLinks";
import { keepSignedAvatarLink, ME_QUERY_KEY } from "./lib/ownAvatarLink";
import { App } from "./screens/App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
    },
  },
});
// On the key rather than at each `useQuery(["me"])`, so every reader of the
// account — five screens, the members dialog's `fetchQuery`, the login form's
// `setQueryData` — keeps the reader's avatar link the same way (TAS-223).
queryClient.setQueryDefaults(ME_QUERY_KEY, { structuralSharing: keepSignedAvatarLink });

// One value for the router and for the links the app hands out (`appUrl`), so
// a copied link is always in the scheme this build routes by.
const Router = ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
