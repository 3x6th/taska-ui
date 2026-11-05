import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isWorkspaceClosed, refusalCode, refusalReasons } from "../api/errors";
import type { WorkspaceClosedEvent, WorkspacePendingEvent, WorkspaceRestrictedEvent } from "../api/TaskaApi";
import { TRANSPORT_FAILURE_REASON } from "../api/TaskaApi";
import type { Tenant } from "../api/tenants";
import {
  COMPANIES_ROUTE,
  TENANTS_QUERY_KEY,
  chooseCompanyRoute,
  companyRoute,
  documentTitleFor,
  inCompanyRest,
  isNeverOpened,
  markRefusedThisVisit,
  refusedThisVisit,
} from "../lib/companies";
import { useCompanies, useCompanyName, useDocumentTitle, useWorkspace } from "../hooks/useCompanies";
import type { Theme } from "../hooks/useTheme";
import { createQueryClient } from "../lib/queryClient";
import { CompanyClosedScreen, CompanyUnavailableScreen } from "../screens/CompanyClosedScreen";
import { CompanySetupScreen } from "../screens/CompanySetupScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { useAccountQueryClient, useCompanyAddress } from "../lib/companyAddress";
import type { CompaniesRouteState } from "../screens/CompaniesScreen";

/*
 * The company session of a tab (TAS-500): the address names a company, this
 * gate makes it the tab's — `enterCompany` — and gives everything under it a
 * query client of that session's own (DESIGN.md §6). A refusal of the entry,
 * or the company closing mid-work, replaces everything under it with §4.35 or
 * §4.18 at the same address; nothing of the company's cache survives it.
 *
 * A company that has never opened (TAS-501, §4.37) — its list row says so, or
 * its entry or a content read was refused for it — draws the never-opened card
 * on any path under the prefix instead of the app shell, **without closing
 * the company or revoking its session**. On a tab's first screen the list is
 * waited for before anything of the company is drawn, so a pending company
 * never shows the app shell for a frame.
 *
 * A paused or blocked company whose content a read found closed (TAS-504,
 * api-contract-guard B2, §4.35) keeps its session and its cache: §4.35's
 * statement replaces only the content routes — Projects, a board, an issue,
 * `/browse/…` — and never Settings, where its owner can resume it. A `Tenant`
 * answer without the pause or the block, or a content read that answers,
 * lifts the mark (`onWorkspaceRestricted`).
 */

/** The routes of a company's project content (§4.35), as the router inside the prefix sees them. */
const isContentRoute = (pathname: string) =>
  pathname === "/projects" || pathname.startsWith("/projects/") || pathname.startsWith("/browse/");

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

