import { afterEach, describe, expect, it } from "vitest";
import { UnreadableAnswerError } from "../../api/billing";
import { WorkspaceClosedError } from "../../api/errors";
import { ForeignCompanyAnswerError, type PlanVersion, type Subscription } from "../../api/tenants";
import {
  forgetSubscriptionIntents,
  hasCurrentPeriod,
  intentFor,
  keepsIntent,
  openIntent,
  pendingSuperseded,
  planChoices,
  settleIntent,
  type PendingChange,
} from "./companyPlanChange";
import {
  autopayLineText,
  canTurnOff,
  cancelRenewalQuestion,
  dialogContextText,
  isUnanswered,
  planChangeConsequences,
  planChangeInvoiceText,
  planChangedStatus,
  subscriptionRefusalWords,
  turnOffQuestion,
  withdrawalStatus,
} from "./companyPlanChangeText";

/*
 * TAS-515's pure parts: one key per intent (api-contract-guard §2), the plans
 * the dialog offers (decision 3), what it says before the press (decision 2 —
 * no quote), the status after (B5, decision 4), automatic payments (decision
 * 1), and the refusals (B11 with decision 7).
 */

const EUR = (amountMinor: string) => ({ amountMinor, currency: "EUR", exponent: 2 });
const plan = (id: string, overrides: Partial<PlanVersion> = {}): PlanVersion => ({
  id,
  kind: "PAID",
  code: id,
  name: id[0].toUpperCase() + id.slice(1),
  version: "1",
  price: EUR("2000"),
  period: "CALENDAR_MONTH",
  limits: [],
  state: "PUBLISHED",
  ...overrides,
});
const FREE = plan("free", {
  kind: "FREE",
  price: EUR("0"),
  period: "NONE",
  limits: [
    { kind: "SEAT", limit: "5", unlimited: false },
    { kind: "PROJECT", limit: "1", unlimited: false },
  ],
});
const STARTER = plan("starter", { price: EUR("1000") });
const TEAM = plan("team");
const BUSINESS = plan("business", { price: EUR("4000") });
const RETIRED = plan("old", { state: "RETIRED" });
const ODD = plan("odd", { price: null });
const CATALOGUE = [BUSINESS, TEAM, FREE, STARTER, RETIRED, ODD];
const THROUGH = "2026-12-26T03:36:00Z";

const subscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  tenantId: "t",
  planVersionId: "team",
  version: "7",
  paidThrough: THROUGH,
  autopayState: "CONSENTED",
  renewalCancelled: false,
  scheduledPlanVersionId: null,
  scheduledEffectiveAt: null,
  ...overrides,
});
const entitlement = { tenantId: "t", version: "3", planVersionId: "team", limits: [] };
const problem = (status: number, code: string, reasons: string[] = []) => Object.assign(new Error("the server's words"), { status, code, requestId: "rid", details: null, reasons });

afterEach(() => forgetSubscriptionIntents());

