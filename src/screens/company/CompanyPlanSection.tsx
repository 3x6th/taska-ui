import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isWorkspaceClosed, refusalCode } from "../../api/errors";
import { isSendableVersion } from "../../api/tenantMembers";
import type { PlanVersion, Subscription, Tenant } from "../../api/tenants";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanies, useCompanyName, useWorkspace } from "../../hooks/useCompanies";
import { useMutation } from "../../hooks/useMutation";
import { TENANTS_QUERY_KEY, upsertTenant } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { planPriceText, plansQueryOptions } from "../../lib/plans";
import { ChangePlanModal, type PlanChangeOutcome } from "./ChangePlanModal";
import { COMPANY_SUBSCRIPTION_KEY, companySubscriptionOptions, companyTenantKey, companyTenantOptions } from "./companyGeneral";
import { formatPaidUntil, type RefusalWords } from "./companyGeneralText";
import { Strip } from "./CompanyMembersSection";
import {
  intentFor,
  pendingSuperseded,
  setPendingChange,
  settleIntent,
  usePendingChange,
  type PendingChange,
  type SubscriptionIntent,
} from "./companyPlanChange";
import {
  CHANGE_PLAN,
  OPEN_INVOICE_LINK,
  SCHEDULED_UNPAID_TEXT,
  cancelRenewalQuestion,
  cancelRenewalRowText,
  changePlanRowText,
  changedPlanLine,
  isUnanswered,
  pendingNoInvoiceText,
  pendingUntilText,
  planChangedStatus,
  renewalAlreadyCancelledStatus,
  renewalAlreadyOnStatus,
  renewalCancelledStatus,
  renewalEndedRowText,
  renewalResumedStatus,
  resumeRenewalRowText,
  scheduledInvoiceHead,
  scheduledInvoiceTail,
  scheduledPaymentText,
  scheduledTail,
  subscriptionRefusalWords,
  withdrawalStatus,
} from "./companyPlanChangeText";
import { COMPANY_QUOTAS_KEY } from "./companyMembersQuery";
import {
  BOUNDARY_AGAIN_MS,
  COMPANY_ENTITLEMENT_KEY,
  companyEntitlementOptions,
  companyPlanQuotasOptions,
  nextBoundary,
} from "./companyPlan";
import {
  CATALOGUE_READ_FAILED,
  ENTITLEMENT_READ_FAILED,
  NOT_IN_CATALOGUE,
  PLAN_LOADING_TEXT,
  PLAN_REFRESH_FAILED,
  STATE_READ_FAILED,
  SUBSCRIPTION_READ_FAILED,
  USAGE_READ_FAILED,
  autopayWord,
  planById,
  planLeadText,
  planNameParts,
  renewalNote,
  usageLines,
} from "./companyPlanText";
import { CompanyStateBlock } from "./CompanyStateBlock";

/**
 * Company › Plan (TAS-512, DESIGN.md §4.40, §5.10) — the B2B build only: the plan
 * the tab's company is on, what it uses, its restrictions, and for its owner
 * the money. Every role sees it; the page only reads.
 *
 * Against the B2B blueprint on the mock (docs/ai/API-DIVERGENCE.md
 * «TAS-512», api-contract-guard's design B1–B9, art-director's B1–B11):
 *
 * - **Owner or not** is `Tenant.ownerId` = the reader, nothing else (B4). The
 *   subscription — price, paid period, renewal, automatic payments, announced
 *   terms — is read only for the owner, and its rows are not in the DOM for
 *   anybody else (B1). A FREE owner simply has none of them to draw.
 * - **Numbers are the server's**: SEAT, PROJECT and STORAGE_BYTES from the
 *   snapshot, TASK_LIFETIME from the entitlement; the catalogue gives names
 *   and prices by id, and limits only for the owner's announced change (B2,
 *   B7). One template for any number (art-director B3).
 * - **Each read fails on its own** (B8, art-director B9): its `ErrorNote` where
 *   its rows would be, the other rows drawn; one «Try again» re-reads only
 *   what failed. Never «Free», «unlimited» or «0» for a read that failed.
 * - **Read again** only on B4's events — a `Tenant` answer that moved, a
 *   refused write (both in `CompanyGate`), and once at the owner's
 *   paid-through or scheduled date, again 60 s later. No poll.
 *
 * TAS-515 (art-director B1, B2, B5–B7, B13 with the orchestrator's
 * decisions): the owner's commands live in a zone at the end — «Change plan»
 * and the renewal — and nobody else's DOM has them. **No command is
 * optimistic**: rows change only from server reads, never from a command's
 * answer, whose subscription is never cached nor sent back as `If-Match`.
 * «Scheduled change» is the owner's own NEXT_PERIOD choice (A64); «Pending
 * change» exists only for an AFTER_PAYMENT answer of this session (A63).
 */
