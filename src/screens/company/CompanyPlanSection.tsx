import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, refusalCode } from "../../api/errors";
import type { Tenant } from "../../api/tenants";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanies, useCompanyName } from "../../hooks/useCompanies";
import { TENANTS_QUERY_KEY, upsertTenant } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { planLimitsText, planPriceText, plansQueryOptions } from "../../lib/plans";
import { COMPANY_SUBSCRIPTION_KEY, companySubscriptionOptions, companyTenantKey, companyTenantOptions } from "./companyGeneral";
import { formatPaidUntil } from "./companyGeneralText";
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
  announcedTail,
  autopayWord,
  planById,
  planLeadText,
  planNameParts,
  renewalNote,
  usageLines,
} from "./companyPlanText";
import { CompanyStateBlock } from "./CompanyStateBlock";

/**
 * Settings › Plan (TAS-512, DESIGN.md §4.40) — the B2B build only: the plan
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
 *   paid-through or announced date, again 60 s later. No poll.
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

  // 403 OWNER_REQUIRED (TAS-504 G6): who owns it is the re-read company's to
  // say; another owner now — the owner's cache goes and the tab re-enters.
  const ownerRefusedAt = refusalCode(subscription.error) === "OWNER_REQUIRED" ? subscription.errorUpdatedAt : 0;
  useEffect(() => {
    if (ownerRefusedAt === 0 || meId === null) return;
    let live = true;
    void (async () => {
      let reread: Tenant | null;
      try {
        reread = await queryClient.fetchQuery({ ...companyTenantOptions(companyId), staleTime: 0 });
      } catch {
        reread = null;
      }
      if (!live || reread === null || reread.ownerId === null || reread.ownerId === meId) return;
      const answer = reread;
      accountClient?.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => (list ? upsertTenant(list, answer) : list));
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      queryClient.removeQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
      try {
        await taskaApi.reenterCompany(companyId);
      } catch {
        // The page follows the company either way.
      }
    })();
    return () => {
      live = false;
    };
  }, [accountClient, companyId, meId, ownerRefusedAt, queryClient]);

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
  const current = entitled && catalogue ? planById(catalogue, entitled.planVersionId) : null;
  const planKnown = entitled !== undefined && catalogue !== null && entitled.planVersionId !== null;
  const price = owner && current ? planPriceText(current) : null;
  const paidThrough = sub?.paidThrough ?? null;
  const announced =
    sub !== null && sub.scheduledPlanVersionId !== null && sub.scheduledEffectiveAt !== null && catalogue !== null
      ? { at: sub.scheduledEffectiveAt, plan: planById(catalogue, sub.scheduledPlanVersionId) }
      : null;
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
    if (sub.renewalCancelled === true) {
      ownerFacts.push(
        <Fact key="renewal" label="Renewal" note={renewalNote(company)}>
          Cancelled
        </Fact>,
      );
    }
    if (paidThrough !== null && sub.autopayState !== null) {
      ownerFacts.push(<Fact key="autopay" label="Automatic payments">{autopayWord(sub.autopayState)}</Fact>);
    }
    if (announced !== null) {
      const limits = announced.plan ? planLimitsText(announced.plan) : "";
      ownerFacts.push(
        <Fact key="announced" label="Announced change" note={limits === "" ? null : limits}>
          From <time dateTime={announced.at}>{formatPaidUntil(announced.at)}</time>
          {announcedTail(announced.plan, announced.plan ? planPriceText(announced.plan) : null)}
        </Fact>,
      );
    }
  }

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
      </div>
    </div>
  );
}

/** One `dt` / `dd` pair of §4.39's facts recipe, with the rule's second line when there is one. */
function Fact({ label, note = null, children }: { label: string; note?: string | null; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="company-plan-value">{children}</span>
        {note !== null ? <span className="company-plan-note">{note}</span> : null}
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
