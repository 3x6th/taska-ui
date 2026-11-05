import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { ForeignCompanyAnswerError } from "../api/tenants";
import { useCompanyMarker } from "../hooks/useCompanies";
import { useMutation } from "../hooks/useMutation";
import { createQueryClient } from "../lib/queryClient";
import { COMPANY_SUBSCRIPTION_KEY, companyTenantKey, companyTenantOptions } from "../screens/company/companyGeneral";
import { COMPANY_QUOTAS_KEY, retryUnanswered } from "../screens/company/companyMembersQuery";
import { COMPANY_ENTITLEMENT_KEY, QUOTA_WRITE_META } from "../screens/company/companyPlan";
import { companiesHarness } from "../test/companiesHarness";
import { CompanyGate } from "./CompanyGate";

/*
 * What makes a company tab read its plan again (TAS-512, api-contract-guard
 * B4; release-reviewer M-2, guard N3): `CompanyGate` listens on the company
 * session's client — a write refused READ_ONLY, CAPABILITY_DISABLED or
 * QUOTA_EXCEEDED invalidates the company, its entitlement and the owner's
 * subscription, and the snapshot only for a write marked `quotaWrite`; a
 * `Tenant` answer whose version or restrictions moved invalidates the
 * entitlement, the snapshot and the subscription, and the first answer is
 * never «moved». Plus the two places a definite answer must not be asked
 * again: `retryUnanswered` on another company's answer, and the state
 * marker's observer of `["tenant", id]` (release-reviewer L-2).
 */