describe("one key per intent (§2)", () => {
  it("an answer that never came keeps key, If-Match and body for the next press; a 2xx or a definite refusal closes it", () => {
    const first = intentFor("me", "t", "changePlan", "starter:EUR", "7", "s1");
    settleIntent("me", "t", first, new TypeError("Failed to fetch"));
    // A re-read version does not change what a retry sends.
    expect(intentFor("me", "t", "changePlan", "starter:EUR", "9", "s1")).toBe(first);
    // Another body is another intent.
    const other = intentFor("me", "t", "changePlan", "business:EUR", "9", "s1");
    expect(other.key).not.toBe(first.key);
    expect(other.version).toBe("9");
    settleIntent("me", "t", other, problem(412, "VERSION_CONFLICT"));
    expect(intentFor("me", "t", "changePlan", "business:EUR", "10", "s1").key).not.toBe(other.key);
  });

  it("another company session, another account or sign-out never sends it again", () => {
    const sent = intentFor("me", "t", "autopayOff", "autopayOff", "7", "s1");
    settleIntent("me", "t", sent, problem(503, "DEPENDENCY_UNAVAILABLE"));
    expect(intentFor("me", "t", "autopayOff", "autopayOff", "7", "s2").key).not.toBe(sent.key);
    const again = intentFor("me", "t", "cancelRenewal", "cancelRenewal", "7", "s1");
    settleIntent("me", "t", again, new TypeError("Failed to fetch"));
    expect(intentFor("you", "t", "cancelRenewal", "cancelRenewal", "7", "s1").key).not.toBe(again.key);
    forgetSubscriptionIntents();
    expect(intentFor("me", "t", "cancelRenewal", "cancelRenewal", "7", "s1").key).not.toBe(again.key);
  });

  it("stays open on a loss, 408, 429, a 5xx and DEPENDENCY_UNAVAILABLE, a foreign or unreadable 2xx; closes on the rest", () => {
    for (const error of [
      new TypeError("Failed to fetch"),
      problem(408, "REQUEST_TIMEOUT"),
      problem(429, "RATE_LIMITED"),
      problem(500, "INTERNAL"),
      problem(503, "DEPENDENCY_UNAVAILABLE"),
      new ForeignCompanyAnswerError(),
      new UnreadableAnswerError(),
    ]) {
      expect(keepsIntent(error), String((error as { code?: string }).code ?? error.name)).toBe(true);
    }
    for (const error of [
      problem(412, "VERSION_CONFLICT"),
      problem(428, "VERSION_CONFLICT"),
      problem(409, "IDEMPOTENCY_CONFLICT"),
      problem(409, "FREE_ELIGIBILITY_USED"),
      problem(400, "VALIDATION_FAILED"),
      problem(403, "OWNER_REQUIRED"),
      problem(404, "RESOURCE_NOT_FOUND"),
      problem(422, "CONFIRMATION_REQUIRED"),
      problem(503, "POLICY_NOT_CONFIGURED"),
      new WorkspaceClosedError(),
    ]) {
      expect(keepsIntent(error), (error as { code?: string }).code ?? error.name).toBe(false);
    }
    // A foreign or unreadable answer keeps the key but is read again; a loss is not.
    expect(isUnanswered(new ForeignCompanyAnswerError())).toBe(false);
    expect(isUnanswered(new TypeError("Failed to fetch"))).toBe(true);
  });
});

describe("an intent a reopened dialog shows again (art-director copy ruling)", () => {
  it("only an open one — kept after an answer that never came, with what it was said as", () => {
    const sent = intentFor("me", "t", "changePlan", "starter:EUR", "7", "s1", "starter");
    expect(openIntent("me", "t", "changePlan", "s1")).toBeNull();
    const shown = { text: "Taska couldn’t confirm the plan change.", words: "down", requestId: "rid" };
    settleIntent("me", "t", sent, new TypeError("Failed to fetch"), shown);
    expect(openIntent("me", "t", "changePlan", "s1")).toMatchObject({ planId: "starter", shown });
    expect(openIntent("me", "t", "changePlan", "s2")).toBeNull();
    settleIntent("me", "t", sent, null);
    expect(openIntent("me", "t", "changePlan", "s1")).toBeNull();
  });
});

describe("a pending change superseded (guard M-1, release-reviewer M1)", () => {
  const change: PendingChange = {
    effect: "AFTER_PAYMENT",
    planVersionId: "starter",
    invoice: { kind: "none" },
    sessionId: "s1",
    subscriptionVersion: "8",
    paidThrough: THROUGH,
    entitlementVersion: "3",
    entitlementPlan: "team",
  };
  const ent = (version: string, planVersionId: string) => ({ ...entitlement, version, planVersionId });

  it("stays while nothing says otherwise — a restriction moving the entitlement's version included", () => {
    expect(pendingSuperseded(change, subscription({ version: "8" }), ent("3", "team"))).toBe(false);
    expect(pendingSuperseded(change, subscription({ version: "8" }), ent("4", "team"))).toBe(false);
    // A later version with nothing scheduled and the same paid period — a cancel in another tab — is not it.
    expect(pendingSuperseded(change, subscription({ version: "9", renewalCancelled: true }), ent("3", "team"))).toBe(false);
  });

  it("goes when a later subscription schedules something, or starts another paid period, or a later entitlement names another plan", () => {
    expect(pendingSuperseded(change, subscription({ version: "9", scheduledPlanVersionId: "business", scheduledEffectiveAt: THROUGH }), ent("3", "team"))).toBe(true);
    expect(pendingSuperseded(change, subscription({ version: "9", paidThrough: "2027-01-20T09:00:00Z" }), ent("3", "team"))).toBe(true);
    expect(pendingSuperseded(change, subscription({ version: "8" }), ent("4", "starter"))).toBe(true);
    expect(pendingSuperseded(change, subscription({ version: "8" }), ent("4", "free"))).toBe(true);
  });

  it("a NEXT_PERIOD record lasts while its plan is the scheduled one", () => {
    const next: PendingChange = { ...change, effect: "NEXT_PERIOD", planVersionId: "business" };
    expect(pendingSuperseded(next, subscription({ scheduledPlanVersionId: "business", scheduledEffectiveAt: THROUGH }), null)).toBe(false);
    expect(pendingSuperseded(next, subscription({ scheduledPlanVersionId: null }), null)).toBe(true);
  });
});

