import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isWorkspaceClosed } from "../api/errors";
import {
  clearTenantCreation,
  newIdempotencyKey,
  openTenantCreation,
  readTenantCreation,
  writeTenantCreation,
  type TenantCreationRecord,
} from "../api/tenantCreation";
import { trimTenantName, withoutControlCharacters, TENANT_NAME_MAX, type CreateTenantResult, type Tenant } from "../api/tenants";
import { AuthShell } from "../components/AuthShell";
import { ErrorNote } from "../components/ErrorNote";
import { useDocumentTitle } from "../hooks/useCompanies";
import {
  COMPANIES_ROUTE,
  TENANTS_QUERY_KEY,
  companyRoute,
  freeUsedKnown,
  markFreeUsed,
  splitCompanyRoute,
  upsertTenant,
  type ContinuedShellState,
} from "../lib/companies";
import { useCompanyAddress } from "../lib/companyAddress";
import {
  FREE_USED_NOTE,
  PAID_PLAN_NOTE,
  isFreePlan,
  offeredPlans,
  planLimitsText,
  planName,
  planPriceText,
  plansQueryOptions,
} from "../lib/plans";
import type { ScreenProps } from "./App";
import { creationRefusal, type CreationRefusal } from "./createCompanyText";

/** What a navigation to `/companies/new` may carry (§4.36): the company address it was opened from. */
export interface CreateCompanyRouteState extends ContinuedShellState {
  from?: string | null;
}

/** Router state of the company address a 202 lands on: a working company takes focus to «New project» (§4.36). */
export interface CompanyReadyState extends ContinuedShellState {
  companyReady?: boolean;
}

/** The tab's storage, or none — a locked-down profile keeps the attempt for the page's life only. */
function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * DESIGN.md §4.36 «Создание компании» (TAS-501, the companies build only):
 * `/companies/new` in the sign-in card's shell. A name, a plan from the
 * published catalogue, and one idempotent attempt: the key and the body go to
 * `sessionStorage` before the request leaves (`src/api/tenantCreation.ts`),
 * every retry sends them again, and a reload replays an unanswered attempt by
 * itself. A 202 puts the company into the reader's list in the same frame and
 * moves the tab to its address with a replace; a refusal never draws one.
 */
