import { describe, expect, it } from "vitest";
import type { PlanVersion } from "../api/tenants";
import { formatBytes, formatMoney, isFreePlan, limitText, offeredPlans, planLimitsText, planName, planPriceText } from "./plans";

/* DESIGN.md §4.36's plan lines (TAS-501): money from strings, limits in words, the published plans in order. */

const plan = (overrides: Partial<PlanVersion> = {}): PlanVersion => ({
  id: "p",
  code: "team",
  name: "Team",
  version: "1",
  price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  period: "CALENDAR_MONTH",
  limits: [],
  state: "PUBLISHED",
  ...overrides,
});

describe("the price", () => {
  it("is the string's own digits with the currency's symbol, and no «.00» on a whole amount", () => {
    expect(formatMoney({ amountMinor: "2000", currency: "EUR", exponent: 2 })).toBe("€20");
    expect(formatMoney({ amountMinor: "1950", currency: "EUR", exponent: 2 })).toBe("€19.50");
    expect(formatMoney({ amountMinor: "120000", currency: "USD", exponent: 2 })).toBe("$1,200");
    expect(formatMoney({ amountMinor: "5", currency: "EUR", exponent: 2 })).toBe("€0.05");
    // Past a float's precision, still exact.
    expect(formatMoney({ amountMinor: "9007199254740993", currency: "EUR", exponent: 2 })).toBe("€90,071,992,547,409.93");
    // A code Intl does not take is printed after the number.
    expect(formatMoney({ amountMinor: "2000", currency: "€€", exponent: 2 })).toBe("20 €€");
  });

  it("reads «a month» for a calendar month, nothing for a one-off, and nothing at all for zero", () => {
    expect(planPriceText(plan())).toBe("€20 a month");
    expect(planPriceText(plan({ period: "NONE" }))).toBe("€20");
    expect(planPriceText(plan({ period: "CALENDAR_QUARTER" }))).toBe("€20 CALENDAR_QUARTER");
    expect(planPriceText(plan({ price: { amountMinor: "0", currency: "EUR", exponent: 2 } }))).toBeNull();
    expect(planPriceText(plan({ price: null }))).toBeNull();
  });

  it("is zero for the free plan only — unreadable money is not free", () => {
    expect(isFreePlan(plan({ price: { amountMinor: "0", currency: "EUR", exponent: 2 } }))).toBe(true);
    expect(isFreePlan(plan())).toBe(false);
    expect(isFreePlan(plan({ price: null }))).toBe(false);
  });
});

describe("the limits", () => {
  it("in words, in the order PROJECT, SEAT, STORAGE_BYTES, TASK_LIFETIME, then the rest as they came", () => {
    const free = plan({
      limits: [
        { kind: "TASK_LIFETIME", limit: "50", unlimited: false },
        { kind: "API_CALLS", limit: "1000", unlimited: false },
        { kind: "STORAGE_BYTES", limit: "100000000", unlimited: false },
        { kind: "SEAT", limit: "5", unlimited: false },
        { kind: "PROJECT", limit: "1", unlimited: false },
      ],
    });
    // «seats», not «members» (TAS-512, art-director B10): a seat is also held by a suspended member or an invitation.
    expect(planLimitsText(free)).toBe("1 project · 5 seats · 100 MB storage · 50 issues per project · 1,000 API_CALLS");
    expect(limitText({ kind: "SEAT", limit: "1", unlimited: false })).toBe("1 seat");
    expect(limitText({ kind: "TASK_LIFETIME", limit: "1", unlimited: false })).toBe("1 issue per project");
    for (const [kind, words] of [
      ["PROJECT", "unlimited projects"],
      ["SEAT", "unlimited seats"],
      ["STORAGE_BYTES", "unlimited storage"],
      ["TASK_LIFETIME", "unlimited issues"],
      ["API_CALLS", "unlimited API_CALLS"],
    ]) {
      expect(limitText({ kind, limit: null, unlimited: true })).toBe(words);
    }
  });

  it("bytes are decimal, with one decimal at most", () => {
    expect(formatBytes("100000000")).toBe("100 MB");
    expect(formatBytes("5000000000")).toBe("5 GB");
    expect(formatBytes("1250000000")).toBe("1.3 GB");
    expect(formatBytes("999960000")).toBe("1 GB");
    expect(formatBytes("512")).toBe("512 B");
  });
});

describe("the plans offered", () => {
  it("are the published ones, by price, then by name — a paid plan never first by accident", () => {
    const plans = [
      plan({ id: "team", name: "Team" }),
      plan({ id: "old", name: "Team", state: "RETIRED", price: { amountMinor: "1500", currency: "EUR", exponent: 2 } }),
      plan({ id: "draft", name: "Next", state: "DRAFT" }),
      plan({ id: "free", name: "Free", price: { amountMinor: "0", currency: "EUR", exponent: 2 } }),
      plan({ id: "agency", name: "Agency" }),
      plan({ id: "broken", name: "Broken", price: null }),
    ];
    expect(offeredPlans(plans).map((item) => item.id)).toEqual(["free", "agency", "team", "broken"]);
  });

  it("names a plan by its code when its name has Cyrillic in it (§6)", () => {
    expect(planName(plan({ name: "Команда" }))).toBe("team");
    expect(planName(plan({ name: null, code: null }))).toBe("Plan");
  });
});
