import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isWorkspaceClosed, refusalCode } from "../api/errors";
import { clearTenantCreation, creationOf, newIdempotencyKey } from "../api/tenantCreation";
import type { WorkspacePendingEvent } from "../api/TaskaApi";
import type { Tenant } from "../api/tenants";
import { AuthShell } from "../components/AuthShell";
import { AddressLink } from "../components/CompanyRouter";
import { ErrorNote } from "../components/ErrorNote";
import { useCompanies, useCompanyName, usePrefetchPlans } from "../hooks/useCompanies";
import { useMutation } from "../hooks/useMutation";
import type { Theme } from "../hooks/useTheme";
import {
  COMPANIES_ROUTE,
  CREATE_COMPANY_ROUTE,
  TENANTS_QUERY_KEY,
  isContinuedShell,
  isNeverOpened,
  upsertTenant,
} from "../lib/companies";
import { useAccountQueryClient, useAppPath } from "../lib/companyAddress";
import type { CompanyReadyState, CreateCompanyRouteState } from "./CreateCompanyScreen";
import { CreationPaySlot } from "./company/CreationPaySlot";
import type { CheckoutReturnState } from "./billingReturn";
import {
  CANCELLED_TEXT,
  CANCEL_PAYMENT_PENDING_TEXT,
  CANCEL_QUESTION,
  CANCEL_REFUSED_TEXT,
  CANCEL_STALE_TEXT,
  CANCEL_ZONE_TEXT,
  MANUAL_REVIEW_TEXT,
  POLL_LIMIT_MS,
  PROVISIONING_SLOW_TEXT,
  PROVISIONING_TEXT,
  SETUP_FAILED_TEXT,
  SETUP_READ_FAILED_TEXT,
  SLOW_SETUP_MS,
  autoClosedText,
  awaitingPaymentText,
  isTerminalOperation,
  pollDelay,
  setupStateLine,
  type DeadlineSentence,
} from "./companySetupText";

/** The longest `setTimeout` a browser keeps (2^31 − 1 ms, ~24.8 days); a later deadline is re-armed on the next read. */
const MAX_TIMER_MS = 2_147_483_647;

/** Whether the tab holds this company's session: the card reads the company with it, else from the list (§4.37). */
export type SetupSession = "open" | "entering" | "none";

function DeadlineText({
  sentence,
  iso,
  className,
  "data-passed": passed,
}: {
  sentence: DeadlineSentence;
  iso: string | null;
  className: string;
  "data-passed"?: boolean;
}) {
  return (
    <p className={className} data-passed={passed}>
      {sentence.before}
      {sentence.deadline !== null && iso !== null ? <time dateTime={iso}>{sentence.deadline}</time> : null}
      {sentence.after}
    </p>
  );
}

/**
 * DESIGN.md §4.37 «Компания до открытия» (TAS-501): a company that has never
 * opened — being set up, awaiting its first payment, cancelled, or closed
 * without it — drawn at its own address, on any path under the prefix, in
 * the sign-in card's shell rather than the app's. No working feature exists
 * here in any form (no Projects, invitations, search or bell): the server
 * does not serve them (contracts §5, D208).
 *
 * Everything is the server's: the lifecycle (`getTenant` with this company's
 * session, else the reader's list), the deadline (`creationDeadline` as
 * sent), and every change of state — the card re-reads, it never decides.
 * While a company is being set up the creation's operation is polled, one
 * request per tick (1, 2, 4, 8 s, then 10 s), paused in a hidden tab, stopped
 * after 5 minutes; awaiting payment, it is read on arrival, on return to the
 * tab and once when the local clock passes the deadline.
 */