export function CompanyPlanSection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyPlan companyId={address.companyId} />;
}

const heading = () => document.querySelector<HTMLElement>(".settings-area .area-section-title");

/** Settled: answered or refused — a refusal is an outcome too (§4.40 «Загрузка»). */
const settled = (query: UseQueryResult<unknown>) => query.isSuccess || query.isError;
/** A read that failed with nothing to show: its own `ErrorNote`. */
const unread = (query: UseQueryResult<unknown>) => query.isError && query.data === undefined;
/** A read that failed again with its last answer still on screen: the page's one refresh notice. */
const stale = (query: UseQueryResult<unknown>) => query.isError && query.data !== undefined;

/** The page's five reads by name, in the page's order (§4.40). */
type ReadName = "tenant" | "entitlement" | "plans" | "subscription" | "quotas";
/** A read's failure as its `ErrorNote` draws it: the error (and with it the request id), and when it came. */
interface Failure {
  error: unknown;
  at: number;
}
/**
 * What the page draws of one read. Live, it is the query's own answer or
 * failure; while «Try again» is out it is the failure the press was made
 * against, so nothing the reader is looking at moves in flight (§4.40, the
 * build review's B1: TanStack puts a failed query without data back to
 * `pending` on a refetch, and drops its error).
 */
interface Drawn<T> {
  data: T | undefined;
  failure: Failure | null;
}
const drawnUnread = (read: Drawn<unknown>) => read.failure !== null && read.data === undefined;

