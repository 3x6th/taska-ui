import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { Invoice } from "../../api/billing";
import { isWorkspaceClosed, refusalCode } from "../../api/errors";
import { isSendableVersion } from "../../api/tenantMembers";
import type { Subscription } from "../../api/tenants";
import { ErrorNote } from "../../components/ErrorNote";
import { useWorkspace } from "../../hooks/useCompanies";
import { useMutation } from "../../hooks/useMutation";
import { TENANTS_QUERY_KEY } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { InvoiceMarker } from "./BillingParts";
import { COMPANY_SUBSCRIPTION_KEY, companySubscriptionOptions, companyTenantKey } from "./companyGeneral";
import type { RefusalWords } from "./companyGeneralText";
import { Strip } from "./CompanyMembersSection";
import { intentFor, settleIntent, type SubscriptionIntent } from "./companyPlanChange";
import {
  AUTOPAY_READ_FAILED,
  AUTOPAY_TITLE,
  KEEP_THEM_ON,
  TURN_OFF,
  TURN_OFF_LABEL,
  autopayAlreadyOffStatus,
  autopayLineText,
  autopayOffStatus,
  billingAutopayLeadText,
  canTurnOff,
  isUnanswered,
  subscriptionRefusalWords,
  turnOffQuestion,
} from "./companyPlanChangeText";
import { autopayWord } from "./companyPlanText";
import { zoneHeading } from "./companyZone";
import {
  BILLING_LOADING_TEXT,
  ENDED_INVOICE_STATES,
  INVOICES_EMPTY_TEXT,
  INVOICES_READ_FAILED,
  OPENING_PAYMENT_STATUS,
  billingLeadText,
  billingOwnerOnlyText,
  formatInvoiceMoney,
  inProgressState,
  invoiceMetaText,
  isPayable,
  listedInvoices,
  primaryPayable,
  statusWord,
} from "./billingText";
import {
  closeAttempt,
  companyDisputesOptions,
  companyInvoicesOptions,
  companyRefundsOptions,
  unresolved,
  useBillingReader,
  useCheckoutAttempts,
  usePayInvoice,
} from "./companyBilling";
import { DisputesGroup } from "./DisputesGroup";
import { RefundsGroup } from "./WireParts";
import { DISPUTES_READ_FAILED, listedDisputes } from "./disputeText";
import { REFUNDS_READ_FAILED, listedRefunds } from "./wireText";
import { apiErrorFacts } from "../../api/errors";

/**
 * Company › Billing (TAS-513, art-director B1–B4, B9–B11) — the B2B build only,
 * its owner only: the company's invoices and Pay. The rail item is not in the
 * DOM for anybody else (`CompanyScreen`); an address typed by a non-owner — or
 * a tab left open after a transfer — gets the heading and one line, and no
 * billing request goes out (api-contract-guard §7).
 *
 * TAS-515 (art-director B8, the orchestrator's decision 1): the «Automatic
 * payments» group above the invoices, from `getSubscription` read beside the
 * list — its state, and «Turn off» only; nothing here turns them on (A67).
 *
 * TAS-514 (art-director B11, decision 6): «Refunds» under the invoices, from
 * `listRefunds` (all pages) read beside them — shown only when there is one,
 * never tied to an invoice (A81).
 *
 * TAS-516 (art-director B2–B8, guard B3, B10): «Disputes» between Automatic
 * payments and Invoices, from `listDisputes` (all pages) beside them — shown only
 * when there is one; each row says only what its own state and outcome say.
 * Order on the page: Automatic payments → Disputes → Invoices → Refunds.
 */
export function CompanyBillingSection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyBilling companyId={address.companyId} />;
}

interface Failure {
  error: unknown;
  at: number;
}
type BillingRead = "subscription" | "disputes" | "invoices" | "refunds";