describe("the plans offered (decision 3)", () => {
  const choices = (overrides: Partial<Subscription> = {}, restrictions: string[] = [], freeUsed = false, ent = entitlement) =>
    planChoices({ catalogue: CATALOGUE, entitlement: ent, subscription: subscription(overrides), restrictions, freeUsed }).map((choice) => [
      choice.plan.id,
      choice.selectable,
      choice.note,
    ]);

  it("published plans with a readable price, by price — the current one «Current plan», disabled", () => {
    expect(choices()).toEqual([
      ["free", true, null],
      ["starter", true, null],
      ["team", false, "current"],
      ["business", true, null],
    ]);
  });

  it("while a change is scheduled the current plan is a withdrawal and the scheduled one is taken; under PAYMENT_EXPIRED it is for sale again", () => {
    const scheduled = planChoices({
      catalogue: CATALOGUE,
      entitlement,
      subscription: subscription({ scheduledPlanVersionId: "business", scheduledEffectiveAt: THROUGH }),
      restrictions: [],
      freeUsed: false,
    });
    expect(scheduled.find((choice) => choice.plan.id === "team")).toMatchObject({ selectable: true, withdrawal: true, sendId: "team" });
    expect(scheduled.find((choice) => choice.plan.id === "business")).toMatchObject({ selectable: false, note: "scheduled" });
    expect(choices({}, ["PAYMENT_EXPIRED"]).find(([id]) => id === "team")).toEqual(["team", true, "current"]);
    // Past an unpaid boundary the id alone is no schedule: nothing is taken.
    expect(choices({ scheduledPlanVersionId: "business", scheduledEffectiveAt: null }).find(([id]) => id === "business")).toEqual(["business", true, null]);
  });

  it("never when the entitlement and the subscription disagree about the plan; Free disabled once refused", () => {
    expect(choices({ planVersionId: "starter" }, ["PAYMENT_EXPIRED"]).find(([id]) => id === "team")).toEqual(["team", false, "current"]);
    expect(choices({}, [], true)[0]).toEqual(["free", false, "free-used"]);
  });

  it("a current paid period: paidThrough sent and no PAYMENT_EXPIRED", () => {
    expect(hasCurrentPeriod(subscription(), [])).toBe(true);
    expect(hasCurrentPeriod(subscription(), ["PAYMENT_EXPIRED"])).toBe(false);
    expect(hasCurrentPeriod(subscription({ paidThrough: null }), [])).toBe(false);
  });
});

