import type { TaskaApi } from "../api/TaskaApi";
import { readAllPlans, type Money, type PlanVersion, type QuotaLimit } from "../api/tenants";
import { isEnglishName } from "./enumLabel";

/*
 * The plan choice of «Create a company» (TAS-501, DESIGN.md §4.36) as pure
 * functions: which plans are offered and in what order, and how a price and
 * its limits read. Money is formatted from the string of minor units — never
 * through a float — and a plan's `code` is never compared with anything: the
 * one question asked of a plan is whether its price is zero.
 */

/** The catalogue, on the account's query client: it is public and outlives every company session. */
export const PLANS_QUERY_KEY = ["billing-plans"] as const;

export const plansQueryOptions = (api: Pick<TaskaApi, "listBillingPlans">) => ({
  queryKey: PLANS_QUERY_KEY,
  queryFn: () => readAllPlans((params) => api.listBillingPlans(params)),
});

/** Whether a plan costs nothing — the free plan of DESIGN.md §4.36. Unreadable money is not free. */
export const isFreePlan = (plan: PlanVersion) => plan.price !== null && /^0+$/.test(plan.price.amountMinor);

/** The price in the plan's smallest common unit, for ordering: `amountMinor · 10^(18 − exponent)`. */
const priceKey = (money: Money | null): bigint | null =>
  money === null ? null : BigInt(money.amountMinor) * 10n ** BigInt(18 - Math.min(money.exponent, 18));

/** The plans offered: `PUBLISHED` only, by price (unreadable last), then by name (§4.36). */
export function offeredPlans(plans: readonly PlanVersion[]): PlanVersion[] {
  return plans
    .filter((plan) => plan.state === "PUBLISHED")
    .sort((a, b) => {
      const left = priceKey(a.price);
      const right = priceKey(b.price);
      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return left < right ? -1 : 1;
      }
      return planName(a).localeCompare(planName(b), "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/** The plan's name — or its `code` when the name has Cyrillic in it or is missing (§6); neither, «Plan». */
export function planName(plan: PlanVersion): string {
  if (plan.name !== null && isEnglishName(plan.name)) return plan.name;
  return plan.code ?? "Plan";
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * `Money` in English: `amountMinor / 10^exponent`, the symbol from
 * `Intl.NumberFormat('en', {style:'currency'})`, no «.00» on a whole amount —
 * «€20», «€19.50», «$1,200». The digits are the string's own; only the symbol
 * comes from `Intl`. A currency `Intl` refuses is printed after the number as
 * its code.
 */
export function formatMoney(money: Money): string {
  const { amountMinor, currency, exponent } = money;
  const digits = amountMinor.padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : "";
  const number = /^0*$/.test(fraction) ? group(whole) : `${group(whole)}.${fraction}`;
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    const first = parts.findIndex((part) => part.type === "integer");
    const last = parts.reduce(
      (end, part, index) => (part.type === "integer" || part.type === "decimal" || part.type === "fraction" ? index : end),
      first,
    );
    const before = parts.slice(0, first).map((part) => part.value).join("");
    const after = parts.slice(last + 1).map((part) => part.value).join("");
    return `${before}${number}${after}`;
  } catch {
    return `${number} ${currency}`;
  }
}

/**
 * The price on a plan's first line (§4.36): «€20 a month» for `CALENDAR_MONTH`,
 * «€20» for `NONE`; a period this build does not know is printed as its code
 * after the amount. Zero — `null`: nothing is drawn. Unreadable money — `null`.
 */
export function planPriceText(plan: PlanVersion): string | null {
  if (plan.price === null || isFreePlan(plan)) return null;
  const amount = formatMoney(plan.price);
  if (plan.period === "CALENDAR_MONTH") return `${amount} a month`;
  if (plan.period === "NONE" || plan.period === null) return amount;
  return `${amount} ${plan.period}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"] as const;

/** Decimal bytes, one decimal at most, «.0» dropped: 100 000 000 — «100 MB», 5 000 000 000 — «5 GB», 1 250 000 000 — «1.3 GB». */
export function formatBytes(value: string): string {
  let bytes = BigInt(value);
  let unit = 0;
  let scale = 1n;
  while (unit < BYTE_UNITS.length - 1 && bytes >= scale * 1000n) {
    scale *= 1000n;
    unit += 1;
  }
  // Tenths, rounded half up; a rounding that reaches 1000 moves to the next unit.
  let tenths = (bytes * 10n + scale / 2n) / scale;
  if (tenths >= 10000n && unit < BYTE_UNITS.length - 1) {
    unit += 1;
    scale *= 1000n;
    tenths = (bytes * 10n + scale / 2n) / scale;
  }
  bytes = tenths / 10n;
  const decimal = tenths % 10n;
  return `${group(bytes.toString())}${decimal === 0n ? "" : `.${decimal}`} ${BYTE_UNITS[unit]}`;
}

const count = (limit: string, one: string, many: string) => `${group(limit)} ${limit === "1" ? one : many}`;

/** One limit in words (§4.36); a kind this build does not know — `{limit} {KIND}` as it came (§6). */
export function limitText(limit: QuotaLimit): string {
  switch (limit.kind) {
    case "PROJECT":
      return limit.unlimited || limit.limit === null ? "unlimited projects" : count(limit.limit, "project", "projects");
    case "SEAT":
      return limit.unlimited || limit.limit === null ? "unlimited members" : count(limit.limit, "member", "members");
    case "STORAGE_BYTES":
      return limit.unlimited || limit.limit === null ? "unlimited storage" : `${formatBytes(limit.limit)} storage`;
    case "TASK_LIFETIME":
      return limit.unlimited || limit.limit === null
        ? "unlimited issues"
        : count(limit.limit, "issue per project", "issues per project");
    default:
      return limit.unlimited || limit.limit === null ? `unlimited ${limit.kind}` : `${group(limit.limit)} ${limit.kind}`;
  }
}

const LIMIT_ORDER: readonly string[] = ["PROJECT", "SEAT", "STORAGE_BYTES", "TASK_LIFETIME"];

/** The plan's second line: its limits through « · », PROJECT, SEAT, STORAGE_BYTES, TASK_LIFETIME, then the rest as they came. */
export function planLimitsText(plan: PlanVersion): string {
  const rank = (kind: string) => {
    const index = LIMIT_ORDER.indexOf(kind);
    return index === -1 ? LIMIT_ORDER.length : index;
  };
  return plan.limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => rank(a.limit.kind) - rank(b.limit.kind) || a.index - b.index)
    .map(({ limit }) => limitText(limit))
    .join(" · ");
}

/** The third line under a plan with a price (§4.36). No deadline: only a created company carries one (§4.37). */
export const PAID_PLAN_NOTE = "Nothing is charged now. The company opens once its first payment is confirmed.";

/** Where the limits stood, once the free plan is known to be used (§4.36). */
export const FREE_USED_NOTE = "You’ve used your one free company. Deleting it doesn’t bring it back.";
