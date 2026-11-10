import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { taskaApi } from "../../api/client";
import { readAllInvoices, type Checkout, type Invoice, type ReturnTarget } from "../../api/billing";
import {
  CHECKOUT_ATTEMPT_PREFIX,
  browserCheckoutLocks,
  checkoutAttemptKey,
  clearCheckoutAttempt,
  readCheckoutAttempt,
  withCheckoutAttempt,
  type CheckoutAttempt,
} from "../../api/checkoutAttempt";
import { apiErrorFacts, refusalCode } from "../../api/errors";
import { ForeignCompanyAnswerError } from "../../api/tenants";
import { useCompanies, useCompanyName } from "../../hooks/useCompanies";
import { TENANTS_QUERY_KEY } from "../../lib/companies";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { useAccountQueryClient } from "../../lib/companyAddress";
import { POLL_LIMIT_MS, SLOW_SETUP_MS, pollDelay } from "../companySetupText";
import { closesAttempt, isPayable, payRefusalWords, type PayRefusalWords, type WatchStage } from "./billingText";
import { COMPANY_SUBSCRIPTION_KEY, companyTenantKey, companyTenantOptions } from "./companyGeneral";
import { retryUnanswered } from "./companyMembersQuery";
import { COMPANY_ENTITLEMENT_KEY } from "./companyPlan";

/*
 * Company › Billing (TAS-513) — its reads, the Pay press and the watch of an
 * unresolved payment, on the company session's own query client. Owner only:
 * nothing here is asked for a reader who is not `getTenant().ownerId`
 * (api-contract-guard §7); the server's 403 stays the enforcement.
 */

export const COMPANY_INVOICES_KEY = ["company-invoices"] as const;
export const companyInvoiceKey = (invoiceId: string) => ["company-invoice", invoiceId] as const;
export const companyCheckoutKey = (checkoutId: string) => ["company-checkout", checkoutId] as const;

/** Every invoice, all pages (B3). */
export const companyInvoicesOptions = (companyId: string) =>
  queryOptions({
    queryKey: COMPANY_INVOICES_KEY,
    queryFn: () => readAllInvoices((params) => taskaApi.listInvoices(companyId, params)),
    retry: retryUnanswered,
  });

export const companyInvoiceOptions = (companyId: string, invoiceId: string) =>
  queryOptions({
    queryKey: companyInvoiceKey(invoiceId),
    queryFn: () => taskaApi.getInvoice(companyId, invoiceId),
    retry: retryUnanswered,
  });

/**
 * The reader and the company, and whether the reader owns it — `getTenant()
 * .ownerId` = the reader, read first (api-contract-guard §7): no billing
 * request goes out before it says so. Only when the company read failed does
 * the reader's list row decide.
 */
export function useBillingReader(companyId: string) {
  const companies = useCompanies();
  const listedName = useCompanyName(companyId);
  const row = companies.data?.find((tenant) => tenant.id === companyId) ?? null;
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  const tenantQuery = useQuery(companyTenantOptions(companyId));
  const tenant = tenantQuery.data ?? null;
  const meId = me.data?.id ?? null;
  const ownerId = tenant !== null ? tenant.ownerId : tenantQuery.isError ? (row?.ownerId ?? null) : null;
  const known = meId !== null && (tenant !== null || tenantQuery.isError);
  return {
    meId,
    tenant,
    tenantQuery,
    company: tenant?.name ?? listedName,
    known,
    owner: known && ownerId !== null && ownerId === meId,
  };
}

/* ------------------------------------------------- the attempt records */

/** Fired in this tab after it changed a record; other tabs hear `storage`. */
const ATTEMPTS_EVENT = "taska-checkout-attempts";
export const notifyAttempts = () => window.dispatchEvent(new Event(ATTEMPTS_EVENT));

const subscribeAttempts = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(CHECKOUT_ATTEMPT_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(ATTEMPTS_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ATTEMPTS_EVENT, listener);
  };
};

const storageOf = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Every record of this account in this company, as one string — a stable snapshot for `useSyncExternalStore`. */
function attemptsSnapshot(userId: string | null, tenantId: string): string {
  const storage = storageOf();
  if (storage === null || userId === null) return "";
  const prefix = `${CHECKOUT_ATTEMPT_PREFIX}${userId}.${tenantId}.`;
  const parts: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) parts.push(`${key}=${storage.getItem(key) ?? ""}`);
    }
  } catch {
    return "";
  }
  return parts.sort().join("\n");
}

/**
 * This account's open records in this company, by invoice — following other
 * tabs (`storage`) and this one (`notifyAttempts`).
 */
