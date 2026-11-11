import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import type { ChangePlanInput } from "../../api/billing";
import { apiErrorFacts, isWorkspaceClosed, refusalCode } from "../../api/errors";
import { isSendableVersion } from "../../api/tenantMembers";
import type { PlanVersion, Tenant } from "../../api/tenants";
import { ErrorNote } from "../../components/ErrorNote";
import { Modal } from "../../components/Modal";
import { useMutation } from "../../hooks/useMutation";
import { freeUsedKnown, markFreeUsed } from "../../lib/companies";
import { useAccountQueryClient } from "../../lib/companyAddress";
import { FREE_USED_NOTE, planLimitsText, planName, planPriceText, plansQueryOptions, PLANS_QUERY_KEY } from "../../lib/plans";
import { COMPANY_SUBSCRIPTION_KEY, companySubscriptionOptions, companyTenantKey, companyTenantOptions } from "./companyGeneral";
import { COMPANY_QUOTAS_KEY } from "./companyMembersQuery";
import { COMPANY_ENTITLEMENT_KEY, companyEntitlementOptions } from "./companyPlan";
import { companyInvoiceOptions } from "./companyBilling";
import {
  hasCurrentPeriod,
  intentFor,
  planChoices,
  sendableCurrency,
  settleIntent,
  type PlanChoice,
  type SubscriptionIntent,
} from "./companyPlanChange";
import {
  CHANGE_PLAN,
  CHOOSE_PLAN_TEXT,
  CURRENT_PLAN_NOTE,
  PLANS_FAILED_TEXT,
  PLANS_LOADING_TEXT,
  dialogContextText,
  isUnanswered,
  planChangeConsequences,
  scheduledPlanNote,
  subscriptionRefusalWords,
  type ChangeInvoice,
} from "./companyPlanChangeText";
import { planById } from "./companyPlanText";
import type { RefusalWords } from "./companyGeneralText";

/** What a change the server accepted came to — drawn by the page from its server facts only. */
export interface PlanChangeOutcome {
  effect: string | null;
  target: PlanVersion;
  effectiveAt: string | null;
  invoice: ChangeInvoice;
}

interface ShownRefusal extends RefusalWords {
  requestId: string | null;
  seq: number;
}

interface Sent {
  intent: SubscriptionIntent;
  input: ChangePlanInput;
  target: PlanVersion;
}

/** A refusal, with the company as the re-read after it found it (`null`: not read, or the read failed). */
class Refused extends Error {
  constructor(
    readonly error: unknown,
    readonly tenant: Tenant | null,
  ) {
    super("");
    this.name = "Refused";
  }
}

/**
 * «Change plan» (TAS-515, art-director B3–B5 with the orchestrator's decisions
 * 2–4 and 7; DESIGN.md §4.11). Opening it reads the subscription again — the
 * `If-Match` the press sends — and the catalogue when it is stale. **Nothing
 * is preselected**, and nothing said before the press is a quote: the
 * sentences branch on the target's `kind` and the company's paid period only
 * (guard B2). The answer is §4.22's, not primary; in flight nothing closes
 * the dialog until the whole chain — the command, the invoice it named, the
 * re-reads — has answered. One key per confirmed intent (guard §2): a press
 * after an answer that never came sends the same key, `If-Match` and body.
 */