function CompanyBilling({ companyId }: { companyId: string }) {
  const reader = useBillingReader(companyId);
  const invoices = useQuery({ ...companyInvoicesOptions(companyId), enabled: reader.owner });
  // The owner's only, beside the list (guard §7: +1 read, depth 2).
  const subscription = useQuery({ ...companySubscriptionOptions(companyId), enabled: reader.owner });
  // TAS-514: the refunds, beside them (guard §8: +1 read, depth 2).
  const refunds = useQuery({ ...companyRefundsOptions(companyId), enabled: reader.owner });
  // TAS-516: the disputes, beside them (guard B3: +1 read, depth 2).
  const disputes = useQuery({ ...companyDisputesOptions(companyId), enabled: reader.owner });
  // A read refused OWNER_REQUIRED: who owns the company is the re-read company's to say (guard §3, §4.39's G6).
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const ownerRefused = [subscription, disputes, invoices, refunds].some((query) => query.isError && refusalCode(query.error) === "OWNER_REQUIRED");
  useEffect(() => {
    if (!ownerRefused) return;
    void queryClient.invalidateQueries({ queryKey: companyTenantKey(companyId) });
    void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
  }, [ownerRefused, queryClient, accountClient, companyId]);
  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = useCallback((text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 })), []);
  const attempts = useCheckoutAttempts(reader.meId, companyId);
  const press = usePayInvoice({ companyId, userId: reader.meId, returnTarget: "BILLING", company: reader.company });
  const retryButton = useRef<HTMLButtonElement>(null);

  // The server's ended state closes the record (release-reviewer B1): an invoice
  // read PAID, EXPIRED or VOID leaves no attempt of it behind — the invoice
  // page's rule (`INVOICE_ENDED`), on the list too.
  const ended = (invoices.data ?? []).filter((invoice) => ENDED_INVOICE_STATES.has(invoice.state ?? "")).map((invoice) => invoice.id);
  useEffect(() => {
    for (const invoiceId of ended) {
      const record = attempts.get(invoiceId);
      if (record) closeAttempt(record.userId, companyId, invoiceId, record.key);
    }
    // `ended` is derived from the list's answer, `attempts` from the records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended.join(), attempts, companyId]);

  // Back from the provider left a payment (N3): no «Return to payment» here — focus goes to its invoice's link.
  const returnFocusHandled = useRef(0);
  useEffect(() => {
    if (press.returnFocusRequest <= returnFocusHandled.current || press.returnFocusInvoice === null) return;
    const link = document.querySelector<HTMLElement>(`[data-invoice-link="${CSS.escape(press.returnFocusInvoice)}"]`);
    if (link === null) return;
    returnFocusHandled.current = press.returnFocusRequest;
    link.focus();
  });
  /**
   * «Try again» in flight: the failures it was pressed against stay drawn, the
   * button where it was, until every re-read answers (§4.40's mechanics) —
   * TanStack puts a failed read without data back to `pending` on a refetch.
   */
  const [retrying, setRetrying] = useState<Partial<Record<BillingRead, Failure>> | null>(null);
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus > 0) retryButton.current?.focus();
  }, [refocus]);
  // The skeleton only until the list and the subscription first settle — latched (§4.40 «Загрузка»):
  // the group never pushes the list down once it has drawn (B8).
  const settled = (query: { isSuccess: boolean; isError: boolean }) => query.isSuccess || query.isError;
  const [opened, setOpened] = useState(false);
  if (!opened && settled(invoices) && settled(subscription) && settled(refunds) && settled(disputes)) setOpened(true);

  if (!reader.known) return <BillingLoading />;
  if (!reader.owner) {
    return (
      <div className="settings-plane">
        <div className="settings-column company-billing">
          <p className="settings-lead">{billingOwnerOnlyText(reader.company)}</p>
        </div>
      </div>
    );
  }
  const sub = subscription.data ?? null;
  // Shown with a paid period, or a mandate that is not off — one on a Free company must still be possible to turn off (B8).
  const showGroup = sub !== null && sub.autopayState !== null && (sub.paidThrough !== null || sub.autopayState !== "DISABLED");
  if (!opened) return <BillingLoading company={reader.company} owner autopay={showGroup} />;
  const failureOf = (name: BillingRead, query: { isError: boolean; data: unknown; error: unknown; errorUpdatedAt: number }): Failure | null =>
    retrying !== null ? (retrying[name] ?? null) : query.isError && query.data === undefined ? { error: query.error, at: query.errorUpdatedAt } : null;
  const subscriptionFailure = failureOf("subscription", subscription);
  const disputesFailure = failureOf("disputes", disputes);
  const failure = failureOf("invoices", invoices);
  const refundsFailure = failureOf("refunds", refunds);
  // The page's one «Try again», under the first note in DOM order (B4).
  const firstFailure: BillingRead | null =
    subscriptionFailure !== null ? "subscription" : disputesFailure !== null ? "disputes" : failure !== null ? "invoices" : refundsFailure !== null ? "refunds" : null;
  const retry = () => {
    if (retrying !== null) return;
    const failed = (
      [
        ["subscription", subscription, subscriptionFailure],
        ["disputes", disputes, disputesFailure],
        ["invoices", invoices, failure],
        ["refunds", refunds, refundsFailure],
      ] as const
    ).filter(([, , shown]) => shown !== null);
    if (failed.length === 0) return;
    setRetrying(Object.fromEntries(failed.map(([name, , shown]) => [name, shown])));
    void Promise.all(failed.map(([, query]) => query.refetch())).then((results) => {
      setRetrying(null);
      if (!results.every((result) => result.isSuccess)) setRefocus((value) => value + 1);
      else document.querySelector<HTMLElement>(".settings-area .area-section-title")?.focus();
    });
  };
  const tryAgain = (
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
  );

  const listed = listedInvoices(invoices.data ?? []);
  const payable = (invoice: Invoice) => isPayable(invoice) && !unresolved(attempts.get(invoice.id)) && press.inProgress !== invoice.id;
  const primary = primaryPayable(listed, payable);

  return (
    <div className="settings-plane">
      <div className="settings-column company-billing">
        <p className="settings-lead">{showGroup || subscriptionFailure !== null ? billingAutopayLeadText(reader.company) : billingLeadText(reader.company)}</p>
        {subscriptionFailure !== null ? (
          <div className="company-plan-failure company-billing-failure">
            <ErrorNote key={subscriptionFailure.at} requestId={apiErrorFacts(subscriptionFailure.error).requestId}>
              {AUTOPAY_READ_FAILED}
            </ErrorNote>
            {firstFailure === "subscription" ? tryAgain : null}
          </div>
        ) : showGroup && sub !== null && reader.meId !== null ? (
          <AutopayGroup companyId={companyId} company={reader.company} meId={reader.meId} say={say} subscription={sub} />
        ) : null}
        {disputesFailure !== null ? (
          <div className="company-plan-failure company-billing-failure">
            <ErrorNote key={disputesFailure.at} requestId={apiErrorFacts(disputesFailure.error).requestId}>
              {DISPUTES_READ_FAILED}
            </ErrorNote>
            {firstFailure === "disputes" ? tryAgain : null}
          </div>
        ) : (
          <DisputesGroup company={reader.company} disputes={listedDisputes(disputes.data ?? [])} restrictions={reader.tenant?.restrictions ?? []} />
        )}
        {failure !== null ? (
          <div className="company-plan-failure company-billing-failure">
            {/* Found on arrival, not announced (§5.6); a failure that stays remounts its box. */}
            <ErrorNote key={failure.at} requestId={apiErrorFacts(failure.error).requestId}>
              {INVOICES_READ_FAILED}
            </ErrorNote>
            {firstFailure === "invoices" ? tryAgain : null}
          </div>
        ) : (
          <section aria-labelledby="company-invoices-title" className="company-group company-billing-group">
            <h2 className="company-group-title" id="company-invoices-title">
              Invoices<span className="company-group-count">{listed.length}</span>
            </h2>
            {listed.length === 0 ? (
              <p className="company-billing-empty">{INVOICES_EMPTY_TEXT}</p>
            ) : (
              <ul className="company-invoice-list">
                {listed.map((invoice) => {
                  // A record left by the cancel address or Back is not «confirming» (art-director blocker 3):
                  // the invoice's own word, no Pay; its page offers «Return to payment».
                  const record = attempts.get(invoice.id);
                  const confirming = unresolved(record) && record.leftAt === undefined;
                  const word = statusWord(invoice.state, confirming);
                  const inFlight = press.pending === invoice.id;
                  const refusal = press.refusal?.invoiceId === invoice.id ? press.refusal : null;
                  return (
                    <li className={payable(invoice) ? "company-invoice-row is-payable" : "company-invoice-row"} key={invoice.id}>
                      <div className="company-invoice-text">
                        {/* Lands with focus on the invoice's heading (art-director blocker 2, B11). */}
                        <Link
                          className="company-invoice-number"
                          data-invoice-link={invoice.id}
                          state={{ focusHeading: true }}
                          to={`/company/billing/${encodeURIComponent(invoice.id)}`}
                        >
                          {invoice.number ?? "Invoice"}
                        </Link>
                        <p className="company-invoice-meta">
                          {invoiceMetaText(invoice)}
                          <InvoiceMarker className="company-invoice-marker-inline" word={word} />
                        </p>
                      </div>
                      <span className="company-invoice-amount">{invoice.total ? formatInvoiceMoney(invoice.total) : null}</span>
                      <span className="company-invoice-status">
                        <InvoiceMarker word={word} />
                      </span>
                      <div className="company-invoice-action">
                        {payable(invoice) ? (
                          <button
                            aria-disabled={inFlight || press.pending !== null || undefined}
                            className={`${invoice.id === primary ? "primary-button" : "secondary-button"} compact-button company-billing-pay`}
                            onClick={(event) => void press.pay(invoice, event.currentTarget)}
                            type="button"
                          >
                            {/* §4.1's default in flight (blocker 1): the label stays, so the row does not reflow. */}
                            Pay
                          </button>
                        ) : null}
                      </div>
                      {inFlight ? (
                        <span className="visually-hidden" role="status">
                          {OPENING_PAYMENT_STATUS}
                        </span>
                      ) : null}
                      {refusal ? (
                        <div className="company-invoice-note">
                          <ErrorNote key={refusal.key} live="alert" requestId={refusal.requestId} serverWords={refusal.words.words}>
                            {refusal.words.text}
                          </ErrorNote>
                        </div>
                      ) : null}
                      {press.inProgress === invoice.id ? (
                        <p className="company-general-state company-invoice-note" role="status">
                          <span className="company-general-state-fact">{inProgressState(null).fact}</span> {inProgressState(null).explanation}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        {refundsFailure !== null ? (
          <div className="company-plan-failure company-billing-failure">
            <ErrorNote key={refundsFailure.at} requestId={apiErrorFacts(refundsFailure.error).requestId}>
              {REFUNDS_READ_FAILED}
            </ErrorNote>
            {firstFailure === "refunds" ? tryAgain : null}
          </div>
        ) : (
          <RefundsGroup refunds={listedRefunds(refunds.data ?? [])} />
        )}
        {/* One persistent region, a node per sentence (§5.6). */}
        <div className="visually-hidden" role="status">
          {said ? <span key={said.seq}>{said.text}</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * «Automatic payments» (art-director B8, decision 1): the mandate's state in
 * the invoice-row anatomy, and «Turn off» for one that is on or suspended —
 * a §4.22 band, `{consent: false, confirmed: true}` with `If-Match` =
 * `Subscription.version` (never the mandate's). No «Turn on» exists: nothing
 * serves a payment method or a terms version to consent with (A67).
 */
function AutopayGroup({
  companyId,
  company,
  meId,
  subscription,
  say,
}: {
  companyId: string;
  company: string | null;
  meId: string;
  subscription: Subscription;
  say: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const sessionId = useWorkspace()?.tenantSessionId ?? null;
  const titleId = useId();
  const stripId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<(RefusalWords & { requestId: string | null; seq: number }) | null>(null);
  const state = subscription.autopayState ?? "";
  const offer = canTurnOff(state) && isSendableVersion(subscription.version);
  const open = asking && offer;
  const invalidate = (queryKey: QueryKey) => queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
  /**
   * Focus once the page has drawn the outcome (art-director blocker 5): «Turn off» when it is still
   * there, else the group's heading — or the page's, when the re-read took the whole group away.
   */
  const [focusTo, setFocusTo] = useState<{ target: "button" | "title"; seq: number } | null>(null);
  useEffect(() => {
    if (focusTo === null) return;
    const node = focusTo.target === "button" ? (button.current ?? titleRef.current) : titleRef.current;
    (node ?? zoneHeading())?.focus();
  }, [focusTo]);
  const focusAfter = (target: "button" | "title") => {
    const fresh = queryClient.getQueryData<Subscription>(COMPANY_SUBSCRIPTION_KEY) ?? null;
    const groupStays = fresh !== null && fresh.autopayState !== null && (fresh.paidThrough !== null || fresh.autopayState !== "DISABLED");
    // The group unmounts with the read that removed it: nothing here would run, so the page's heading now.
    if (!groupStays) zoneHeading()?.focus();
    else setFocusTo((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));
  };

  const turnOff = useMutation({
    mutationFn: async (intent: SubscriptionIntent) => {
      try {
        await taskaApi.setAutopayConsent(companyId, false, intent.version, intent.key);
      } catch (error) {
        // Any refusal but a lost answer: in flight until the subscription and the company are read
        // again (B11), so the next press goes with the fresh If-Match.
        if (!isUnanswered(error) && !isWorkspaceClosed(error)) await Promise.all([invalidate(COMPANY_SUBSCRIPTION_KEY), invalidate(companyTenantKey(companyId))]);
        throw error;
      }
      settleIntent(meId, companyId, intent, null);
      // The mandate's answer means only «2xx»: the group follows the subscription read again.
      await invalidate(COMPANY_SUBSCRIPTION_KEY);
    },
    onSuccess: () => {
      setAsking(false);
      setRefusal(null);
      say(autopayOffStatus(company));
      // The button is gone: focus on the group's heading — or the page's, when the group went with it.
      focusAfter("title");
    },
    onError: (error, intent) => {
      settleIntent(meId, companyId, intent, error);
      setAsking(false);
      if (refusalCode(error) === "OWNER_REQUIRED") void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      // A 412 whose re-read shows them off already is done, not refused (art-director blocker 5).
      const fresh = queryClient.getQueryData<Subscription>(COMPANY_SUBSCRIPTION_KEY) ?? null;
      if (apiErrorFacts(error).status === 412 && fresh?.autopayState === "DISABLED") {
        setRefusal(null);
        say(autopayAlreadyOffStatus(company));
        focusAfter("title");
        return;
      }
      const words = subscriptionRefusalWords("autopayOff", error, company);
      setRefusal((current) => ({ ...words, requestId: apiErrorFacts(error).requestId, seq: (current?.seq ?? 0) + 1 }));
      say(words.text);
      // «Turn off» when the re-read keeps it; the heading when it took it away (the note stays under it).
      focusAfter(fresh !== null && !canTurnOff(fresh.autopayState) ? "title" : "button");
    },
  });
  const busy = turnOff.isPending;
  const send = () => {
    if (busy || !isSendableVersion(subscription.version)) return;
    const intent = intentFor(meId, companyId, "autopayOff", "autopayOff", subscription.version, sessionId);
    setRefusal(null);
    turnOff.mutate(intent);
  };
  const line = autopayLineText(state, company);

  return (
    <section aria-labelledby={titleId} className="company-group company-autopay">
      <h2 className="company-group-title" id={titleId} ref={titleRef} tabIndex={-1}>
        {AUTOPAY_TITLE}
      </h2>
      <div
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            if (!busy) {
              setAsking(false);
              button.current?.focus();
            }
          }
        }}
      >
        <div className="company-autopay-row">
          <div className="company-autopay-text">
            <p className="company-autopay-state">{autopayWord(state)}</p>
            {line !== null ? <p className="company-autopay-note">{line}</p> : null}
          </div>
          {offer ? (
            <button
              aria-controls={open ? stripId : undefined}
              aria-disabled={busy || undefined}
              aria-expanded={open}
              aria-label={TURN_OFF_LABEL}
              className="secondary-button compact-button strip-trigger company-autopay-button"
              onClick={() => {
                if (busy) return;
                if (open) {
                  setAsking(false);
                } else {
                  setRefusal(null);
                  setAsking(true);
                }
              }}
              ref={button}
              type="button"
            >
              {TURN_OFF}
            </button>
          ) : null}
        </div>
        {open ? (
          <Strip
            answer={TURN_OFF}
            busy={busy}
            cancelLabel={KEEP_THEM_ON}
            className="company-autopay-band"
            id={stripId}
            onAnswer={send}
            onCancel={() => {
              setAsking(false);
              button.current?.focus();
            }}
            sentence={turnOffQuestion(company, subscription.paidThrough)}
          />
        ) : null}
        {refusal ? (
          <ErrorNote key={refusal.seq} requestId={refusal.requestId} serverWords={refusal.words}>
            {refusal.text}
          </ErrorNote>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Three rows of bars (B3): no spinner; the hidden status says what is loading.
 * Once the reader is known to be the owner, the lead and «Invoices» (no count)
 * stand above them, so the page does not jump when the list lands (NB3).
 */
function BillingLoading({ company = null, owner = false, autopay = false }: { company?: string | null; owner?: boolean; autopay?: boolean }) {
  const rows = (
    <ul aria-hidden="true" className="company-invoice-list">
      {[0, 1, 2].map((index) => (
        <li className="company-invoice-row company-invoice-skeleton" key={index}>
          <div className="company-invoice-text">
            <span className="value-skeleton company-invoice-skeleton-number" />
            <span className="value-skeleton company-invoice-skeleton-meta" />
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="settings-plane">
      <div aria-busy="true" className="settings-column company-billing company-billing-loading">
        <span className="visually-hidden" role="status">
          {BILLING_LOADING_TEXT}
        </span>
        {owner ? (
          <>
            {/* The lead the page will have when the subscription is already known (TAS-515). */}
            <p className="settings-lead">{autopay ? billingAutopayLeadText(company) : billingLeadText(company)}</p>
            <div className="company-group company-billing-group">
              <h2 className="company-group-title">Invoices</h2>
              {rows}
            </div>
          </>
        ) : (
          rows
        )}
      </div>
    </div>
  );
}