export function CreateCompanyScreen({ theme, toggleTheme }: ScreenProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const address = useCompanyAddress();
  const queryClient = useQueryClient();
  const state = (location.state ?? {}) as CreateCompanyRouteState;
  const from = typeof state.from === "string" && splitCompanyRoute(state.from) !== null ? state.from : null;
  const me = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const plans = useQuery(plansQueryOptions(taskaApi));
  const userId = me.data?.id ?? null;

  const formId = useId();
  const nameId = `${formId}-name`;
  const nameHintId = `${formId}-name-hint`;
  const nameRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLFieldSetElement>(null);

  // A sent attempt this tab has no definitive answer for — restored from the
  // first frame on a reload, so the form is drawn in flight and replays it.
  const [attempt, setAttempt] = useState<TenantCreationRecord | null>(() => {
    const storage = tabStorage();
    const record = storage ? readTenantCreation(storage) : null;
    return record !== null && record.tenantId === undefined ? record : null;
  });
  const [sending, setSending] = useState(attempt !== null);
  const [name, setName] = useState(attempt?.name ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  /** The reader's own choice; `null` — the default, which is the free plan unless it is known to be used. */
  const [planId, setPlanId] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [refusal, setRefusal] = useState<{ outcome: CreationRefusal; key: number } | null>(null);
  const [planRetries, setPlanRetries] = useState(0);
  const mounted = useRef(true);
  const replayed = useRef(false);

  useDocumentTitle("Create a company — Taska");

  useEffect(() => {
    mounted.current = true;
    nameRef.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  const freeUsed = freeUsedKnown(userId);
  const offered = plans.data ? offeredPlans(plans.data) : null;
  const defaultPlan = offered?.find((plan) => isFreePlan(plan) && !freeUsed) ?? null;
  const chosenId = attempt?.planVersionId ?? planId ?? (cleared ? null : (defaultPlan?.id ?? null));
  const chosen = offered?.find((plan) => plan.id === chosenId) ?? null;
  const chosenUsable = attempt !== null || (chosen !== null && !(isFreePlan(chosen) && freeUsed));
  const locked = attempt !== null;
  const nameProblem = nameTouched && !locked && trimTenantName(name) === "" ? "Enter a company name." : null;

  const finish = (record: TenantCreationRecord, result: CreateTenantResult) => {
    const storage = tabStorage();
    const { tenant, operation } = result;
    // Still being set up or awaiting payment: the card polls by these ids
    // (Tenant carries neither, ask A11). Working or closed: nothing to poll.
    if (storage) {
      if (tenant.lifecycle === "PROVISIONING" || tenant.lifecycle === "AWAITING_PAYMENT") {
        writeTenantCreation(storage, { ...record, tenantId: tenant.id, operationId: operation.id });
      } else {
        clearTenantCreation(storage);
      }
    }
    // In this frame, from the answer: the switcher and the picker know it
    // before the list is read again.
    queryClient.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => upsertTenant(list, tenant));
    void queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
    const next: CompanyReadyState = { continuedShell: true, ...(tenant.lifecycle === "ACTIVE" ? { companyReady: true } : {}) };
    if (address) address.go(companyRoute(tenant.id), { replace: true, state: next });
  };

  const fail = (record: TenantCreationRecord, error: unknown) => {
    if (isWorkspaceClosed(error)) {
      setSending(false);
      return;
    }
    const outcome = creationRefusal(error);
    if (outcome.closesAttempt) {
      const storage = tabStorage();
      if (storage) clearTenantCreation(storage);
      setAttempt(null);
      if (outcome.kind === "free-used") {
        markFreeUsed(record.userId);
        setPlanId(null);
        setCleared(true);
      } else {
        // What was typed and chosen stays (§4.36).
        setPlanId(record.planVersionId);
      }
      if (outcome.kind === "name-or-plan") void plans.refetch();
    }
    setRefusal((previous) => ({ outcome, key: (previous?.key ?? 0) + 1 }));
    setSending(false);
  };

  const send = (record: TenantCreationRecord) => {
    setSending(true);
    taskaApi.createTenant({ name: record.name, planVersionId: record.planVersionId }, record.key).then(
      (result) => {
        if (mounted.current) finish(record, result);
      },
      (error: unknown) => {
        if (mounted.current) fail(record, error);
      },
    );
  };

  // The reload's replay, once the account is known: the same key, the same
  // body. A record of another account is dropped unread.
  useEffect(() => {
    if (replayed.current || attempt === null) return;
    if (me.isError) {
      // The account could not be read: the press retries.
      replayed.current = true;
      setSending(false);
      return;
    }
    if (userId === null) return;
    replayed.current = true;
    const storage = tabStorage();
    const record = storage ? openTenantCreation(storage, userId) : attempt;
    if (record === null || record.key !== attempt.key) {
      setAttempt(null);
      setName("");
      setSending(false);
      return;
    }
    send(record);
    // Once, on arrival: later presses go through `submit`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, me.isError]);

  const focusPlans = () => {
    const group = groupRef.current;
    const target =
      group?.querySelector<HTMLInputElement>("input[type=radio]:checked:not(:disabled)") ??
      group?.querySelector<HTMLInputElement>("input[type=radio]:not(:disabled)");
    target?.focus();
  };

  const submit = async () => {
    if (sending) return;
    if (attempt !== null) {
      // The outcome is unknown: the same key and the same body, whatever is on screen.
      send(attempt);
      return;
    }
    const trimmed = trimTenantName(name);
    if (trimmed === "") {
      setNameTouched(true);
      nameRef.current?.focus();
      return;
    }
    if (chosen === null || !chosenUsable) {
      focusPlans();
      return;
    }
    setSending(true);
    let accountId = userId;
    if (accountId === null) {
      try {
        accountId = (await queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() })).id;
      } catch (error) {
        if (mounted.current) {
          setRefusal((previous) => ({ outcome: creationRefusal(error), key: (previous?.key ?? 0) + 1 }));
          setSending(false);
        }
        return;
      }
    }
    const record: TenantCreationRecord = {
      v: 1,
      userId: accountId,
      key: newIdempotencyKey(),
      name: trimmed,
      planVersionId: chosen.id,
      sentAt: new Date().toISOString(),
    };
    // Before the request leaves, in one `setItem` (B2).
    const storage = tabStorage();
    if (storage) writeTenantCreation(storage, record);
    setAttempt(record);
    setName(trimmed);
    send(record);
  };

  const cancel = () => {
    if (from !== null && address) {
      address.go(from, { replace: true, state: { continuedShell: true } satisfies ContinuedShellState });
      return;
    }
    navigate(COMPANIES_ROUTE, { replace: true, state: { focusHeading: true } });
  };

  const planFailure = plans.isError && !plans.data ? apiErrorFacts(plans.error) : null;
  const showCreate = attempt !== null || (offered !== null && offered.length > 0);

  return (
    <AuthShell entrance="app" theme={theme} toggleTheme={toggleTheme}>
      {/* `noValidate`: the name's rule is the form's own sentence (§4.36), not the browser's bubble. */}
      <form
        className="form-stack create-company"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="auth-title" tabIndex={-1}>
          Create a company
        </h1>

        <div className="field">
          <label htmlFor={nameId}>Company name</label>
          <input
            aria-describedby={nameHintId}
            aria-invalid={nameProblem ? true : undefined}
            autoComplete="organization"
            id={nameId}
            maxLength={TENANT_NAME_MAX}
            onChange={(event) => {
              if (locked) return;
              setName(withoutControlCharacters(event.target.value));
              setNameTouched(true);
            }}
            readOnly={locked}
            ref={nameRef}
            spellCheck={false}
            value={name}
          />
          <p className="auth-field-hint" id={nameHintId}>
            {nameProblem ?? "Everyone you invite will see this name."}
          </p>
        </div>

        {offered === null && planFailure === null ? (
          <p className="create-company-loading" role="status">
            Loading plans
          </p>
        ) : planFailure !== null ? (
          <div className="create-company-plan-failure">
            <ErrorNote key={planRetries} live={planRetries > 0 ? "alert" : undefined} requestId={planFailure.requestId} serverWords={planFailure.message}>
              Plans could not be loaded.
            </ErrorNote>
          </div>
        ) : offered !== null && offered.length === 0 ? (
          <p className="create-company-loading">No plans are available right now.</p>
        ) : offered !== null ? (
          <fieldset className="token-access create-company-plans" ref={groupRef}>
            <legend>Plan</legend>
            <div className="token-access-options">
              {offered.map((plan) => {
                const free = isFreePlan(plan);
                const used = free && freeUsed && attempt?.planVersionId !== plan.id;
                const price = planPriceText(plan);
                const id = `${formId}-${plan.id}`;
                return (
                  <label className={used ? "token-access-option create-company-plan is-used" : "token-access-option create-company-plan"} key={plan.id}>
                    <input
                      aria-describedby={free ? `${id}-limits` : `${id}-limits ${id}-note`}
                      aria-labelledby={price ? `${id}-name ${id}-price` : `${id}-name`}
                      checked={chosenId === plan.id}
                      disabled={used}
                      name={`${formId}-plan`}
                      onChange={() => {
                        if (locked) return;
                        setPlanId(plan.id);
                        setCleared(false);
                      }}
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
                      <span className="token-access-description" id={`${id}-limits`}>
                        {used ? FREE_USED_NOTE : planLimitsText(plan)}
                      </span>
                      {free ? null : (
                        <span className="token-access-description" id={`${id}-note`}>
                          {PAID_PLAN_NOTE}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {showCreate ? (
          <button
            aria-disabled={sending || !chosenUsable || undefined}
            className={`primary-button auth-submit${!sending && !chosenUsable ? " is-unavailable" : ""}`}
            type="submit"
          >
            {sending ? "Creating company" : "Create company"}
          </button>
        ) : planFailure !== null ? (
          <button
            aria-disabled={plans.isFetching || undefined}
            className="secondary-button auth-retry"
            onClick={() => {
              if (plans.isFetching) return;
              setPlanRetries((count) => count + 1);
              void plans.refetch();
            }}
            type="button"
          >
            Try again
          </button>
        ) : null}

        {refusal ? (
          <ErrorNote
            key={refusal.key}
            live="alert"
            requestId={refusal.outcome.requestId}
            serverWords={refusal.outcome.serverWords}
          >
            {refusal.outcome.text}
          </ErrorNote>
        ) : null}

        <button className="auth-ghost" onClick={cancel} type="button">
          Cancel
        </button>
      </form>
    </AuthShell>
  );
}