export function ChangePlanModal({
  companyId,
  company,
  meId,
  sessionId,
  onClose,
  onChanged,
  onOwnerLost,
}: {
  companyId: string;
  company: string | null;
  meId: string | null;
  sessionId: string | null;
  onClose: () => void;
  onChanged: (outcome: PlanChangeOutcome) => void;
  /** A refusal `OWNER_REQUIRED` whose re-read company names somebody else (§4.39's G6). */
  onOwnerLost: (tenant: Tenant) => void;
}) {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const formId = useId();
  const consequencesId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const plans = useQuery(plansQueryOptions(taskaApi), accountClient ?? undefined);
  const subscription = useQuery(companySubscriptionOptions(companyId));
  const entitlement = useQuery(companyEntitlementOptions(companyId));
  const tenant = useQuery(companyTenantOptions(companyId));
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ShownRefusal | null>(null);
  /** A 412 asked for focus on the heading once the re-reads have answered (B11). */
  const [headingFocus, setHeadingFocus] = useState(0);

  // On open, the `If-Match` the press will send (B3): read again, whatever the cache holds.
  useEffect(() => {
    void queryClient.fetchQuery({ ...companySubscriptionOptions(companyId), staleTime: 0 }).catch(() => undefined);
  }, [companyId, queryClient]);
  useEffect(() => {
    if (headingFocus > 0) titleRef.current?.focus();
  }, [headingFocus]);

  const catalogue = plans.data ?? null;
  const sub = subscription.data ?? null;
  const restrictions = tenant.data?.restrictions ?? [];
  const current = catalogue && entitlement.data ? planById(catalogue, entitlement.data.planVersionId) : null;
  const choices = catalogue
    ? planChoices({ catalogue, entitlement: entitlement.data ?? null, subscription: sub, restrictions, freeUsed: freeUsedKnown(meId) })
    : [];
  const chosen = choices.find((choice) => choice.plan.id === chosenId && choice.selectable) ?? null;
  const covered = hasCurrentPeriod(sub, restrictions);
  const scheduledPlan = catalogue && sub?.scheduledPlanVersionId ? planById(catalogue, sub.scheduledPlanVersionId) : null;
  const context = dialogContextText(company, current, sub?.paidThrough ?? null);
  const consequences =
    chosen === null
      ? null
      : planChangeConsequences({
          company,
          target: chosen.plan,
          current,
          covered,
          paidThrough: sub?.paidThrough ?? null,
          autopayState: sub?.autopayState ?? null,
          withdrawal: chosen.withdrawal ? { scheduled: scheduledPlan, at: sub?.scheduledEffectiveAt ?? null } : null,
        });

  const reread = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).catch(() => undefined);

  const change = useMutation({
    mutationFn: async ({ intent, input, target }: Sent): Promise<PlanChangeOutcome> => {
      let answer;
      try {
        answer = await taskaApi.changeSubscriptionPlan(companyId, input, intent.version, intent.key);
      } catch (error) {
        // An answer that never came: nothing read again — the next press repeats it (B11).
        if (isUnanswered(error) || isWorkspaceClosed(error)) throw error;
        // Any other refusal: in flight until the subscription and the company have been read again
        // (B11), so the next press goes with the fresh If-Match — the catalogue too after a 412, 404 or 400.
        const status = apiErrorFacts(error).status;
        const code = refusalCode(error);
        const catalogue =
          status === 412 || status === 404 || code === "VALIDATION_FAILED"
            ? accountClient?.invalidateQueries({ queryKey: PLANS_QUERY_KEY }).catch(() => undefined)
            : undefined;
        const [, company] = await Promise.all([
          reread(COMPANY_SUBSCRIPTION_KEY),
          queryClient.fetchQuery({ ...companyTenantOptions(companyId), staleTime: 0 }).catch(() => null),
          catalogue,
        ]);
        throw new Refused(error, company);
      }
      if (meId !== null) settleIntent(meId, companyId, intent, null);
      // The invoice it named — presented as this change's only when it says so (decision 4).
      let invoice: ChangeInvoice = { kind: "none" };
      if (answer.invoiceId !== null) {
        try {
          const read = await queryClient.fetchQuery({ ...companyInvoiceOptions(companyId, answer.invoiceId), staleTime: 0 });
          invoice = read.purpose === "PLAN_CHANGE" && read.planVersionId === target.id ? { kind: "verified", id: read.id, number: read.number } : { kind: "none" };
        } catch {
          invoice = { kind: "unread", id: answer.invoiceId };
        }
      }
      // Never the answer's subscription: what the page draws next is read again (guard §1, §7).
      if (answer.effect === "IMMEDIATE") {
        await reread(COMPANY_SUBSCRIPTION_KEY, COMPANY_ENTITLEMENT_KEY, COMPANY_QUOTAS_KEY, companyTenantKey(companyId));
      } else {
        await reread(COMPANY_SUBSCRIPTION_KEY);
      }
      return { effect: answer.effect, target, effectiveAt: answer.effectiveAt, invoice };
    },
    onSuccess: (outcome) => onChanged(outcome),
    onError: (thrown, sent) => {
      const error = thrown instanceof Refused ? thrown.error : thrown;
      if (meId !== null) settleIntent(meId, companyId, sent.intent, error);
      const code = refusalCode(error);
      const status = apiErrorFacts(error).status;
      const rereadCompany = thrown instanceof Refused ? thrown.tenant : null;
      if (code === "OWNER_REQUIRED" && rereadCompany !== null && rereadCompany.ownerId !== null && rereadCompany.ownerId !== meId) {
        // Somebody else owns it now (§4.39's G6): the dialog closes and the page follows.
        onOwnerLost(rereadCompany);
        return;
      }
      const words = subscriptionRefusalWords("changePlan", error, company, sent.target);
      setRefusal((previous) => ({ ...words, requestId: apiErrorFacts(error).requestId, seq: (previous?.seq ?? 0) + 1 }));
      if (code === "FREE_ELIGIBILITY_USED") {
        // Known until sign-out (TAS-501's precedent); the row says so, and nothing is chosen.
        if (meId !== null) markFreeUsed(meId);
        setChosenId(null);
      }
      if (code === "RESOURCE_NOT_FOUND" || status === 404 || code === "VALIDATION_FAILED") setChosenId(null);
      // The dialog stays, read again; the choice kept if still offered; focus on its heading (B11).
      if (status === 412) setHeadingFocus((value) => value + 1);
    },
  });
  const busy = change.isPending;

  // A choice the re-read no longer offers is dropped (B11 «412»).
  if (chosenId !== null && catalogue !== null && !choices.some((choice) => choice.plan.id === chosenId && choice.selectable)) setChosenId(null);

  const focusGroup = () => {
    const group = groupRef.current;
    (group?.querySelector<HTMLInputElement>("input[type=radio]:checked") ?? group?.querySelector<HTMLInputElement>("input[type=radio]:not(:disabled)"))?.focus();
  };

  const confirm = () => {
    if (busy) return;
    if (chosen === null) {
      focusGroup();
      return;
    }
    const currency = sendableCurrency(chosen.plan);
    const version = sub?.version ?? null;
    if (meId === null || currency === null || !isSendableVersion(version)) {
      void reread(COMPANY_SUBSCRIPTION_KEY);
      return;
    }
    const intent = intentFor(meId, companyId, "changePlan", `${chosen.sendId}:${currency}`, version, sessionId);
    setRefusal(null);
    change.mutate({ intent, input: { planVersionId: chosen.sendId, currency, paymentMethod: "PSP" }, target: chosen.plan });
  };

  const close = () => {
    // ✕, the scrim and Esc close nothing while the chain is out (§4.11's exception, as Transfer).
    if (!busy) onClose();
  };

  const firstSelectable = choices.find((choice) => choice.selectable)?.plan.id ?? null;
  let field;
  if (plans.isPending) {
    field = (
      <p className="company-transfer-note" role="status">
        {PLANS_LOADING_TEXT}
      </p>
    );
  } else if (catalogue === null) {
    field = (
      <div className="company-transfer-failure">
        <ErrorNote requestId={apiErrorFacts(plans.error).requestId}>{PLANS_FAILED_TEXT}</ErrorNote>
        <button
          aria-disabled={plans.isFetching || undefined}
          className="secondary-button compact-button company-transfer-retry"
          onClick={() => {
            if (!plans.isFetching) void plans.refetch();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  } else {
    field = (
      <fieldset className="token-access company-plan-change-plans" ref={groupRef}>
        <legend>Plan</legend>
        <div className="token-access-options">
          {choices.map((choice) => (
            <PlanRow
              busy={busy}
              checked={chosenId === choice.plan.id}
              choice={choice}
              first={choice.plan.id === firstSelectable}
              formId={formId}
              key={choice.plan.id}
              noteText={noteText(choice, sub?.scheduledEffectiveAt ?? null)}
              onChoose={() => {
                if (busy) return;
                setChosenId(choice.plan.id);
                setRefusal(null);
              }}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Modal busy={busy} onClose={close} title={CHANGE_PLAN} titleRef={titleRef}>
      <div
        className="company-plan-change-body"
        onKeyDown={(event) => {
          // §4.11: Cmd/Ctrl+Enter answers only once a plan is chosen; a plain Enter on a radio submits nothing.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (chosen !== null) confirm();
          }
        }}
      >
        {context !== null ? <p className="company-plan-change-context">{context}</p> : null}
        {field}
        <div className="company-transfer-consequences company-plan-change-consequences" id={consequencesId}>
          {consequences === null ? (
            <p className="company-plan-change-hint">{CHOOSE_PLAN_TEXT}</p>
          ) : (
            consequences.map((line) => <p key={line}>{line}</p>)
          )}
        </div>
        {refusal ? (
          <ErrorNote key={refusal.seq} live="alert" requestId={refusal.requestId} serverWords={refusal.words}>
            {refusal.text}
          </ErrorNote>
        ) : null}
        <div className="modal-actions">
          <button
            aria-disabled={busy || undefined}
            className="secondary-button company-plan-change-cancel"
            onClick={close}
            type="button"
          >
            Cancel
          </button>
          {/* §4.22's answer, not primary: paid → Free cannot be undone (B3). Steadily unavailable until a choice. */}
          <button
            aria-describedby={consequencesId}
            aria-disabled={busy || chosen === null || undefined}
            className={`secondary-button member-confirm-accept company-plan-change-confirm${chosen === null && !busy ? " is-unavailable" : ""}`}
            data-busy={busy || undefined}
            onClick={confirm}
            type="button"
          >
            {CHANGE_PLAN}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const noteText = (choice: PlanChoice, scheduledAt: string | null): string | null => {
  switch (choice.note) {
    case "current":
      return CURRENT_PLAN_NOTE;
    case "scheduled":
      return scheduledPlanNote(scheduledAt);
    case "free-used":
      return FREE_USED_NOTE;
    default:
      return null;
  }
};

/** One plan of §4.36's radio recipe: the row its label, the price right, the limits under it, and why it cannot be chosen. */
function PlanRow({
  choice,
  formId,
  checked,
  busy,
  first,
  noteText: note,
  onChoose,
}: {
  choice: PlanChoice;
  formId: string;
  checked: boolean;
  busy: boolean;
  first: boolean;
  noteText: string | null;
  onChoose: () => void;
}) {
  const { plan, selectable } = choice;
  const id = `${formId}-${plan.id}`;
  const price = planPriceText(plan);
  const limits = planLimitsText(plan);
  const described = [limits === "" ? null : `${id}-limits`, note === null ? null : `${id}-note`].filter(Boolean).join(" ");
  return (
    <label className={`token-access-option create-company-plan company-plan-change-option${selectable ? "" : " is-used"}`}>
      <input
        aria-describedby={described === "" ? undefined : described}
        aria-disabled={busy || undefined}
        aria-labelledby={price ? `${id}-name ${id}-price` : `${id}-name`}
        // Focus on open on the first plan that can be chosen, nothing checked (B13).
        autoFocus={first}
        checked={checked}
        disabled={!selectable}
        name={`${formId}-plan`}
        onChange={onChoose}
        type="radio"
        value={plan.id}
      />
      <span className="token-access-text">
        <span className="create-company-plan-head">
          <span className="token-access-title create-company-plan-name" id={`${id}-name`}>
            {planName(plan)}
          </span>
          {price ? (
            <span className="create-company-plan-price" id={`${id}-price`}>
              {price}
            </span>
          ) : null}
        </span>
        {limits !== "" ? (
          <span className="token-access-description" id={`${id}-limits`}>
            {limits}
          </span>
        ) : null}
        {note !== null ? (
          <span className="token-access-description" id={`${id}-note`}>
            {note}
          </span>
        ) : null}
      </span>
    </label>
  );
}
