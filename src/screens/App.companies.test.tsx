import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { AccountClientContext, CompanyAddressContext, type CompanyAddress } from "../lib/companyAddress";
import { forgetInviteToken, heldInviteToken } from "../lib/inviteLink";
import { forgetRecoveryToken, heldRecoveryToken } from "../lib/recoveryLink";
import { App } from "./App";

/*
 * The routed `?token=` rule in the companies build (TAS-527, api-contract-guard
 * F2 and build finding 2, release-reviewer 2): a token that reaches the running
 * app on `/reset-password` — with its trailing slash too — is the recovery
 * link's, held for its form and taken out of the address; it is never posted
 * as an invitation's. Anywhere else the invitation's rule stands.
 */

const TOKEN = "734qwQC1pVarpZcKWJqanuMK2lp1-u61hNRvhIQr9Qc";

const { fakeApi, state } = vi.hoisted(() => {
  const state = { previews: [] as string[] };
  const api = {
    hasSession: () => false,
    onSessionExpired: () => () => {},
    onAccountChanged: () => () => {},
    getAuthMethods: async () => ({ signupEnabled: false, providers: [] }),
    previewInvitation: (token: string) => {
      state.previews.push(token);
      return new Promise(() => {});
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function openAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const address: CompanyAddress = { companyId: null, go: vi.fn(), href: (to) => to };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CompanyAddressContext.Provider value={address}>
      <AccountClientContext.Provider value={client}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            {children}
            <Where />
          </MemoryRouter>
        </QueryClientProvider>
      </AccountClientContext.Provider>
    </CompanyAddressContext.Provider>
  );
  return render(<App />, { wrapper });
}

beforeEach(() => {
  state.previews = [];
});
afterEach(() => {
  forgetRecoveryToken();
  forgetInviteToken();
});

describe("a token routed into the running app (the companies build)", () => {
  for (const path of [`/reset-password?token=${TOKEN}`, `/reset-password/?token=${TOKEN}`]) {
    it(`on ${path.split("?")[0]}: held for the reset form and out of the address — never an invitation's`, async () => {
      openAt(path);
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/reset-password$/));
      expect(heldRecoveryToken()).toBe(TOKEN);
      expect(heldInviteToken()).toBeNull();
      expect(state.previews).toEqual([]);
      expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    });
  }

  it("anywhere else the invitation's rule stands: held as an invitation, on /invite", async () => {
    openAt(`/login?token=${TOKEN}`);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/invite$/));
    expect(heldInviteToken()).toBe(TOKEN);
    expect(heldRecoveryToken()).toBeNull();
  });
});