export function CompanyGate({
  onLogout,
  logoutPending,
  theme,
  toggleTheme,
}: {
  onLogout: () => void;
  logoutPending: boolean;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const address = useCompanyAddress();
  const location = useLocation();
  const accountClient = useAccountQueryClient();
  const go = address?.go;
  const companyId = address?.companyId ?? "";
  const workspace = useWorkspace();
  const name = useCompanyName(companyId);
  const companies = useCompanies();
  const row = companies.data?.find((tenant) => tenant.id === companyId) ?? null;
  const [entry, setEntry] = useState<Entry>({ status: "entering" });
  /** A content read refused because the company has never opened (B4) — the card, and the session kept. */
  const [pending, setPending] = useState<WorkspacePendingEvent | null>(null);
  /** A content read refused for a pause or a block (TAS-504, B2) — §4.35 on the content routes, the session kept. */
  const [restricted, setRestricted] = useState<WorkspaceRestrictedEvent | null>(null);
  // Whose company it is, for §4.35's owner variant: the list row's `ownerId`
  // against the account, read only once there is something to say.
  const me = useQuery(
    { queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser(), enabled: restricted !== null && accountClient !== null },
    accountClient ?? undefined,
  );
  /** The card handed the address over and the shell's first read bounced back: the card stays (no loop). */
  const handedOver = useRef(false);
  const [bounced, setBounced] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const liveSessionId = workspace?.tenantId === companyId ? workspace.tenantSessionId : null;
  const [session, setSession] = useState<SessionClient>(() => newSessionClient(liveSessionId, 0));

  // In the layout phase, before any screen under the gate asks anything: the
  // switch begins here, and every request the screens make from now on is
  // this company's (`WebSessionClient.enterCompany`). One call per company and
  // attempt; asked twice — StrictMode — it is one transition.
  /**
   * Whether this mount has begun its switch (`enterCompany` called). Nothing
   * under the gate renders before it: a screen may ask the server *while
   * rendering* — the issue panel's prefetch of comments and work log — and a
   * request asked before the switch begins is the previous company's, which
   * the switch discards (release-reviewer H1). Set in the same layout effect,
   * so the company renders in the commit after, before the browser paints.
   */
  const [begun, setBegun] = useState(false);
  useLayoutEffect(() => {
    let current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the switch has begun: render the company now, still before paint.
    setBegun(true);
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

  // A leave whose answer was lost, and then the server saying the reader is no
  // longer a member (TAS-502, api-contract-guard B-1): the reader left — the
  // picker with «You left {Company}.», as after an answered leave, never §4.35.
  useEffect(
    () =>
      taskaApi.onWorkspaceLeft((event) => {
        if (event.tenantId !== companyId) return;
        void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
        go?.(COMPANIES_ROUTE, {
          replace: true,
          state: { focusHeading: true, left: { name: event.tenantName } } satisfies CompaniesRouteState,
        });
      }),
    [companyId, accountClient, go],
  );

  useEffect(
    () =>
      taskaApi.onWorkspaceRestricted((event) => {
        if (event.tenantId !== companyId) return;
        setRestricted(event.restricted ? event : null);
      }),
    [companyId],
  );

  useEffect(
    () =>
      taskaApi.onWorkspacePending((event) => {
        if (event.tenantId !== companyId) return;
        setPending(event);
        if (handedOver.current) setBounced(true);
        handedOver.current = false;
      }),
    [companyId],
  );

  // The server opened a company the tab could not enter (D216's late
  // payment, read through the list): enter it now. Only on that change — a
  // refusal never retries by itself.
  const rowLifecycle = row?.lifecycle ?? null;
  const shownLifecycle = useRef(rowLifecycle);
  useEffect(() => {
    const was = shownLifecycle.current;
    shownLifecycle.current = rowLifecycle;
    if (was === rowLifecycle || !isNeverOpened(was) || isNeverOpened(rowLifecycle) || rowLifecycle === null) return;
    if (entry.status !== "refused") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list says it opened: enter, as «Try again» would.
    setEntry({ status: "entering" });
    setAttempt((value) => value + 1);
  }, [rowLifecycle, entry.status]);

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
        refusal={{ code: event.reason, reasons: event.reasons, message: event.message, requestId: event.requestId }}
        tenant={row}
      />
    );
  }
  const neverOpened = isNeverOpened(rowLifecycle);
  // On the session's own query client, like the pages: the card's reads go
  // with this company's session and are gone with it.
  const setupCard = (access: "open" | "entering" | "none") => (
    <QueryClientProvider client={session.client} key={session.generation}>
      <CompanySetupScreen
        companyId={companyId}
        mayOpen={!bounced}
        onOpened={() => {
          setPending(null);
          handedOver.current = true;
        }}
        pending={pending}
        row={row}
        session={access}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    </QueryClientProvider>
  );

  if (entry.status === "refused") {
    const { error } = entry;
    const { status, code, message, requestId } = apiErrorFacts(error);
    const b2bCode = refusalCode(error);
    // No answer, or one that says nothing about the company (5xx, 408, 429):
    // «could not be opened» with «Try again» — never-opened or not, since the
    // card without a session could only offer what would be refused
    // (release-reviewer N1).
    const transient = status === null || status >= 500 || status === 408 || status === 429;
    if (transient) {
      return <CompanyUnavailableScreen error={error} name={name} onRetry={retry} retrying={entry.retrying ?? false} />;
    }
    // Never opened (§4.37): the list row says so, or the refusal does — and
    // not a lapsed membership, which is §4.35's.
    const refusedPending = b2bCode === "PAYMENT_PENDING" || refusalReasons(error).includes("PENDING_FIRST_PAYMENT");
    if (b2bCode !== "MEMBERSHIP_INACTIVE" && (neverOpened || refusedPending)) return setupCard("none");
    // The only thing an entry sends is the company id from the address, so a
    // `VALIDATION_FAILED` is about that id (`/c/not-a-uuid/…`): §4.18, and the
    // server's words about a «tenantId» never reach the screen (§4.35).
    if (b2bCode === "TENANT_NOT_FOUND" || b2bCode === "RESOURCE_NOT_FOUND" || b2bCode === "VALIDATION_FAILED" || status === 404) {
      return <NotFoundScreen />;
    }
    return (
      <CompanyClosedScreen
        logoutPending={logoutPending}
        name={name}
        onLogout={onLogout}
        refusal={{ code: b2bCode ?? code, reasons: refusalReasons(error), message, requestId }}
        tenant={row}
      />
    );
  }

  if (!begun) return null;
  const liveSession = entry.status === "open" && workspace?.tenantId === companyId ? "open" : "entering";
  if (neverOpened || pending !== null) return setupCard(liveSession);
  if (restricted !== null && isContentRoute(location.pathname)) {
    // The owner's words need the account: until it answers, the plane (§4.35's
    // column pops in once, with the right text).
    if (me.isPending && !me.isError) {
      return (
        <main className="company-pending">
          <p className="visually-hidden" role="status">
            Opening Taska
          </p>
        </main>
      );
    }
    return (
      <CompanyClosedScreen
        logoutPending={logoutPending}
        name={name}
        onLogout={onLogout}
        owner={row !== null && me.data?.id !== undefined && row.ownerId === me.data.id}
        refusal={{ code: "CAPABILITY_DISABLED", reasons: restricted.reasons, message: null, requestId: restricted.requestId }}
        tenant={row}
      />
    );
  }
  // A tab's first screen: the list decides whether this is the app shell at all.
  if (row === null && companies.isPending) {
    return (
      <main className="company-pending">
        <p className="visually-hidden" role="status">
          Opening Taska
        </p>
      </main>
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
