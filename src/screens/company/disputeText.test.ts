import { describe, expect, it } from "vitest";
import type { Dispute } from "../../api/billing";
import {
  DISPUTED_PAYMENT,
  disputeConsequenceText,
  disputeDateSteps,
  disputeMarker,
  listedDisputes,
  newPaymentRowId,
  newPaymentText,
} from "./disputeText";
import { stepText } from "./wireText";

/*
 * TAS-516's dispute rows (art-director T1, B5–B8; api-contract-guard B4–B5, Q1,
 * Q5): what a row says comes from its own state and matching outcome only; no
 * row promises access back or a refund; «a new full payment» once, and only
 * while the company's restrictions say `PAYMENT_EXPIRED`.
 */

const NOW = new Date("2026-11-20T09:00:00Z");

const dispute = (overrides: Partial<Dispute> = {}): Dispute => ({
  id: "dp",
  tenantId: "t",
  state: "OPEN",
  finalOutcome: null,
  openedAt: "2026-11-03T09:00:00Z",
  resolvedAt: null,
  ...overrides,
});

const line2 = (value: Dispute) => disputeDateSteps(value, NOW).map(stepText).join(" · ");

describe("a dispute row (T1)", () => {
  it("line 1 never names an invoice or an amount (A91)", () => {
    expect(DISPUTED_PAYMENT).toBe("Disputed payment");
  });

  it("open and in review: the marker, the opening date, and what a reversal would do — never that access comes back", () => {
    const reversed = "If the payment is reversed, even in part, the whole period it paid for is withdrawn.";
    for (const [state, marker] of [
      ["OPEN", "open"],
      ["NEEDS_REVIEW", "in review"],
    ] as const) {
      const row = dispute({ state, resolvedAt: "2026-11-08T09:00:00Z" });
      expect(disputeMarker(row)).toBe(marker);
      // A dispute still open is never «Closed», whatever else came with it.
      expect(line2(row)).toBe("Opened Nov 3");
      expect(disputeConsequenceText(row)).toBe(reversed);
    }
  });

  it("won and withdrawn: what was left of the period still counts — not extended, no date", () => {
    const kept = "What’s left of the period it paid for still counts. It isn’t extended for the time the dispute took.";
    const won = dispute({ state: "WON", finalOutcome: "WON", resolvedAt: "2026-11-08T09:00:00Z" });
    const withdrawn = dispute({ state: "WITHDRAWN", finalOutcome: "WITHDRAWN_CONFIRMED", resolvedAt: "2026-11-08T09:00:00Z" });
    expect([disputeMarker(won), disputeMarker(withdrawn)]).toEqual(["upheld", "withdrawn"]);
    expect(line2(won)).toBe("Opened Nov 3 · Closed Nov 8");
    expect(disputeConsequenceText(won)).toBe(kept);
    expect(disputeConsequenceText(withdrawn)).toBe(kept);
  });

  it("lost, fully or in part: the whole period withdrawn, nothing more refunded — the bank's money, never Taska refunding", () => {
    const full = dispute({ state: "LOST", finalOutcome: "LOST_FULL_REFUND", resolvedAt: "2026-11-08T09:00:00Z" });
    const part = dispute({ state: "LOST", finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED", resolvedAt: "2026-11-08T09:00:00Z" });
    expect([disputeMarker(full), disputeMarker(part)]).toEqual(["reversed", "part reversed"]);
    for (const row of [full, part]) {
      expect(disputeConsequenceText(row)).toBe("The whole period it paid for was withdrawn — no part of it is kept. Nothing more is refunded for it.");
      expect(disputeConsequenceText(row)).not.toMatch(/Taska refund/i);
    }
  });

  it("«Nothing more is refunded» only on a lost one; no row is read-only, brings access back or promises a refund", () => {
    const rows = [
      dispute(),
      dispute({ state: "NEEDS_REVIEW" }),
      dispute({ state: "WON", finalOutcome: "WON" }),
      dispute({ state: "WITHDRAWN", finalOutcome: "WITHDRAWN_CONFIRMED" }),
    ];
    for (const row of rows) expect(disputeConsequenceText(row) ?? "", String(row.state)).not.toMatch(/refund/i);
    for (const row of [...rows, dispute({ state: "LOST", finalOutcome: "LOST_FULL_REFUND" })]) {
      expect(disputeConsequenceText(row) ?? "", String(row.state)).not.toMatch(/read-only|restored|back to|again|will be refunded/i);
    }
  });

  it("a mismatched pair: the state's word and its dates, no line 3", () => {
    // The mapper drops a mismatched outcome; the words hold without it too.
    for (const [state, outcome, marker] of [
      ["WON", null, "upheld"],
      ["WON", "LOST_FULL_REFUND", "upheld"],
      ["WITHDRAWN", "WON", "withdrawn"],
      ["LOST", null, "reversed"],
      ["LOST", "WON", "reversed"],
      ["LOST", "LOST_SOMETHING_NEW", "reversed"],
    ] as const) {
      const row = dispute({ state, finalOutcome: outcome, resolvedAt: "2026-11-08T09:00:00Z" });
      expect(disputeMarker(row), `${state} + ${outcome}`).toBe(marker);
      expect(line2(row)).toBe("Opened Nov 3 · Closed Nov 8");
      expect(disputeConsequenceText(row), `${state} + ${outcome}`).toBeNull();
    }
  });

  it("a state this build does not know: as it came, its dates, no line 3; none at all, no marker", () => {
    const row = dispute({ state: "ARBITRATION", resolvedAt: "2026-11-08T09:00:00Z" });
    expect(disputeMarker(row)).toBe("ARBITRATION");
    expect(line2(row)).toBe("Opened Nov 3 · Closed Nov 8");
    expect(disputeConsequenceText(row)).toBeNull();
    expect(disputeMarker(dispute({ state: null }))).toBeNull();
    expect(disputeConsequenceText(dispute({ state: null }))).toBeNull();
  });

  it("a missing date drops its segment; no dates, no line 2 — the year only when it differs", () => {
    expect(line2(dispute({ state: "WON", finalOutcome: "WON", openedAt: null, resolvedAt: "2026-11-08T09:00:00Z" }))).toBe("Closed Nov 8");
    expect(line2(dispute({ state: "WON", finalOutcome: "WON", resolvedAt: null }))).toBe("Opened Nov 3");
    expect(disputeDateSteps(dispute({ openedAt: null }), NOW)).toEqual([]);
    expect(line2(dispute({ openedAt: "2025-12-30T09:00:00Z" }))).toBe("Opened Dec 30, 2025");
    expect(disputeDateSteps(dispute(), NOW)[0]).toEqual({ word: "Opened", day: "Nov 3", iso: "2026-11-03T09:00:00Z" });
  });
});

describe("«a new full payment» (B8)", () => {
  const part = (id: string, openedAt: string) => dispute({ id, state: "LOST", finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED", openedAt });

  it("once per group, on the first lost-in-part row in list order — only while the company is PAYMENT_EXPIRED", () => {
    const listed = listedDisputes([part("older", "2026-10-01T09:00:00Z"), dispute({ id: "open" }), part("newer", "2026-11-05T09:00:00Z")]);
    expect(listed.map((item) => item.id)).toEqual(["newer", "open", "older"]);
    expect(newPaymentRowId(listed, ["PAYMENT_EXPIRED"])).toBe("newer");
    // Without PAYMENT_EXPIRED a revocation said nothing about what restores it (A92): no sentence.
    expect(newPaymentRowId(listed, [])).toBeNull();
    expect(newPaymentRowId(listed, ["PAYMENT_DISPUTE"])).toBeNull();
    // A full loss and a mismatched pair never earn it.
    expect(newPaymentRowId([dispute({ state: "LOST", finalOutcome: "LOST_FULL_REFUND" })], ["PAYMENT_EXPIRED"])).toBeNull();
    expect(newPaymentRowId([dispute({ state: "WON", finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED" })], ["PAYMENT_EXPIRED"])).toBeNull();
  });

  it("names the company, or «this company»", () => {
    expect(newPaymentText("Soylent Corp")).toBe("A new full payment is needed before anything in Soylent Corp can be changed again.");
    expect(newPaymentText(null)).toBe("A new full payment is needed before anything in this company can be changed again.");
  });
});

describe("the order (B5)", () => {
  it("newest opened first, by instant, then by id; without a date last", () => {
    const listed = listedDisputes([
      dispute({ id: "a", openedAt: "2026-11-10T09:00:00Z" }),
      dispute({ id: "b", openedAt: "2026-11-10T09:00:00.500Z" }),
      dispute({ id: "c", openedAt: "2026-11-10T09:30:00+01:00" }),
      dispute({ id: "d", openedAt: null }),
      dispute({ id: "e", openedAt: "2026-11-10T09:00:00Z" }),
    ]);
    expect(listed.map((item) => item.id)).toEqual(["b", "e", "a", "c", "d"]);
  });
});
