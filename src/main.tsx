import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { ROUTER_MODE } from "./lib/appLinks";
import { captureInviteLink } from "./lib/inviteLink";
import { createQueryClient } from "./lib/queryClient";
import { App } from "./screens/App";
import "./styles.css";

// Stale after 20 s, one retry, and a return to the tab re-reads only what
// failed (TAS-202): see src/lib/queryClient.ts.
const queryClient = createQueryClient();

// One value for the router and for the links the app hands out (`appUrl`), so
// a copied link is always in the scheme this build routes by.
const Router = ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;

// Before the router reads the address (TAS-208, DESIGN.md §4.27): the invitation
// email's `?token=` is a query the hash build's router never sees, so it is
// taken out here, held in memory, and the address becomes `/invite`.
captureInviteLink(window, import.meta.env.BASE_URL, ROUTER_MODE);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