export function CompanySetupScreen({
  companyId,
  row,
  pending,
  session,
  onOpened,
  mayOpen = true,
  theme,
  toggleTheme,
}: {
  companyId: string;
  /** The company's row in the reader's list, when it has one. */
  row: Tenant | null;
  /** The content refusal that brought the tab here, when one did. */
  pending: WorkspacePendingEvent | null;
  session: SetupSession;
  /** The server answered that the company opened: the shell takes over. */
  onOpened: () => void;
  /**
   * `false` once a hand-over bounced — the shell opened, and its first read was
   * refused as not open again. The card then stays, so a server that says both
   * things at once costs one round trip, not a loop.
   */
  mayOpen?: boolean;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const appPath = useAppPath();
  const sessionClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const companies = useCompanies();
  const me = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() }, accountClient ?? undefined);
  const listedName = useCompanyName(companyId);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  /**
   * The cancel request as first sent — its key and the version it carried. Kept
   * across an outcome that is not known (no answer, 5xx, 408, 429), so the next
   * press repeats exactly that request; a definitive answer ends it.
   */
  const cancelAttempt = useRef<{ key: string; version: string } | null>(null);
  const stripId = useId();
  /** The payment slot's fact, which the heading is described by after a return from the payment page (TAS-513, B11). */
  const payFactId = useId();
  const [returnedFromPayment] = useState(() => (location.state as CheckoutReturnState | null)?.checkoutReturn === true);
  /** The slot saw its invoice PAID: the company's opening is the one this card hands over with «{Company} is ready.». */
  const paidHere = useRef(false);
  const [continued] = useState(() => isContinuedShell(location.state));
  const [arrivedFromApp] = useState(
    () =>
      isContinuedShell(location.state) ||
      (typeof location.state === "object" && location.state !== null && (location.state as { focusHeading?: unknown }).focusHeading === true) ||
      returnedFromPayment,
  );
  /** The creation this tab made, while its operation may still be polled (`src/api/tenantCreation.ts`). */
  const [creation] = useState(() => {
    try {
      return creationOf(window.sessionStorage, companyId);
    } catch {
      return null;
    }
  });
  const operationId = creation?.operationId ?? null;
  const canRead = session === "open";

  // The company as the server has it now: read with its session on arrival,
  // on every return to the tab, and — while it is being set up without an
  // operation to follow — at the polling cadence.
  const [pollStarted, setPollStarted] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  /**
   * TAS-513 (release-reviewer N1): the payment slot saw its invoice PAID while
   * the company still reads AWAITING_PAYMENT — when, and how many reads of the
   * company there had been. The company is then read at the setup cadence
   * until it opens, for `POLL_LIMIT_MS`, then «Check again».
   */
  const [paidSeen, setPaidSeen] = useState<{ at: number; reads: number } | null>(null);
  const [paidStalled, setPaidStalled] = useState(false);
  /** How many times the company has been read on this card's client — `pollDelay`'s count. */
  const tenantReads = () => {
    const query = sessionClient.getQueryState(["tenant", companyId]);
    return query ? query.dataUpdateCount + query.errorUpdateCount : 0;
  };
  const tenantQuery = useQuery({
    queryKey: ["tenant", companyId],
    queryFn: () => taskaApi.getTenant(companyId),
    enabled: canRead,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => {
      const lifecycle = query.state.data?.lifecycle ?? row?.lifecycle ?? null;
      const reads = query.state.dataUpdateCount + query.state.errorUpdateCount;
      // Paid, not yet opened (N1): read until the server opens it.
      if (lifecycle === "AWAITING_PAYMENT" && paidSeen !== null) {
        // The slot's own re-read is the first after `paidSeen`: the cadence starts at 1 s after it.
        return Date.now() - paidSeen.at >= POLL_LIMIT_MS ? false : pollDelay(Math.max(0, reads - paidSeen.reads - 1));
      }
      if (lifecycle !== "PROVISIONING" || operationId !== null || Date.now() - pollStarted >= POLL_LIMIT_MS) return false;
      return pollDelay(reads - 1);
    },
  });
  const tenant: Tenant | null = tenantQuery.data ?? row;
  // Until the company answers, a content refusal's reason is what is known:
  // `PENDING_FIRST_PAYMENT` is «awaiting first payment» in the server's words.
  const lifecycle =
    tenantQuery.data?.lifecycle ?? (pending !== null && !isNeverOpened(row?.lifecycle) ? "AWAITING_PAYMENT" : (row?.lifecycle ?? null));
  const provisioning = lifecycle === "PROVISIONING";

  // The creation's operation, one read per tick from 1 s on — never the
  // state a replayed 202 claimed (ask A12).
  const [operationDue, setOperationDue] = useState(false);
  useEffect(() => {
    if (!provisioning || operationId === null || !canRead) return;
    const timer = window.setTimeout(() => setOperationDue(true), pollDelay(0));
    return () => window.clearTimeout(timer);
  }, [provisioning, operationId, canRead]);
  const operationQuery = useQuery({
    queryKey: ["tenant-operation", companyId, operationId],
    queryFn: () => taskaApi.getTenantOperation(companyId, operationId as string),
    enabled: canRead && provisioning && operationId !== null && operationDue,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (isTerminalOperation(query.state.data?.state ?? null) || Date.now() - pollStarted >= POLL_LIMIT_MS) return false;
      return pollDelay(query.state.dataUpdateCount + query.state.errorUpdateCount);
    },
  });
  const operation = operationQuery.data ?? null;
  const operationEnded = isTerminalOperation(operation?.state ?? null);

  // A terminal operation: the company is read once more, and followed.
  useEffect(() => {
    if (operationEnded && canRead) void tenantQuery.refetch();
    // Once per end of the operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationEnded, canRead]);

  // Five minutes of setup: the polling stops and «Check again» is offered.
  useEffect(() => {
    if (!provisioning || operationEnded) return;
    const left = POLL_LIMIT_MS - (Date.now() - pollStarted);
    const timer = window.setTimeout(() => setTimedOut(true), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [provisioning, operationEnded, pollStarted]);

  // The paid company's poll stops after 5 minutes: «Check again» in the slot (N1).
  useEffect(() => {
    if (paidSeen === null) return;
    const timer = window.setTimeout(() => setPaidStalled(true), Math.max(0, POLL_LIMIT_MS - (Date.now() - paidSeen.at)));
    return () => window.clearTimeout(timer);
  }, [paidSeen]);

  // After 30 s on «Being set up», the sentence changes (§4.37).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!provisioning) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_SETUP_MS);
    return () => window.clearTimeout(timer);
  }, [provisioning]);

  // Awaiting payment: once more when the local clock passes the deadline.
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const deadline = tenant?.creationDeadline ?? null;
  useEffect(() => {
    if (lifecycle !== "AWAITING_PAYMENT" || deadline === null) return;
    const left = Date.parse(deadline) - Date.now();
    // Passed already, or too far for a timer: the sentence reads the clock itself.
    if (Number.isNaN(left) || left <= 0 || left > MAX_TIMER_MS) return;
    const timer = window.setTimeout(() => {
      setDeadlinePassed(true);
      if (canRead) void tenantQuery.refetch();
    }, left);
    return () => window.clearTimeout(timer);
    // The query object is stable enough; a new deadline re-arms the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle, deadline, canRead]);

  // Without the company's session (closed ones are refused it): the reader's
  // list is read again on arrival and on every return to the tab.
  // `cancelRefetch: false`: a return fires both visibilitychange and focus, and
  // the second joins the read the first started — one request, not two.
  useEffect(() => {
    if (canRead) return;
    void companies.refetch({ cancelRefetch: false });
    const onReturn = () => {
      if (document.visibilityState === "visible") void companies.refetch({ cancelRefetch: false });
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
    // On arrival and on return, not on every list answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  // Each answer of the server goes into the reader's list (the picker and the
  // switcher follow it), closes the creation's record once nothing is left to
  // poll, and — when the company opened — hands the address to the app shell.
  const answered = tenantQuery.data ?? null;
  const previousLifecycle = useRef<string | null>(row?.lifecycle ?? null);
  /** Answers read while this card is on screen — a cached one from before it never hands the address over. */
  const [shownAt] = useState(() => Date.now());
  useEffect(() => {
    if (answered === null) return;
    accountClient?.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => upsertTenant(list, answered));
    const was = previousLifecycle.current;
    previousLifecycle.current = answered.lifecycle;
    if (answered.lifecycle !== "PROVISIONING" && answered.lifecycle !== "AWAITING_PAYMENT") {
      try {
        if (creationOf(window.sessionStorage, companyId)) clearTenantCreation(window.sessionStorage);
      } catch {
        // Nothing was kept.
      }
    }
    if (answered.lifecycle === "ACTIVE" && mayOpen && tenantQuery.dataUpdatedAt >= shownAt) {
      // Set up just now: the shell opens on Projects with «{Company} is ready.» (§4.36).
      if (was === "PROVISIONING" || (was === "AWAITING_PAYMENT" && paidHere.current)) {
        navigate(
          { pathname: location.pathname, search: location.search },
          { replace: true, state: { companyReady: true } satisfies CompanyReadyState },
        );
      }
      onOpened();
    }
    // Every answer read, the same data included: a refetch that finds the
    // company open hands over even when the cache already said so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, tenantQuery.dataUpdatedAt]);

  // The record outlives a terminal operation: a FAILED or MANUAL_REVIEW setup
  // leaves the company PROVISIONING, and `Tenant` carries no operation id
  // (ask A11) — so only the record lets a reload read the operation again
  // rather than poll a company that will not open (release-reviewer N2). It
  // goes when the company leaves PROVISIONING and awaiting payment, above.

  // Focus: the heading on arrival from inside the app, and whenever the state
  // changes on the spot (§7 exception 4); the first screen of a tab takes none.
  const stateKey = `${lifecycle ?? ""}:${operation?.state === "FAILED" ? "failed" : ""}`;
  const shownState = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (shownState.current === null) {
      shownState.current = stateKey;
      if (arrivedFromApp) heading.current?.focus();
      return;
    }
    if (shownState.current === stateKey) return;
    shownState.current = stateKey;
    heading.current?.focus();
  }, [stateKey, arrivedFromApp]);

  const owner = tenant !== null && tenant.ownerId !== null && me.data?.id === tenant.ownerId;
  const [asking, setAsking] = useState(false);
  const [cancelRefusal, setCancelRefusal] = useState<{ error: unknown; lifecycle: string | null; key: number } | null>(null);
  const cancel = useMutation({
    mutationFn: (sent: { key: string; version: string }) => taskaApi.cancelTenantCreation(companyId, sent.version, sent.key),
    onSuccess: (answer) => {
      cancelAttempt.current = null;
      setAsking(false);
      setCancelRefusal(null);
      sessionClient.setQueryData(["tenant", companyId], answer);
    },
    onError: (error) => {
      const { status } = apiErrorFacts(error);
      const unknown = status === null || status >= 500 || status === 408 || status === 429;
      if (!unknown) cancelAttempt.current = null;
      setAsking(false);
      setCancelRefusal((previous) => ({ error, lifecycle, key: (previous?.key ?? 0) + 1 }));
      cancelTrigger.current?.focus();
      // Whatever it was, the company is read again; a new state takes the card with it.
      if (canRead) void tenantQuery.refetch();
    },
  });
  const cancelling = cancel.isPending;
  const closeStrip = () => {
    if (cancelling) return;
    setAsking(false);
    cancelTrigger.current?.focus();
  };

  usePrefetchPlans(lifecycle === "OWNER_CANCELLED" || lifecycle === "AUTO_CLOSED");

  const name = tenant?.name ?? listedName;
  const stateLine = setupStateLine(lifecycle ?? (pending ? "AWAITING_PAYMENT" : null), operation?.state === "FAILED");
  const readFailure =
    tenantQuery.isError && !isWorkspaceClosed(tenantQuery.error) && tenantQuery.data === undefined ? tenantQuery.error : null;
  const now = new Date();

  const cancelWords = (error: unknown) => {
    const code = refusalCode(error);
    if (code === "PAYMENT_PENDING") return CANCEL_PAYMENT_PENDING_TEXT;
    if (apiErrorFacts(error).status === 412 || code === "VERSION_CONFLICT") return CANCEL_STALE_TEXT;
    return CANCEL_REFUSED_TEXT;
  };

  const createAgain = (
    <AddressLink
      className="primary-button auth-submit company-setup-create"
      path={CREATE_COMPANY_ROUTE}
      state={{ from: appPath, continuedShell: true } satisfies CreateCompanyRouteState}
    >
      Create a company
    </AddressLink>
  );

  let body = null;
  if (provisioning) {
    const failed = operation?.state === "FAILED";
    const sentence = failed
      ? ""
      : operation?.state === "MANUAL_REVIEW"
        ? MANUAL_REVIEW_TEXT
        : slow
          ? PROVISIONING_SLOW_TEXT
          : PROVISIONING_TEXT;
    body = (
      <>
        {/* One status line for the whole wait, mounted from the first frame, so each sentence is announced. */}
        <p className="auth-text company-setup-text" role="status">
          {sentence}
        </p>
        {failed ? (
          <ErrorNote
            live="polite"
            serverWords={[operation?.failureCode, operation ? `operation ${operation.id}` : null].filter(Boolean).join(" · ")}
          >
            {SETUP_FAILED_TEXT}
          </ErrorNote>
        ) : null}
        {timedOut && !operationEnded && !failed ? (
          <button
            className="auth-ghost"
            onClick={() => {
              setTimedOut(false);
              setPollStarted(Date.now());
              if (operationId !== null) void operationQuery.refetch();
              else void tenantQuery.refetch();
            }}
            type="button"
          >
            Check again
          </button>
        ) : null}
      </>
    );
  } else if (lifecycle === "AWAITING_PAYMENT") {
    const refusedHere = cancelRefusal !== null && cancelRefusal.lifecycle === lifecycle ? cancelRefusal : null;
    body = (
      <>
        {/* `deadlinePassed` re-renders the card when the clock passes it; the sentence reads the clock itself. */}
        <DeadlineText
          className="auth-text company-setup-text"
          data-passed={deadlinePassed || undefined}
          iso={deadline}
          sentence={awaitingPaymentText(deadline, now)}
        />
        {/* TAS-513 (art-director B2b): the owner's payment slot, with this
            company's session; nobody else has one to show. */}
        {owner && canRead && me.data?.id ? (
          <CreationPaySlot
            company={name}
            companyId={companyId}
            creationDeadline={deadline}
            factId={payFactId}
            onCheckAgain={() => {
              setPaidStalled(false);
              setPaidSeen({ at: Date.now(), reads: tenantReads() });
              void tenantQuery.refetch();
            }}
            onPaid={() => {
              paidHere.current = true;
              const reads = tenantReads();
              setPaidSeen((seen) => seen ?? { at: Date.now(), reads });
              void tenantQuery.refetch();
            }}
            stalled={paidStalled}
            userId={me.data.id}
          />
        ) : null}
        {/* The owner's, and only with this company's session: without one the
            request would go with the account's and be refused (release-reviewer N1). */}
        {owner && canRead && tenant?.version ? (
          <section aria-label="Cancel creation" className="company-cancel">
            <div className="company-cancel-row">
              <p className="company-cancel-note">{CANCEL_ZONE_TEXT}</p>
              <button
                aria-controls={asking ? stripId : undefined}
                aria-expanded={asking}
                className="secondary-button compact-button strip-trigger company-cancel-trigger"
                onClick={() => {
                  if (cancelling) return;
                  setCancelRefusal(null);
                  setAsking((open) => !open);
                }}
                ref={cancelTrigger}
                type="button"
              >
                Cancel creation
              </button>
            </div>
            {asking ? (
              // §4.22's strip: «Keep it» first and focused — not «Cancel», which beside «Cancel creation» would mean both.
              <div
                className="member-confirm company-cancel-confirm"
                id={stripId}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  closeStrip();
                }}
              >
                <p className="member-confirm-sentence" id={`${stripId}-sentence`}>
                  {CANCEL_QUESTION}
                </p>
                <div className="member-confirm-actions">
                  <button
                    aria-disabled={cancelling || undefined}
                    autoFocus
                    className="secondary-button compact-button"
                    onClick={closeStrip}
                    type="button"
                  >
                    Keep it
                  </button>
                  <button
                    aria-describedby={`${stripId}-sentence`}
                    aria-disabled={cancelling || undefined}
                    className="secondary-button compact-button member-confirm-accept"
                    onClick={() => {
                      if (cancelling) return;
                      cancelAttempt.current ??= { key: newIdempotencyKey(), version: tenant?.version ?? "" };
                      cancel.mutate(cancelAttempt.current);
                    }}
                    type="button"
                  >
                    Cancel creation
                  </button>
                </div>
              </div>
            ) : null}
            {refusedHere ? (
              <ErrorNote key={refusedHere.key} live="alert" requestId={apiErrorFacts(refusedHere.error).requestId}>
                {cancelWords(refusedHere.error)}
              </ErrorNote>
            ) : null}
          </section>
        ) : null}
      </>
    );
  } else if (lifecycle === "OWNER_CANCELLED") {
    body = (
      <>
        <p className="auth-text company-setup-text">{CANCELLED_TEXT}</p>
        {createAgain}
      </>
    );
  } else if (lifecycle === "AUTO_CLOSED") {
    body = (
      <>
        <DeadlineText className="auth-text company-setup-text" iso={deadline} sentence={autoClosedText(deadline, now)} />
        {createAgain}
      </>
    );
  }

  return (
    <AuthShell entrance={continued ? "none" : "app"} theme={theme} toggleTheme={toggleTheme}>
      <div className="company-setup">
        <h1
          aria-describedby={returnedFromPayment && owner ? payFactId : undefined}
          className="auth-title company-setup-title"
          ref={heading}
          tabIndex={-1}
        >
          <span className="company-setup-name">{name ?? "This company"}</span>
          {stateLine ? <span className="company-setup-state">{stateLine}</span> : null}
        </h1>
        {body}
        {readFailure ? (
          // The sentence and the id only: a server's title may say «tenant» (§4.33 «Слово»).
          <ErrorNote requestId={apiErrorFacts(readFailure).requestId}>{SETUP_READ_FAILED_TEXT}</ErrorNote>
        ) : null}
        <AddressLink
          className="auth-ghost company-setup-all"
          path={COMPANIES_ROUTE}
          state={{ focusHeading: true, continuedShell: true }}
        >
          All companies
        </AddressLink>
      </div>
    </AuthShell>
  );
}
