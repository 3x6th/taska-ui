import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isWorkspaceClosed, refusalCode, refusalReasons } from "../api/errors";
import type { WorkspaceClosedEvent } from "../api/TaskaApi";
import { TRANSPORT_FAILURE_REASON } from "../api/TaskaApi";
import type { Tenant } from "../api/tenants";
import {
  COMPANIES_ROUTE,
  chooseCompanyRoute,
  companyRoute,
  documentTitleFor,
  inCompanyRest,
  markRefusedThisVisit,
  refusedThisVisit,
} from "../lib/companies";
import { useCompanies, useCompanyName, useDocumentTitle, useWorkspace } from "../hooks/useCompanies";
import { createQueryClient } from "../lib/queryClient";
import { CompanyClosedScreen, CompanyUnavailableScreen } from "../screens/CompanyClosedScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { useCompanyAddress } from "../lib/companyAddress";

/*
 * The company session of a tab (TAS-500): the address names a company, this
 * gate makes it the tab's — `enterCompany` — and gives everything under it a
 * query client of that session's own (DESIGN.md §6). A refusal of the entry,
 * or the company closing mid-work, replaces everything under it with §4.35 or
 * §4.18 at the same address; nothing of the company's cache survives it.
 */

type Entry =
  | { status: "entering" }
  | { status: "open" }
  /** `retrying`: «Try again» is out, and the screen stays until it is answered (§4.18). */
  | { status: "refused"; error: unknown; retrying?: boolean }
  | { status: "closed"; event: WorkspaceClosedEvent; retrying?: boolean };

interface SessionClient {
  /** The company session this client is for; `null` while it is being made (the client is made for it). */
  sessionId: string | null;
  client: ReturnType<typeof createQueryClient>;
  generation: number;
}

/** A client made for the session the tab is entering, or for the one it holds. */
const newSessionClient = (sessionId: string | null, generation: number): SessionClient => ({
  sessionId,
  client: createQueryClient(),
  generation,
});

export function CompanyGate({ onLogout, logoutPending }: { onLogout: () => void; logoutPending: boolean }) {
  const address = useCompanyAddress();
  const companyId = address?.companyId ?? "";
  const workspace = useWorkspace();
  const name = useCompanyName(companyId);
  const [entry, setEntry] = useState<Entry>({ status: "entering" });
  const [attempt, setAttempt] = useState(0);
  const liveSessionId = workspace?.tenantId === companyId ? workspace.tenantSessionId : null;
  const [session, setSession] = useState<SessionClient>(() => newSessionClient(liveSessionId, 0));

  // In the layout phase, before any screen under the gate asks anything: the
  // switch begins here, and every request the screens make from now on is
  // this company's (`WebSessionClient.enterCompany`). One call per company and
  // attempt; asked twice — StrictMode — it is one transition.
  useLayoutEffect(() => {
    let current = true;
    taskaApi.enterCompany(companyId).then(
      () => {
        if (current) setEntry({ status: "open" });
      },
      (error: unknown) => {
        if (!current || isWorkspaceClosed(error)) return;
        if (refusalCode(error) === "MEMBERSHIP_INACTIVE") markRefusedThisVisit(companyId);
        setEntry({ status: "refused", error });
      },
    );
    return () => {
      current = false;
    };
  }, [companyId, attempt]);

  useEffect(
    () =>
      taskaApi.onWorkspaceClosed((event) => {
        if (event.tenantId !== companyId) return;
        if (event.reason === "MEMBERSHIP_INACTIVE") markRefusedThisVisit(companyId);
        setEntry({ status: "closed", event });
      }),
    [companyId],
  );

  // One client per company session (§6): the one made while the session was
  // being made is that session's; a re-selected session — a new id for the
  // same company — is a new context, and a closed company keeps nothing.
  if (liveSessionId !== null && session.sessionId === null) {
    setSession({ ...session, sessionId: liveSessionId });
  } else if (liveSessionId !== null && session.sessionId !== liveSessionId) {
    setSession(newSessionClient(liveSessionId, session.generation + 1));
  } else if ((entry.status === "closed" || entry.status === "refused") && session.sessionId !== null) {
    setSession(newSessionClient(null, session.generation + 1));
  }

  // The client a session has left is cancelled and cleared: none of its reads
  // may be retried under the next session's credential.
  // Keyed by the client, not the record: adopting the session id the client was
  // made for keeps the client, and must not clear it under its own readers.
  // Deferred a tick and called off when the same client comes straight back —
  // StrictMode's rehearsal unmount — so only a client really left is cleared.
  const sessionQueryClient = session.client;
  const pendingClear = useRef<{ client: typeof sessionQueryClient; timer: number } | null>(null);
  useEffect(() => {
    if (pendingClear.current?.client === sessionQueryClient) {
      window.clearTimeout(pendingClear.current.timer);
      pendingClear.current = null;
    }
    return () => {
      const timer = window.setTimeout(() => {
        void sessionQueryClient.cancelQueries();
        sessionQueryClient.clear();
      }, 0);
      pendingClear.current = { client: sessionQueryClient, timer };
    };
  }, [sessionQueryClient]);

  useDocumentTitle(documentTitleFor({ companyName: name, inCompany: true, picker: false }));

  const retry = () => {
    setEntry((value) => (value.status === "refused" || value.status === "closed" ? { ...value, retrying: true } : value));
    setAttempt((value) => value + 1);
  };

  if (entry.status === "closed") {
    const { event } = entry;
    if (event.reason === "TENANT_NOT_FOUND") return <NotFoundScreen />;
    if (event.reason === TRANSPORT_FAILURE_REASON) {
      return <CompanyUnavailableScreen error={null} name={name} onRetry={retry} retrying={entry.retrying ?? false} />;
    }
    return (
      <CompanyClosedScreen
        logoutPending={logoutPending}
        name={name}
        onLogout={onLogout}
        refusal={{ code: event.reason, reasons: event.reasons, message: null }}
      />
    );
  }
  if (entry.status === "refused") {
    const { error } = entry;
    const { status, code, message } = apiErrorFacts(error);
    const b2bCode = refusalCode(error);
    if (b2bCode === "TENANT_NOT_FOUND" || b2bCode === "RESOURCE_NOT_FOUND" || status === 404) return <NotFoundScreen />;
    if (status === null || status >= 500 || status === 408 || status === 429) {
      return <CompanyUnavailableScreen error={error} name={name} onRetry={retry} retrying={entry.retrying ?? false} />;
    }
    return (
      <CompanyClosedScreen
        logoutPending={logoutPending}
        name={name}
        onLogout={onLogout}
        refusal={{ code: b2bCode ?? code, reasons: refusalReasons(error), message }}
      />
    );
  }

  return (
    <QueryClientProvider client={session.client} key={session.generation}>
      <Outlet />
    </QueryClientProvider>
  );
}