describe("what the dialog says before the press (decision 2, guard B2)", () => {
  const base = { company: "Umbrella", current: TEAM, covered: true, paidThrough: THROUGH, autopayState: "CONSENTED", withdrawal: null };

  it("paid → Free: at once, the rest of the period not kept, the limits, and automatic payments only when they are on", () => {
    const lines = planChangeConsequences({ ...base, target: FREE });
    expect(lines[0]).toBe("Umbrella moves to Free as soon as you confirm.");
    expect(lines[1]).toMatch(/^Its paid period ends now\. The rest of it, until Dec 2[56], .+, isn’t kept or refunded — moving back to a paid plan later needs a new payment and starts a new month\.$/);
    expect(lines[2]).toBe(
      "Free allows 1 project and 5 seats. If Umbrella uses more, nothing new can be added or changed until it’s back within them, though members can still be removed and invitations revoked. Archived projects count too.",
    );
    expect(lines[3]).toBe("Automatic payments turn off.");
    expect(planChangeConsequences({ ...base, target: FREE, autopayState: "SUSPENDED" })).not.toContain("Automatic payments turn off.");
    // Without a current period nothing of one is said.
    expect(planChangeConsequences({ ...base, target: FREE, covered: false }).some((line) => line.startsWith("Its paid period"))).toBe(false);
  });

  it("no current period → paid: after its payment, with a month from it; paid → paid is neutral — no price compared", () => {
    expect(planChangeConsequences({ ...base, covered: false, target: STARTER })).toEqual([
      "Starter starts once it’s paid for, with a month from the payment. Until then, Umbrella stays on Team.",
      "Nothing is charged when you confirm.",
    ]);
    for (const target of [STARTER, BUSINESS]) {
      expect(planChangeConsequences({ ...base, target })).toEqual([
        `Taska shows when ${target.name} starts, and what there is to pay, once you confirm.`,
        "Nothing is charged when you confirm.",
      ]);
    }
  });

  it("the current plan while a change is scheduled: what is dropped", () => {
    // Nothing says whether it is paid: a paid one still starts (guard M-2).
    expect(planChangeConsequences({ ...base, target: TEAM, withdrawal: { scheduled: BUSINESS, at: THROUGH } })[0]).toMatch(
      /^Umbrella stays on Team\. The change to Business from Dec 2[56], .+ is dropped — unless it’s already paid for; then it still starts on that date\.$/,
    );
    expect(withdrawalStatus({ company: "Umbrella", current: TEAM, scheduled: BUSINESS, kept: false, at: null })).toBe("The change to Business is dropped. Umbrella stays on Team.");
    expect(withdrawalStatus({ company: "Umbrella", current: TEAM, scheduled: BUSINESS, kept: true, at: THROUGH })).toMatch(
      /^The change to Business is already paid for, so it still starts Dec 2[56], .+\.$/,
    );
  });

  it("the context line, with and without a paid period", () => {
    expect(dialogContextText("Umbrella", TEAM, THROUGH)).toMatch(/^Umbrella is on Team · version 1, €20 a month, paid until Dec 2[56], /);
    expect(dialogContextText("Umbrella", TEAM, THROUGH, true)).toMatch(/^Umbrella is on Team · version 1, €20 a month\. Its paid period ended Dec 2[56], .+\.$/);
    expect(dialogContextText("Umbrella", FREE, null)).toBe("Umbrella is on Free · version 1.");
    expect(dialogContextText("Umbrella", null, THROUGH)).toBeNull();
  });
});

describe("after the answer (B5, decision 4)", () => {
  const status = (effect: string | null, invoice: Parameters<typeof planChangedStatus>[0]["invoice"], effectiveAt: string | null = null) =>
    planChangedStatus({ company: "Umbrella", target: STARTER, effect, effectiveAt, invoice });

  it("follows the server's effect, never the predicted branch", () => {
    expect(status("IMMEDIATE", { kind: "none" })).toBe("Umbrella is now on Starter.");
    expect(status("AFTER_PAYMENT", { kind: "verified", id: "i", number: "TSK-1" })).toBe(
      "Invoice TSK-1 for Starter is ready in Billing. Umbrella moves to Starter once it’s paid.",
    );
    expect(status("AFTER_PAYMENT", { kind: "unread", id: "i" })).toBe("An invoice for Starter is ready in Billing. Umbrella moves to Starter once it’s paid.");
    expect(status("AFTER_PAYMENT", { kind: "none" })).toBe("Umbrella moves to Starter once it’s paid for. There’s no invoice for this change yet.");
    expect(status("NEXT_PERIOD", { kind: "verified", id: "i", number: "TSK-1" }, THROUGH)).toMatch(
      /^Starter starts Dec 2[56], .+\. Nothing is charged now — pay its invoice in Billing before then, or Umbrella becomes read-only on that date\.$/,
    );
    expect(status("NEXT_PERIOD", { kind: "none" })).toBe("Starter starts when the current paid period ends. Nothing is charged now — there’s no invoice for it yet.");
    expect(status("LATER", { kind: "none" })).toBe("Umbrella’s plan change was accepted.");
  });

  it("the invoice page's line: only when it moves the company somewhere it is not", () => {
    // True for a NEXT_PERIOD invoice too (art-director blocker 3).
    expect(planChangeInvoiceText("Umbrella", STARTER, TEAM)).toBe("Paying this invoice moves Umbrella to Starter. Until Starter starts, it stays on Team.");
    expect(planChangeInvoiceText("Umbrella", TEAM, TEAM)).toBeNull();
    expect(planChangeInvoiceText("Umbrella", null, TEAM)).toBeNull();
  });
});

