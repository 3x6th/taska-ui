import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AccountClientProvider, CompanyRouter } from "./components/CompanyRouter";
import { ROUTER_MODE } from "./lib/appLinks";
import { captureInviteLink } from "./lib/inviteLink";
import { captureOAuthCallback } from "./lib/oauthCallback";
import { createQueryClient } from "./lib/queryClient";
import { tenantsEnabled } from "./lib/tenancy";
import { App } from "./screens/App";
import "./styles.css";

// Stale after 20 s, one retry, and a return to the tab re-reads only what
// failed (TAS-202): see src/lib/queryClient.ts.
const queryClient = createQueryClient();

// One value for the router and for the links the app hands out (`appUrl`), so
// a copied link is always in the scheme this build routes by.
const Router = ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;

// Before the router reads the address and before any request (TAS-426, DESIGN.md
// §4.31): a provider sign-in comes back to `/auth/callback` at the origin root
// with a one-time code, which is taken out here, held in memory, and the
// address becomes the app's own callback route. Only on that path.
captureOAuthCallback(window, import.meta.env.BASE_URL, ROUTER_MODE);

// Before the router reads the address (TAS-208, DESIGN.md §4.27): the invitation
// email's `?token=` is a query the hash build's router never sees, so it is
// taken out here, held in memory, and the address becomes `/invite`.
captureInviteLink(window, import.meta.env.BASE_URL, ROUTER_MODE);

// `useTransitions={false}` (TAS-396): a navigation commits in the frame it is
// made rather than as a transition. As a transition, a click could be pending
// when a data-driven `<Navigate replace>` fired — the admin area's redirect into
// the first table once the catalog answered replaced a rail click to Users that
// React had not yet committed. Seven redirects of that kind share the window
// (the admin sections and `/browse/:issueKey`); nothing in the app suspends, so
// there is no pending UI for a transition to keep on screen.
//
// The companies build (TAS-500, `VITE_TASKA_TENANTS`) puts the company in the
// address: `CompanyRouter` is the same router under the prefix `/c/{companyId}`,
// remounted per company, and this client becomes the account's — each company
// session gets its own below it (DESIGN.md §5.1, §6).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {tenantsEnabled ? (
        <AccountClientProvider client={queryClient}>
          <CompanyRouter>
            <App />
          </CompanyRouter>
        </AccountClientProvider>
      ) : (
        <Router useTransitions={false}>
          <App />
        </Router>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