export function useCheckoutAttempts(userId: string | null, tenantId: string): ReadonlyMap<string, CheckoutAttempt> {
  const snapshot = useSyncExternalStore(subscribeAttempts, () => attemptsSnapshot(userId, tenantId));
  return useMemo(() => {
    const records = new Map<string, CheckoutAttempt>();
    const storage = storageOf();
    if (storage === null || userId === null || snapshot === "") return records;
    for (const line of snapshot.split("\n")) {
      const key = line.slice(0, line.indexOf("="));
      const invoiceId = key.slice(`${CHECKOUT_ATTEMPT_PREFIX}${userId}.${tenantId}.`.length);
      const record = readCheckoutAttempt(storage, userId, tenantId, invoiceId);
      if (record !== null && checkoutAttemptKey(userId, tenantId, invoiceId) === key) records.set(invoiceId, record);
    }
    return records;
  }, [snapshot, userId, tenantId]);
}

/** An attempt is unresolved once the server has answered it with a checkout: Pay waits for it (B4, B6). */
export const unresolved = (record: CheckoutAttempt | undefined | null): record is CheckoutAttempt & { checkoutId: string } =>
  record !== undefined && record !== null && record.checkoutId !== undefined;

export function closeAttempt(userId: string, tenantId: string, invoiceId: string): void {
  const storage = storageOf();
  if (storage === null) return;
  clearCheckoutAttempt(storage, userId, tenantId, invoiceId);
  notifyAttempts();
}

/* ------------------------------------------------------------ the press */

export interface PayRefusal {
  invoiceId: string;
  words: PayRefusalWords;
  requestId: string | null;
  /** Remounts the `ErrorNote` per attempt (B8), so each refusal is announced. */
  key: number;
}

/**
 * The Pay press (art-director B4, B8; api-contract-guard §2): one per invoice
 * at a time — a second press while one is out sends nothing, whether it is
 * the same click twice or another tab (the record's lock) —, the attempt's
 * key read or created before anything leaves, and the payment page opened in
 * this tab with `location.assign`. In flight from the press until the page
 * unloads; Back from the provider (`pageshow` persisted) makes it idle again,
 * re-reads, and puts focus back on the button pressed.
 */
export function usePayInvoice(options: {
  companyId: string;
  userId: string | null;
  returnTarget: ReturnTarget;
  company: string | null;
  creationDeadline?: string | null;
}) {
  const { companyId, userId, returnTarget, company, creationDeadline } = options;
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const refusals = useRef(0);
  const [inProgress, setInProgress] = useState<string | null>(null);
  const pressed = useRef<HTMLElement | null>(null);

  const reread = useCallback(
    (invoiceId: string) => {
      void queryClient.invalidateQueries({ queryKey: COMPANY_INVOICES_KEY });
      void queryClient.invalidateQueries({ queryKey: companyInvoiceKey(invoiceId) });
    },
    [queryClient],
  );

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pendingRef.current = false;
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: COMPANY_INVOICES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["company-invoice"] });
      pressed.current?.focus();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [queryClient]);

  const pay = async (invoice: Invoice, trigger: HTMLElement | null) => {
    const storage = storageOf();
    if (pendingRef.current || userId === null || storage === null) return;
    pendingRef.current = true;
    pressed.current = trigger;
    setPending(invoice.id);
    setRefusal(null);
    setInProgress(null);
    let checkout: Checkout;
    try {
      checkout = await withCheckoutAttempt(
        { storage, locks: browserCheckoutLocks(), userId, tenantId: companyId, invoiceId: invoice.id, returnTarget },
        (key, target) => taskaApi.createCheckout(companyId, invoice.id, target, key),
      );
    } catch (error) {
      pendingRef.current = false;
      setPending(null);
      if (closesAttempt(error)) closeAttempt(userId, companyId, invoice.id);
      else notifyAttempts();
      reread(invoice.id);
      const code = refusalCode(error);
      if (code === "OWNER_REQUIRED") {
        // Who owns it is the re-read company's to say (§4.39's G6).
        void queryClient.invalidateQueries({ queryKey: companyTenantKey(companyId) });
        void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      }
      if (code === "INVALID_STATE") {
        // Re-read, and follow it: still payable means another attempt is active (A57).
        let fresh: Invoice | null;
        try {
          fresh = await queryClient.fetchQuery({ ...companyInvoiceOptions(companyId, invoice.id), staleTime: 0 });
        } catch {
          fresh = null;
        }
        if (fresh !== null && isPayable(fresh)) setInProgress(invoice.id);
        return;
      }
      const words = payRefusalWords(error, company, { creationDeadline });
      if (words === null) return;
      refusals.current += 1;
      setRefusal({ invoiceId: invoice.id, words, requestId: apiErrorFacts(error).requestId, key: refusals.current });
      return;
    }
    notifyAttempts();
    if (checkout.redirect !== null && (checkout.state === "CREATED" || checkout.state === "PENDING")) {
      // The page goes; until it does, the button stays in flight.
      checkout.redirect.go();
      return;
    }
    // Answered without a page to open — a replay of an attempt that has moved
    // on: the watch reads where it is.
    pendingRef.current = false;
    setPending(null);
    reread(invoice.id);
    if (checkout.redirect === null && (checkout.state === "CREATED" || checkout.state === "PENDING")) {
      refusals.current += 1;
      setRefusal({ invoiceId: invoice.id, words: { text: "Taska couldn’t open the payment page.", words: null }, requestId: null, key: refusals.current });
    }
  };

  return { pay, pending, refusal, inProgress };
}