describe("renewal and automatic payments (B7, decision 1)", () => {
  it("the cancel question names the turn-off only while automatic payments are on", () => {
    expect(cancelRenewalQuestion("Umbrella", TEAM, THROUGH, true)).toMatch(/turn off automatic payments in Billing\.$/);
    expect(cancelRenewalQuestion("Umbrella", TEAM, THROUGH, false)).toMatch(/It doesn’t move to the free plan on its own\.$/);
  });

  it("the group's line by state, «Turn off» for On and Suspended only — and the question without a date when none was sent", () => {
    expect(autopayLineText("CONSENTED", null)).toBe("Taska takes this company’s payments automatically. You can still pay any invoice here yourself.");
    // TAS-516 (T7): off until the owner sets them up — a new consent, which this build cannot take (A67).
    expect(autopayLineText("DISABLED", "Umbrella")).toBe(
      "You pay Umbrella’s invoices here yourself. Automatic payments stay off until you set them up, which this version of Taska can’t do yet.",
    );
    expect(autopayLineText("PAUSED_BY_BANK", "Umbrella")).toBeNull();
    expect(["CONSENTED", "SUSPENDED", "DISABLED", "PAUSED_BY_BANK", null].map(canTurnOff)).toEqual([true, true, false, false, false]);
    expect(turnOffQuestion("Umbrella", THROUGH)).toMatch(/ If Umbrella isn’t paid for by Dec 2[56], .+, it becomes read-only\. /);
    expect(turnOffQuestion("Umbrella", null)).toBe(
      "Automatic payments stop for Umbrella, and you pay its invoices here yourself. This version of Taska can’t turn them back on.",
    );
  });
});

describe("the refusals (B11, decision 7)", () => {
  const words = (command: Parameters<typeof subscriptionRefusalWords>[0], error: unknown) => subscriptionRefusalWords(command, error, "Umbrella", STARTER).text;

  it("change plan", () => {
    expect(words("changePlan", problem(409, "FREE_ELIGIBILITY_USED"))).toBe("You’ve used your one free company, so Umbrella can’t move to Starter.");
    expect(words("changePlan", problem(400, "VALIDATION_FAILED"))).toBe("Taska didn’t accept this plan. Choose it again.");
    expect(words("changePlan", problem(404, "RESOURCE_NOT_FOUND"))).toBe("Starter can no longer be chosen. Choose another plan.");
    expect(words("changePlan", problem(409, "INVALID_STATE"))).toBe("Umbrella’s plan wasn’t changed.");
    expect(words("changePlan", problem(503, "POLICY_NOT_CONFIGURED"))).toBe("Changing plans isn’t available for Umbrella yet.");
    expect(words("changePlan", problem(503, "DEPENDENCY_UNAVAILABLE"))).toBe(
      "Taska couldn’t confirm the plan change. Press Change plan again — it won’t be applied twice.",
    );
    expect(words("changePlan", problem(403, "CAPABILITY_DISABLED"))).toBe("Changing plans isn’t available right now.");
    expect(words("changePlan", problem(403, "READ_ONLY", ["PAYMENT_DISPUTE"]))).toBe("A payment for Umbrella is disputed, so its plan can’t be changed right now.");
  });

  it("renewal and automatic payments", () => {
    expect(words("cancelRenewal", problem(412, "VERSION_CONFLICT"))).toBe(
      "Umbrella’s plan details changed while you were deciding, so renewal wasn’t cancelled. Check it and try again.",
    );
    expect(words("resumeRenewal", new TypeError("Failed to fetch"))).toBe("Taska couldn’t confirm that renewal was resumed. Press Resume renewal again to check.");
    expect(words("resumeRenewal", problem(503, "POLICY_NOT_CONFIGURED"))).toBe("Changing renewal isn’t available for Umbrella yet.");
    expect(words("autopayOff", problem(403, "READ_ONLY", ["OWNER_PAUSE"]))).toBe("Umbrella is paused, so automatic payments can’t be changed right now.");
    expect(words("autopayOff", problem(503, "POLICY_NOT_CONFIGURED"))).toBe("Automatic payments can’t be changed for Umbrella yet.");
    expect(words("autopayOff", problem(428, "VERSION_CONFLICT"))).toBe("Automatic payments weren’t turned off.");
    expect(subscriptionRefusalWords("autopayOff", problem(409, "SOMETHING_NEW"), "Umbrella").words).toBe("the server's words");
  });
});