function CompanyPlan({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const companies = useCompanies();
  const listedName = useCompanyName(companyId);
  const row = companies.data?.find((tenant) => tenant.id === companyId) ?? null;
  /**
   * «Try again» in flight: the failures it was pressed against, by read — each
   * failed read's `ErrorNote` keeps its error and request id, the rows that had
   * arrived stay, and the button stays where it was, until every re-read has
   * answered (§4.40 «Отказы чтения»). `null` when nothing is being re-read.
   */
  const [retrying, setRetrying] = useState<Partial<Record<ReadName, Failure>> | null>(null);
  const drawn = <T,>(name: ReadName, query: UseQueryResult<T>): Drawn<T> => {
    const kept = retrying?.[name];
    if (kept !== undefined) return { data: undefined, failure: kept };
    return { data: query.data, failure: query.isError ? { error: query.error, at: query.errorUpdatedAt } : null };
  };
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  const meId = me.data?.id ?? null;
  const tenantQuery = useQuery(companyTenantOptions(companyId));
  const tenantRead = drawn("tenant", tenantQuery);
  const tenant = tenantRead.data ?? null;
  // The company's answer decides; before it — or when it failed — the list
  // row, so the owner's five reads go out together (api-contract-guard §2).
  const ownerId = tenant !== null ? tenant.ownerId : (row?.ownerId ?? null);
  const owner = meId !== null && ownerId !== null && ownerId === meId;
  const entitlement = useQuery(companyEntitlementOptions(companyId));
  const quotas = useQuery(companyPlanQuotasOptions(companyId));
  // The public catalogue, on the account's client: usually there already (§4.36).
  const plans = useQuery(plansQueryOptions(taskaApi), accountClient ?? undefined);
  // The owner's read only, and never asked for anybody else (B1).
  const subscription = useQuery({ ...companySubscriptionOptions(companyId), enabled: owner });
  const entitlementRead = drawn("entitlement", entitlement);
  const quotasRead = drawn("quotas", quotas);
  const plansRead = drawn("plans", plans);
  const subscriptionRead = drawn("subscription", subscription);
  const company = tenant?.name ?? listedName;
  const sessionId = useWorkspace()?.tenantSessionId ?? null;
  const currentPlan =
    entitlementRead.data && plansRead.data ? planById(plansRead.data, entitlementRead.data.planVersionId) : null;
  // The answers' callbacks speak with the names on screen when they land.
  const companyRef = useRef(company);
  const currentRef = useRef<PlanVersion | null>(currentPlan);
  useEffect(() => {
    companyRef.current = company;
    currentRef.current = currentPlan;
  });

  /** Another owner now (TAS-504 G6): the list row follows the company, the owner's cache goes, and the tab re-enters it. */
  const followOwner = useCallback(
    async (answer: Tenant) => {
      accountClient?.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => (list ? upsertTenant(list, answer) : list));
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      queryClient.removeQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
      try {
        await taskaApi.reenterCompany(companyId);
      } catch {
        // The page follows the company either way.
      }
    },
    [accountClient, companyId, queryClient],
  );

  /** The company read again; `null` when it could not be. */
  const rereadTenant = useCallback(async (): Promise<Tenant | null> => {
    try {
      return await queryClient.fetchQuery({ ...companyTenantOptions(companyId), staleTime: 0 });
    } catch {
      return null;
    }
  }, [companyId, queryClient]);

  // 403 OWNER_REQUIRED (TAS-504 G6): who owns it is the re-read company's to
  // say; another owner now — the owner's cache goes and the tab re-enters.
  const ownerRefusedAt = refusalCode(subscription.error) === "OWNER_REQUIRED" ? subscription.errorUpdatedAt : 0;
  useEffect(() => {
    if (ownerRefusedAt === 0 || meId === null) return;
    let live = true;
    void (async () => {
      const reread = await rereadTenant();
      if (!live || reread === null || reread.ownerId === null || reread.ownerId === meId) return;
      await followOwner(reread);
    })();
    return () => {
      live = false;
    };
  }, [followOwner, meId, ownerRefusedAt, rereadTenant]);

  /* ------------------------------------------- the owner's commands (TAS-515) */

  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = useCallback((text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 })), []);
  const changeButton = useRef<HTMLButtonElement>(null);
  const renewalButton = useRef<HTMLButtonElement>(null);
  const pendingLink = useRef<HTMLAnchorElement>(null);
  /**
   * Where focus goes once the page has drawn an outcome: the button that was pressed, with its ring;
   * «refused» keeps the renewal button without a ring — and when a refusal's re-read took that button
   * away, «Change plan» with its ring (art-director blocker 5).
   */
  type FocusTarget = "change" | "renewal" | "refused" | "pending";
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; seq: number } | null>(null);
  const requestFocus = (target: FocusTarget) => setFocusRequest((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));
  useEffect(() => {
    if (focusRequest === null) return;
    const { target } = focusRequest;
    if (target === "refused" && renewalButton.current !== null) {
      renewalButton.current.focus();
      return;
    }
    const node =
      target === "pending" ? (pendingLink.current ?? changeButton.current) : target === "renewal" ? (renewalButton.current ?? changeButton.current) : changeButton.current;
    focusDrawn(node);
  }, [focusRequest]);
  const [changing, setChanging] = useState(false);
  const pendingChange = usePendingChange(meId, companyId, sessionId);
  // Over once the reads show it settled or replaced (decision 5, guard M-1): the record goes.
  const subscriptionNow = owner ? (subscriptionRead.data ?? null) : null;
  const entitlementNow = entitlementRead.data ?? null;
  useEffect(() => {
    if (pendingChange === null || meId === null) return;
    if (pendingSuperseded(pendingChange, subscriptionNow, entitlementNow)) setPendingChange(meId, companyId, null);
  }, [companyId, entitlementNow, meId, pendingChange, subscriptionNow]);
  const [asking, setAsking] = useState(false);
  const [renewalRefusal, setRenewalRefusal] = useState<(RefusalWords & { requestId: string | null; seq: number }) | null>(null);
  const stripId = useId();

  /** The company as a refusal's re-read found it, for its OWNER_REQUIRED (G6). */
  const refusedTenant = useRef<Tenant | null>(null);
  const renewal = useMutation({
    mutationFn: async ({ intent, cancel }: { intent: SubscriptionIntent; cancel: boolean }) => {
      try {
        if (cancel) await taskaApi.cancelSubscriptionRenewal(companyId, intent.version, intent.key);
        else await taskaApi.resumeSubscriptionRenewal(companyId, intent.version, intent.key);
      } catch (error) {
        refusedTenant.current = null;
        // Any refusal but a lost answer: in flight until the subscription and the company are read
        // again (B11), so the next press goes with the fresh If-Match.
        if (!isUnanswered(error) && !isWorkspaceClosed(error)) {
          const [, reread] = await Promise.all([
            queryClient.invalidateQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY }).catch(() => undefined),
            rereadTenant(),
          ]);
          refusedTenant.current = reread;
        }
        throw error;
      }
      if (meId !== null) settleIntent(meId, companyId, intent, null);
      // The rows follow the subscription read again, never the answer (guard §1, §7).
      await queryClient.invalidateQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY }).catch(() => undefined);
    },
    onSuccess: (_answer, { cancel }) => {
      setAsking(false);
      setRenewalRefusal(null);
      const fresh = queryClient.getQueryData<Subscription>(COMPANY_SUBSCRIPTION_KEY) ?? null;
      const through = fresh?.paidThrough ?? null;
      say(
        cancel
          ? renewalCancelledStatus(companyRef.current, currentRef.current, through, (fresh?.scheduledPlanVersionId ?? null) !== null)
          : renewalResumedStatus(companyRef.current, through),
      );
      // One element for both commands: the label switched, focus stays and its ring is drawn (B7).
      requestFocus("renewal");
    },
    onError: (error, { intent, cancel }) => {
      if (meId !== null) settleIntent(meId, companyId, intent, error);
      setAsking(false);
      // A 412 whose re-read already shows what was asked is done, not refused (art-director NB7).
      const fresh = queryClient.getQueryData<Subscription>(COMPANY_SUBSCRIPTION_KEY) ?? null;
      if (apiErrorFacts(error).status === 412 && fresh !== null && fresh.renewalCancelled === cancel) {
        setRenewalRefusal(null);
        say(cancel ? renewalAlreadyCancelledStatus(companyRef.current) : renewalAlreadyOnStatus(companyRef.current, fresh.paidThrough));
        requestFocus("renewal");
        return;
      }
      const words = subscriptionRefusalWords(cancel ? "cancelRenewal" : "resumeRenewal", error, companyRef.current);
      setRenewalRefusal((current) => ({ ...words, requestId: apiErrorFacts(error).requestId, seq: (current?.seq ?? 0) + 1 }));
      // The box under the row is not live; the page's status says it (B11).
      say(words.text);
      requestFocus("refused");
      const reread = refusedTenant.current;
      if (refusalCode(error) === "OWNER_REQUIRED" && reread !== null && reread.ownerId !== null && reread.ownerId !== meId) void followOwner(reread);
    },
  });
  const renewalBusy = renewal.isPending;
  const sendRenewal = (cancel: boolean) => {
    const version = subscriptionRead.data?.version ?? null;
    if (renewalBusy || meId === null) return;
    if (!isSendableVersion(version)) {
      void queryClient.invalidateQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
      return;
    }
    const command = cancel ? "cancelRenewal" : "resumeRenewal";
    const intent = intentFor(meId, companyId, command, command, version, sessionId);
    setRenewalRefusal(null);
    renewal.mutate({ intent, cancel });
  };

  const onChanged = (outcome: PlanChangeOutcome) => {
    setChanging(false);
    // The subscription as read again after the answer (guard M-1), the entitlement as it stood.
    const fresh = queryClient.getQueryData<Subscription>(COMPANY_SUBSCRIPTION_KEY) ?? null;
    if (meId !== null) {
      // Another accepted change replaces a pending one; a paid one is kept in this session only (A63).
      setPendingChange(
        meId,
        companyId,
        outcome.effect === "AFTER_PAYMENT" || outcome.effect === "NEXT_PERIOD"
          ? {
              effect: outcome.effect,
              planVersionId: outcome.target.id,
              invoice: outcome.invoice,
              sessionId,
              subscriptionVersion: fresh?.version ?? null,
              paidThrough: fresh?.paidThrough ?? null,
              entitlementVersion: entitlementRead.data?.version ?? null,
              entitlementPlan: entitlementRead.data?.planVersionId ?? null,
            }
          : null,
      );
    }
    if (outcome.withdrawal !== null) {
      // A paid scheduled change still starts: the re-read says which (guard M-2).
      const kept = (fresh?.scheduledPlanVersionId ?? null) !== null;
      say(
        withdrawalStatus({
          company: companyRef.current,
          current: currentRef.current,
          scheduled: outcome.withdrawal.scheduled,
          kept,
          at: fresh?.scheduledEffectiveAt ?? null,
        }),
      );
      requestFocus("change");
      return;
    }
    say(planChangedStatus({ company: companyRef.current, target: outcome.target, effect: outcome.effect, effectiveAt: outcome.effectiveAt, invoice: outcome.invoice }));
    requestFocus(outcome.effect === "AFTER_PAYMENT" && outcome.invoice.kind !== "none" ? "pending" : "change");
  };

  // The owner's boundaries (B4): once when the local clock passes the
  // paid-through or the announced date, once more 60 s later, then never.
  const sub = owner ? (subscriptionRead.data ?? null) : null;
  const boundary = sub === null ? null : nextBoundary([sub.paidThrough, sub.scheduledEffectiveAt]);
  const boundaryAt = boundary?.at ?? null;
  const boundaryIn = boundary?.inMs ?? null;
  /** The instants whose first re-read is set up or has gone: each is waited for once. */
  const scheduled = useRef(new Set<string>());
  /** The «60 s later» re-reads: they outlive the instant that set them (it is past by then), and go with the page. */
  const again = useRef<number[]>([]);
  useEffect(() => {
    const own = again.current;
    return () => {
      for (const timer of own.splice(0)) window.clearTimeout(timer);
    };
  }, []);
  // Set up and called off in the one effect (release-reviewer L-4): an instant
  // whose re-read was called off before it went — StrictMode's rehearsal
  // unmount, a company left, an instant that moved — may be waited for again.
  useEffect(() => {
    if (boundaryIn === null || boundaryAt === null || scheduled.current.has(boundaryAt)) return;
    const instants = scheduled.current;
    instants.add(boundaryAt);
    const reread = () => {
      for (const queryKey of [companyTenantKey(companyId), COMPANY_ENTITLEMENT_KEY, COMPANY_QUOTAS_KEY, COMPANY_SUBSCRIPTION_KEY]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    let gone = false;
    const timer = window.setTimeout(() => {
      gone = true;
      reread();
      again.current.push(window.setTimeout(reread, BOUNDARY_AGAIN_MS));
    }, boundaryIn);
    return () => {
      window.clearTimeout(timer);
      if (!gone) instants.delete(boundaryAt);
    };
    // `boundaryIn` is read once, when its instant is first seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryAt, companyId, queryClient]);

  const live: [ReadName, UseQueryResult<unknown>][] = owner
    ? [
        ["tenant", tenantQuery],
        ["entitlement", entitlement],
        ["plans", plans],
        ["subscription", subscription],
        ["quotas", quotas],
      ]
    : [
        ["tenant", tenantQuery],
        ["entitlement", entitlement],
        ["plans", plans],
        ["quotas", quotas],
      ];
  const reads = live.map(([, query]) => query);
  // The skeleton only until every read has first settled — latched once: a
  // re-read of a failed one is pending again and must not bring it back (B1).
  const ready = settled(me) && reads.every(settled);
  const [opened, setOpened] = useState(false);
  if (ready && !opened) setOpened(true);
  const retryButton = useRef<HTMLButtonElement>(null);
  /** Bumped when a re-read left a failure: «Try again» takes focus wherever it now stands. */
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) retryButton.current?.focus();
  }, [refocus]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retry = () => {
    // In flight a press asks nothing more — and a second press in the same
    // task re-reads nothing new either: react-query hands a failed read's
    // refetch the one already out.
    if (retrying !== null) return;
    const failed = live.filter(([, query]) => unread(query));
    if (failed.length === 0) return;
    setRetrying(Object.fromEntries(failed.map(([name, query]) => [name, { error: query.error, at: query.errorUpdatedAt }])));
    void Promise.all(failed.map(([, query]) => query.refetch())).then((results) => {
      if (!mounted.current) return;
      setRetrying(null);
      // Every one answered: the page is whole, focus on its heading. A failure
      // that stays remounts its box, and focus stays on «Try again» — in its
      // new place when the first failed box is another one now.
      if (results.every((result) => result.isSuccess)) heading()?.focus();
      else setRefocus((value) => value + 1);
    });
  };

  if (!ready && !opened) return <PlanLoading />;

  // One «Try again», 8 under the first ErrorNote of the page (§4.40) — the slots in the page's order.
  const slots: [ReadName, Drawn<unknown>][] = [
    ["tenant", tenantRead],
    ["entitlement", entitlementRead],
    ["plans", plansRead],
    ["subscription", subscriptionRead],
    ["quotas", quotasRead],
  ];
  const firstFailed =
    slots.find(([name, read]) => (name === "tenant" ? tenant === null : name !== "subscription" || owner) && drawnUnread(read))?.[0] ?? null;
  const failure = (name: ReadName, read: Drawn<unknown>, text: string, className?: string) => {
    if (read.failure === null || !drawnUnread(read)) return null;
    const first = name === firstFailed;
    return (
      <div className={className ? `company-plan-failure ${className}` : "company-plan-failure"}>
        {/* Found on arrival, not announced (§5.6); a failure that stays remounts its box. */}
        <ErrorNote key={read.failure.at} requestId={apiErrorFacts(read.failure.error).requestId}>
          {text}
        </ErrorNote>
        {first ? (
          // In flight (§4.1): `aria-disabled`, the label as it was, focus kept on it.
          <button
            aria-disabled={retrying !== null || undefined}
            className="secondary-button compact-button company-plan-retry"
            onClick={retry}
            ref={retryButton}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  };

  const catalogue = plansRead.data ?? null;
  const entitled = entitlementRead.data;
  const current = currentPlan;
  const planKnown = entitled !== undefined && catalogue !== null && entitled.planVersionId !== null;
  const price = owner && current ? planPriceText(current) : null;
  const paidThrough = sub?.paidThrough ?? null;
  const expired = tenant?.restrictions.includes("PAYMENT_EXPIRED") ?? false;
  // The owner's own NEXT_PERIOD choice (decision 5, A64); its id alone once the boundary passed unpaid.
  const scheduledChange =
    sub !== null && sub.scheduledPlanVersionId !== null && catalogue !== null
      ? { at: sub.scheduledEffectiveAt, plan: planById(catalogue, sub.scheduledPlanVersionId) }
      : null;
  const pending =
    owner && pendingChange?.effect === "AFTER_PAYMENT" && catalogue !== null ? { change: pendingChange, plan: planById(catalogue, pendingChange.planVersionId) } : null;
  // This session's answer named the scheduled change's invoice, and its read said so (decision 4).
  const scheduledInvoice =
    pendingChange?.effect === "NEXT_PERIOD" &&
    pendingChange.planVersionId === sub?.scheduledPlanVersionId &&
    pendingChange.invoice.kind === "verified" &&
    pendingChange.invoice.number !== null
      ? { id: pendingChange.invoice.id, number: pendingChange.invoice.number }
      : null;
  // A change is scheduled: cancelling the renewal does not cancel it (art-director blocker 4, guard L-2).
  const scheduledAhead = (sub?.scheduledPlanVersionId ?? null) !== null;
  const lines = usageLines(quotasRead.data ?? null, entitled ?? null);
  const refreshFailed = reads.some(stale);

  const firstFacts: ReactNode[] = [];
  if (planKnown) {
    firstFacts.push(
      <Fact key="plan" label="Plan">
        {current ? (
          <>
            {planNameParts(current).name}
            {planNameParts(current).version ? <span className="company-plan-quiet">{planNameParts(current).version}</span> : null}
          </>
        ) : (
          <span className="company-plan-quiet">{NOT_IN_CATALOGUE}</span>
        )}
      </Fact>,
    );
    if (price !== null) firstFacts.push(<Fact key="price" label="Price">{price}</Fact>);
  }
  const ownerFacts: ReactNode[] = [];
  if (sub !== null) {
    if (paidThrough !== null) {
      ownerFacts.push(
        <Fact key="paid" label="Paid until">
          <time dateTime={paidThrough}>{formatPaidUntil(paidThrough)}</time>
        </Fact>,
      );
    }
    // Paid until, Renewal and Automatic payments only where a paid period was sent (decision 5, F6): a
    // company moved to Free never shows the old one as kept. Past it the state block speaks, not the note.
    if (paidThrough !== null && sub.renewalCancelled === true) {
      ownerFacts.push(
        <Fact key="renewal" label="Renewal" note={expired ? null : renewalNote(company, scheduledAhead)}>
          Cancelled
        </Fact>,
      );
    }
    if (paidThrough !== null && sub.autopayState !== null) {
      ownerFacts.push(<Fact key="autopay" label="Automatic payments">{autopayWord(sub.autopayState)}</Fact>);
    }
    if (scheduledChange !== null) {
      const { at, plan } = scheduledChange;
      const date = at === null ? null : <time dateTime={at}>{formatPaidUntil(at)}</time>;
      // While its date stands, what happens if it is not paid by then — on the row, not only in the status (blocker 2).
      const payment =
        at === null ? null : scheduledInvoice !== null ? (
          <>
            {scheduledInvoiceHead}
            <Link
              className="admin-note-link company-plan-invoice-link"
              state={{ focusHeading: true }}
              to={`/company/billing/${encodeURIComponent(scheduledInvoice.id)}`}
            >
              {scheduledInvoice.number}
            </Link>
            {scheduledInvoiceTail(company)}
          </>
        ) : (
          scheduledPaymentText(company)
        );
      ownerFacts.push(
        <Fact
          key="scheduled"
          label="Scheduled change"
          note={
            at === null
              ? SCHEDULED_UNPAID_TEXT
              : plan !== null
                ? [
                    <>
                      From {date}
                      {scheduledTail(plan)}
                    </>,
                    payment,
                  ]
                : payment
          }
        >
          {plan !== null ? changedPlanLine(plan) : at !== null ? <>The plan changes from {date}.</> : <span className="company-plan-quiet">{NOT_IN_CATALOGUE}</span>}
        </Fact>,
      );
    }
    if (pending !== null) {
      ownerFacts.push(
        <Fact key="pending" label="Pending change" note={<PendingNote company={company} current={current} change={pending.change} linkRef={pendingLink} />}>
          {pending.plan !== null ? changedPlanLine(pending.plan) : <span className="company-plan-quiet">{NOT_IN_CATALOGUE}</span>}
        </Fact>,
      );
    }
  }

  // The owner's zone (B1, B2): a readable subscription and its version, else no command (guard §5).
  const zone = owner && sub !== null && isSendableVersion(sub.version);
  const cancelled = sub?.renewalCancelled ?? null;
  const renewalRow =
    !zone || paidThrough === null || cancelled === null
      ? null
      : !cancelled && !expired
        ? { text: cancelRenewalRowText(company, current, paidThrough, scheduledAhead), action: "cancel" as const }
        : cancelled && !expired
          ? { text: resumeRenewalRowText(company, paidThrough), action: "resume" as const }
          : cancelled
            ? { text: renewalEndedRowText(company, paidThrough), action: null }
            : null;
  const bandOpen = asking && renewalRow?.action === "cancel";

  return (
    <div className="settings-plane">
      <div className="settings-column company-plan">
        <p className="settings-lead">{planLeadText(company, owner)}</p>
        {tenant !== null ? (
          <CompanyStateBlock owner={owner} restrictions={tenant.restrictions} />
        ) : (
          failure("tenant", tenantRead, STATE_READ_FAILED, "company-plan-state-failure")
        )}
        {refreshFailed ? (
          <div className="company-plan-refresh-failure">
            <ApiNotice error={reads.find(stale)?.error} live="off" words={false}>
              {PLAN_REFRESH_FAILED}
            </ApiNotice>
          </div>
        ) : null}

        <div className="company-plan-facts">
          {failure("entitlement", entitlementRead, ENTITLEMENT_READ_FAILED)}
          {failure("plans", plansRead, CATALOGUE_READ_FAILED)}
          {firstFacts.length > 0 ? <dl className="settings-details company-plan-dl">{firstFacts}</dl> : null}
          {owner ? failure("subscription", subscriptionRead, SUBSCRIPTION_READ_FAILED) : null}
          {ownerFacts.length > 0 ? <dl className="settings-details company-plan-dl">{ownerFacts}</dl> : null}
        </div>

        <h2 className="company-plan-usage-heading">Usage</h2>
        {failure("quotas", quotasRead, USAGE_READ_FAILED)}
        {lines.length > 0 ? (
          <dl className="settings-details company-plan-dl company-plan-usage">
            {lines.map((line) => (
              <Fact key={line.kind} label={line.label} note={line.note}>
                {line.value}
              </Fact>
            ))}
          </dl>
        ) : null}

        {zone ? (
          <div className="company-general-zone company-plan-zone">
            <div className="company-general-zone-row">
              <div className="company-general-zone-line">
                <p className="company-general-zone-text">{changePlanRowText(company)}</p>
                <button
                  aria-haspopup="dialog"
                  className="secondary-button compact-button company-general-zone-button"
                  onClick={() => {
                    setAsking(false);
                    setChanging(true);
                  }}
                  ref={changeButton}
                  type="button"
                >
                  {CHANGE_PLAN}
                </button>
              </div>
            </div>
            {renewalRow !== null ? (
              <div
                className="company-general-zone-row"
                onKeyDown={(event) => {
                  if (bandOpen && event.key === "Escape") {
                    event.preventDefault();
                    if (!renewalBusy) {
                      setAsking(false);
                      renewalButton.current?.focus();
                    }
                  }
                }}
              >
                <div className="company-general-zone-line">
                  <p className="company-general-zone-text">{renewalRow.text}</p>
                  {renewalRow.action !== null ? (
                    // One element for both commands, so focus stays on it when the answer turns one into the other (B7).
                    <button
                      aria-controls={bandOpen ? stripId : undefined}
                      aria-disabled={renewalBusy || undefined}
                      aria-expanded={renewalRow.action === "cancel" ? bandOpen : undefined}
                      className="secondary-button compact-button strip-trigger company-general-zone-button"
                      onClick={() => {
                        if (renewalBusy) return;
                        if (renewalRow.action === "resume") {
                          sendRenewal(false);
                        } else if (bandOpen) {
                          setAsking(false);
                        } else {
                          setRenewalRefusal(null);
                          setAsking(true);
                        }
                      }}
                      ref={renewalButton}
                      type="button"
                    >
                      {renewalRow.action === "cancel" ? "Cancel renewal" : "Resume renewal"}
                    </button>
                  ) : null}
                </div>
                {bandOpen && paidThrough !== null ? (
                  <Strip
                    answer="Cancel renewal"
                    busy={renewalBusy}
                    cancelLabel="Keep renewal"
                    className="company-plan-band"
                    id={stripId}
                    onAnswer={() => sendRenewal(true)}
                    onCancel={() => {
                      setAsking(false);
                      renewalButton.current?.focus();
                    }}
                    sentence={cancelRenewalQuestion(company, current, paidThrough, sub?.autopayState === "CONSENTED", scheduledAhead)}
                  />
                ) : null}
                {renewalRefusal ? (
                  <ErrorNote key={renewalRefusal.seq} requestId={renewalRefusal.requestId} serverWords={renewalRefusal.words}>
                    {renewalRefusal.text}
                  </ErrorNote>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* One persistent region, a node per sentence (§5.6): mounted with the page, so it is listening when it speaks. */}
        <div className="visually-hidden" role="status">
          {said ? <span key={said.seq}>{said.text}</span> : null}
        </div>
      </div>
      {changing && zone ? (
        <ChangePlanModal
          company={company}
          companyId={companyId}
          meId={meId}
          onChanged={onChanged}
          onClose={() => {
            setChanging(false);
            changeButton.current?.focus();
          }}
          onOwnerLost={(answer) => {
            setChanging(false);
            heading()?.focus();
            void followOwner(answer);
          }}
          sessionId={sessionId}
        />
      ) : null}
    </div>
  );
}

/** Focus handed back after a command, its ring drawn even after a pointer press (§5.9 «Успех»). */
function focusDrawn(node: HTMLElement | null | undefined) {
  if (!node) return;
  try {
    node.focus({ focusVisible: true } as FocusOptions);
  } catch {
    node.focus();
  }
}

/**
 * «Pending change»'s second line (decision 4): the invoice the answer named
 * — its number when the read said it is this change's, «Open the invoice»
 * when it could not be read — or that there is none yet.
 */
function PendingNote({
  company,
  current,
  change,
  linkRef,
}: {
  company: string | null;
  current: PlanVersion | null;
  change: PendingChange;
  linkRef: RefObject<HTMLAnchorElement | null>;
}) {
  const { invoice } = change;
  if (invoice.kind === "none") return <>{pendingNoInvoiceText(company, current)}</>;
  const link = (text: string) => (
    <Link
      className="admin-note-link company-plan-invoice-link"
      ref={linkRef}
      state={{ focusHeading: true }}
      to={`/company/billing/${encodeURIComponent(invoice.id)}`}
    >
      {text}
    </Link>
  );
  if (invoice.kind === "verified" && invoice.number !== null) {
    return (
      <>
        Starts once invoice {link(invoice.number)} is paid. {pendingUntilText(company, current)}
      </>
    );
  }
  return (
    <>
      Starts once its invoice is paid. {pendingUntilText(company, current)} {link(OPEN_INVOICE_LINK)}
    </>
  );
}

/** One `dt` / `dd` pair of §4.39's facts recipe, with the rule's second line when there is one. */
function Fact({ label, note = null, children }: { label: string; note?: ReactNode | ReactNode[]; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="company-plan-value">{children}</span>
        {/* One `.company-plan-note` per line of the rule (TAS-515: a scheduled change has two). */}
        {(Array.isArray(note) ? note : [note])
          .filter((line) => line !== null && line !== undefined)
          .map((line, index) => (
            <span className="company-plan-note" key={index}>
              {line}
            </span>
          ))}
      </dd>
    </div>
  );
}

/** Five rows of the facts, as bars (§4.40 «Загрузка»): no lead, no Usage, no spinner. */
function PlanLoading() {
  return (
    <div className="settings-plane">
      <div aria-busy="true" className="settings-column company-plan company-plan-loading">
        <span className="visually-hidden" role="status">
          {PLAN_LOADING_TEXT}
        </span>
        <div aria-hidden="true" className="settings-details company-plan-dl">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index}>
              <span className="value-skeleton company-general-skeleton-label" />
              <span className="value-skeleton company-general-skeleton-value" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