const NORTHWIND = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    restrictions: [] as string[],
    version: "3",
    tenantCalls: 0,
    listCalls: 0,
    tenantFailure: null as Error | null,
    /** What the probe's writes are refused with. */
    refusal: null as Error | null,
  };
  const tenant = () => ({
    id: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01",
    name: "Northwind",
    ownerId: "anna",
    lifecycle: "ACTIVE",
    restrictions: [...state.restrictions],
    createdAt: null,
    creationDeadline: null,
    version: state.version,
  });
  const api = {
    enterCompany: () => new Promise(() => {}),
    onWorkspaceClosed: () => () => {},
    onWorkspaceLeft: () => () => {},
    onWorkspaceRestricted: () => () => {},
    onWorkspacePending: () => () => {},
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
    getCurrentUser: async () => ({ id: "anna", email: "anna@example.com", displayName: "Anna", status: "ACTIVE" }),
    listTenants: async () => {
      state.listCalls += 1;
      return { items: [{ ...tenant(), restrictions: [] }], nextCursor: null };
    },
    getTenant: async () => {
      state.tenantCalls += 1;
      if (state.tenantFailure) throw state.tenantFailure;
      return tenant();
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const refusal = (status: number, code: string, reasons: string[] = []) =>
  Object.assign(new Error("the server's words"), { status, code, requestId: `rid-${code}`, details: null, reasons });

beforeEach(() => {
  state.restrictions = [];
  state.version = "3";
  state.tenantCalls = 0;
  state.listCalls = 0;
  state.tenantFailure = null;
  state.refusal = null;
});

/** A page under the gate: two writes — one marked as a quota write, one not — and the session's client handed out. */
const handedOut: { client: QueryClient | null } = { client: null };
function Probe() {
  const client = useQueryClient();
  useEffect(() => {
    handedOut.client = client;
  }, [client]);
  const quotaWrite = useMutation({ mutationFn: () => Promise.reject(state.refusal), meta: QUOTA_WRITE_META });
  const plainWrite = useMutation({ mutationFn: () => Promise.reject(state.refusal) });
  return (
    <>
      <button onClick={() => quotaWrite.mutate()} type="button">
        Quota write
      </button>
      <button onClick={() => plainWrite.mutate()} type="button">
        Plain write
      </button>
      <p>{quotaWrite.isError || plainWrite.isError ? "refused" : "idle"}</p>
    </>
  );
}

async function renderGate() {
  handedOut.client = null;
  const harness = companiesHarness({ companyId: NORTHWIND, path: "/projects" });
  render(
    <Routes>
      <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
        <Route path="/projects" element={<Probe />} />
      </Route>
    </Routes>,
    { wrapper: harness.wrapper },
  );
  await screen.findByRole("button", { name: "Quota write" });
  // Set by the probe's effect since the reset above, which TypeScript cannot see.
  const client = handedOut.client as QueryClient | null;
  if (client === null) throw new Error("no company client");
  return { client, account: harness.client };
}

const PLAN_READS = [COMPANY_ENTITLEMENT_KEY, COMPANY_QUOTAS_KEY, COMPANY_SUBSCRIPTION_KEY] as const;

/** The plan reads as a page left them: answered, nothing invalidated. */
function seedPlanReads(client: QueryClient) {
  client.setQueryData(COMPANY_ENTITLEMENT_KEY, { tenantId: NORTHWIND, version: "1", planVersionId: "free", limits: [] });
  client.setQueryData(COMPANY_QUOTAS_KEY, { tenantId: NORTHWIND, version: "1", quotas: [], asOf: null });
  client.setQueryData(COMPANY_SUBSCRIPTION_KEY, { tenantId: NORTHWIND, planVersionId: "free", version: "1" });
}
const invalidated = (client: QueryClient, queryKey: readonly unknown[]) => client.getQueryState(queryKey)?.isInvalidated ?? false;

describe("a refused write re-reads the plan (B4)", () => {
  it("QUOTA_EXCEEDED on an unmarked write: the company, its entitlement and subscription — never the snapshot", async () => {
    const { client } = await renderGate();
    seedPlanReads(client);
    client.setQueryData(companyTenantKey(NORTHWIND), { id: NORTHWIND, version: "3", restrictions: [] });
    state.refusal = refusal(422, "QUOTA_EXCEEDED");
    fireEvent.click(screen.getByRole("button", { name: "Plain write" }));
    await screen.findByText("refused");
    await waitFor(() => expect(invalidated(client, COMPANY_ENTITLEMENT_KEY)).toBe(true));
    expect(invalidated(client, companyTenantKey(NORTHWIND))).toBe(true);
    expect(invalidated(client, COMPANY_SUBSCRIPTION_KEY)).toBe(true);
    expect(invalidated(client, COMPANY_QUOTAS_KEY)).toBe(false);
  });

  it("QUOTA_EXCEEDED on a write marked quotaWrite (invite, project, upload): the snapshot too", async () => {
    const { client } = await renderGate();
    seedPlanReads(client);
    state.refusal = refusal(422, "QUOTA_EXCEEDED");
    fireEvent.click(screen.getByRole("button", { name: "Quota write" }));
    await screen.findByText("refused");
    await waitFor(() => expect(invalidated(client, COMPANY_QUOTAS_KEY)).toBe(true));
    expect(invalidated(client, COMPANY_ENTITLEMENT_KEY)).toBe(true);
    expect(invalidated(client, COMPANY_SUBSCRIPTION_KEY)).toBe(true);
  });

  it("READ_ONLY whose reasons the list row does not hold re-reads the list too, so the marker can appear", async () => {
    const { client } = await renderGate();
    seedPlanReads(client);
    await waitFor(() => expect(state.listCalls).toBe(1));
    state.refusal = refusal(403, "READ_ONLY", ["PAYMENT_DISPUTE"]);
    fireEvent.click(screen.getByRole("button", { name: "Plain write" }));
    await screen.findByText("refused");
    await waitFor(() => expect(state.listCalls).toBe(2));
    expect(invalidated(client, COMPANY_ENTITLEMENT_KEY)).toBe(true);
  });

  it("a refusal of another kind re-reads nothing", async () => {
    const { client } = await renderGate();
    seedPlanReads(client);
    state.refusal = refusal(409, "INVALID_STATE");
    fireEvent.click(screen.getByRole("button", { name: "Quota write" }));
    await screen.findByText("refused");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(false);
  });
});

describe("a Tenant answer that moved re-reads the plan (B4)", () => {
  const readCompany = (client: QueryClient) =>
    act(async () => {
      await client.fetchQuery({ ...companyTenantOptions(NORTHWIND), staleTime: 0 });
    });

  it("the first answer is not «moved»; the same answer again is not either; a new version or new restrictions are", async () => {
    const { client } = await renderGate();
    seedPlanReads(client);

    await readCompany(client);
    expect(state.tenantCalls).toBe(1);
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(false);

    await readCompany(client);
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(false);

    state.version = "4";
    await readCompany(client);
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(true);

    seedPlanReads(client);
    state.restrictions = ["OVER_QUOTA"];
    await readCompany(client);
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(true);
  });

  it("the same restrictions in another order did not move", async () => {
    state.restrictions = ["OWNER_PAUSE", "PAYMENT_DISPUTE"];
    const { client } = await renderGate();
    await readCompany(client);
    seedPlanReads(client);
    state.restrictions = ["PAYMENT_DISPUTE", "OWNER_PAUSE"];
    await readCompany(client);
    for (const queryKey of PLAN_READS) expect(invalidated(client, queryKey)).toBe(false);
  });
});

describe("a definite answer is not asked again", () => {
  it("another company's answer is an answer: retryUnanswered does not retry it (guard M12)", () => {
    expect(retryUnanswered(0, new ForeignCompanyAnswerError())).toBe(false);
    // The rule it sits beside: an answer that never came, once.
    expect(retryUnanswered(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it.each([
    ["a definite refusal", () => refusal(403, "SCOPE_DENIED")],
    ["another company's answer", () => new ForeignCompanyAnswerError()],
  ])("%s of the company, read again by an invalidation while the marker is mounted, is asked once (release-reviewer L-2)", async (_case, failure) => {
    // The app's own client: its default retries once, which is what the
    // marker's observer used to hand the query.
    const client = createQueryClient();
    const harness = companiesHarness({ companyId: NORTHWIND, path: "/projects" });
    function Page() {
      useQuery(companyTenantOptions(NORTHWIND));
      return null;
    }
    function Marker() {
      return <span>{useCompanyMarker(NORTHWIND) ?? "no marker"}</span>;
    }
    render(
      <QueryClientProvider client={client}>
        <Page />
        <Marker />
      </QueryClientProvider>,
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(client.getQueryState(companyTenantKey(NORTHWIND))?.status).toBe("success"));
    // The marker has drawn again since — the list answered — so its observer's options were the last set.
    await waitFor(() => expect(state.listCalls).toBe(1));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    state.tenantCalls = 0;
    state.tenantFailure = failure();
    await act(async () => {
      await client.invalidateQueries({ queryKey: companyTenantKey(NORTHWIND) });
    });
    expect(client.getQueryState(companyTenantKey(NORTHWIND))?.fetchStatus).toBe("idle");
    expect(state.tenantCalls).toBe(1);
    expect(screen.getByText("no marker")).toBeInTheDocument();
  });
});