/** «Return to payment» (the guard's §4, addendum Q4): the same checkout's page, from a fresh read — never a new checkout. */
export async function returnToPayment(companyId: string, checkoutId: string): Promise<boolean> {
  const checkout = await taskaApi.getCheckout(companyId, checkoutId);
  if (checkout.redirect === null || (checkout.state !== "CREATED" && checkout.state !== "PENDING")) return false;
  checkout.redirect.go();
  return true;
}

/* ------------------------------------------------------------ the watch */

const INVOICE_ENDED: ReadonlySet<string> = new Set(["PAID", "EXPIRED", "VOID"]);
const CHECKOUT_ENDED: ReadonlySet<string> = new Set(["FAILED", "EXPIRED"]);

/** A checkout read that will never answer for this company: not here, or about another invoice. */
export const isLostCheckout = (error: unknown) =>
  error instanceof ForeignCompanyAnswerError || refusalCode(error) === "RESOURCE_NOT_FOUND" || apiErrorFacts(error).status === 404;

/**
 * An invoice, and — while an attempt of it is unresolved — its checkout, read
 * together at the provisioning cadence (art-director B6): 1, 2, 4, 8 s, then
 * every 10 s, paused in a hidden tab, read again on return; the copy changes
 * after 30 s; after 5 minutes the reads stop (UNKNOWN then reads on focus
 * only; the rest offers «Check again»). Stops for good once the invoice is
 * PAID, EXPIRED or VOID or the checkout FAILED or EXPIRED. No spinner, no
 * timer on screen.
 */
export function usePaymentWatch(options: { companyId: string; invoiceId: string | null; record: CheckoutAttempt | null; enabled: boolean }) {
  const { companyId, invoiceId, record, enabled } = options;
  const checkoutId = unresolved(record) ? record.checkoutId : null;
  const watching = enabled && checkoutId !== null && invoiceId !== null;
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [stage, setStage] = useState<WatchStage>("fresh");

  useEffect(() => {
    if (!watching) return;
    const left = (ms: number) => Math.max(0, ms - (Date.now() - startedAt));
    const slow = window.setTimeout(() => setStage((current) => (current === "fresh" ? "slow" : current)), left(SLOW_SETUP_MS));
    const stop = window.setTimeout(() => setStage("stopped"), left(POLL_LIMIT_MS));
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(stop);
    };
  }, [watching, startedAt]);

  const live = watching && stage !== "stopped";
  const reads = (state: { dataUpdateCount: number; errorUpdateCount: number }) => state.dataUpdateCount + state.errorUpdateCount - 1;

  const invoiceQuery = useQuery({
    ...companyInvoiceOptions(companyId, invoiceId ?? ""),
    enabled: enabled && invoiceId !== null,
    ...(watching ? { staleTime: 0, refetchOnWindowFocus: "always" as const } : {}),
    refetchInterval: (query) => {
      if (!live || INVOICE_ENDED.has(query.state.data?.state ?? "")) return false;
      return pollDelay(Math.max(0, reads(query.state)));
    },
  });
  const ended = INVOICE_ENDED.has(invoiceQuery.data?.state ?? "");
  const checkoutQuery = useQuery({
    queryKey: companyCheckoutKey(checkoutId ?? ""),
    queryFn: () => taskaApi.getCheckout(companyId, checkoutId as string),
    enabled: watching && !ended,
    retry: retryUnanswered,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => {
      if (!live || ended || CHECKOUT_ENDED.has(query.state.data?.state ?? "") || (query.state.error && isLostCheckout(query.state.error))) return false;
      return pollDelay(Math.max(0, reads(query.state)));
    },
  });
  // The checkout must be this invoice's (api-contract-guard §1, binding).
  const foreign = checkoutQuery.data !== undefined && checkoutQuery.data.invoiceId !== null && checkoutQuery.data.invoiceId !== invoiceId;

  const checkAgain = () => {
    setStage("fresh");
    setStartedAt(Date.now());
    void invoiceQuery.refetch();
    void checkoutQuery.refetch();
  };

  return {
    invoiceQuery,
    checkoutQuery,
    checkout: foreign ? null : (checkoutQuery.data ?? null),
    lost: foreign || (checkoutQuery.isError && isLostCheckout(checkoutQuery.error)),
    stage,
    checkAgain,
    watching,
  };
}

/**
 * What a settled payment makes the tab read again, once (the guard's §4): the
 * company, its subscription and its entitlement — rights come from them,
 * never from the payment — and the reader's list, whose row says whether it
 * opened.
 */
export function useRereadAfterPaid() {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  return useCallback(
    (companyId: string) => {
      void queryClient.invalidateQueries({ queryKey: companyTenantKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
      void queryClient.invalidateQueries({ queryKey: COMPANY_ENTITLEMENT_KEY });
      void queryClient.invalidateQueries({ queryKey: COMPANY_INVOICES_KEY });
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
    },
    [queryClient, accountClient],
  );
}

export { INVOICE_ENDED, CHECKOUT_ENDED };
