import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AccountClientContext, CompanyAddressContext, type CompanyAddress } from "../lib/companyAddress";

/**
 * The companies build's providers for a component test (TAS-500): the
 * address — `go` a spy, `href` the path itself — the account client, and a
 * router at `path` carrying `state`.
 */
export function companiesHarness(options: { companyId?: string | null; path?: string; state?: unknown } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const go = vi.fn<CompanyAddress["go"]>();
  const address: CompanyAddress = { companyId: options.companyId ?? null, go, href: (path) => path };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CompanyAddressContext.Provider value={address}>
      <AccountClientContext.Provider value={client}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: options.path ?? "/", state: options.state ?? null }]}>{children}</MemoryRouter>
        </QueryClientProvider>
      </AccountClientContext.Provider>
    </CompanyAddressContext.Provider>
  );
  return { client, go, wrapper };
}