/**
 * An in-company page asked for without a company (§5.1): the same path in the
 * tab's company; a tab without one — the `taska.lastCompany` hint when it is
 * in the list, else the one company of the first group, else the picker with
 * the address remembered (§4.33 «Когда»). Nothing is drawn meanwhile: the
 * page is a plane of `--bg` until it is known where it opens.
 */
export function ResolveCompanyAddress() {
  const location = useLocation();
  const address = useCompanyAddress();
  const companies = useCompanies();
  const [tabCompany, setTabCompany] = useState<{ settled: boolean; companyId: string | null }>({ settled: false, companyId: null });
  const path = `${location.pathname}${location.search}`;
  const rest = inCompanyRest(path);

  useEffect(() => {
    let current = true;
    void taskaApi.settleWorkspace().then(
      (workspace) => current && setTabCompany({ settled: true, companyId: workspace?.tenantId ?? null }),
      () => current && setTabCompany({ settled: true, companyId: null }),
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!address || !tabCompany.settled || rest === null) return;
    if (tabCompany.companyId !== null) {
      address.go(companyRoute(tabCompany.companyId, rest), { replace: true, state: { withoutCompany: true } });
      return;
    }
    if (companies.isError) {
      address.go(COMPANIES_ROUTE, { replace: true, state: { from: rest } });
      return;
    }
    if (!companies.data) return;
    const choice = chooseCompanyRoute({
      remembered: rest,
      hint: taskaApi.lastCompanyHint(),
      tenants: companies.data as Tenant[],
      refusedThisVisit: refusedThisVisit(),
    });
    if ("route" in choice) address.go(choice.route, { replace: true, state: { withoutCompany: true } });
    else address.go(COMPANIES_ROUTE, { replace: true, state: { from: choice.from } });
  }, [address, companies.data, companies.isError, rest, tabCompany]);

  if (rest === null) return <NotFoundScreen />;
  return (
    <main className="company-pending">
      <p className="visually-hidden" role="status">
        Opening Taska
      </p>
    </main>
  );
}
