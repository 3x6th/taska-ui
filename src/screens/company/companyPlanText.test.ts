import { describe, expect, it } from "vitest";
import type { QuotaSnapshot } from "../../api/tenantMembers";
import type { Entitlement, PlanVersion } from "../../api/tenants";
import { announcedTail, autopayWord, planById, planLeadText, renewalNote, usageLines } from "./companyPlanText";

/*
 * Company › Plan's words (TAS-512, DESIGN.md §4.40; art-director B3, B4,
 * B10): the lead by role, the one usage template below, at and over a limit,
 * the owner's rows, and nothing computed — no «left», no percentage.
 */

const snapshot = (quotas: QuotaSnapshot["quotas"]): QuotaSnapshot => ({ tenantId: "t", version: "1", quotas, asOf: "2026-11-05T10:00:00Z" });
const entitlement = (limits: Entitlement["limits"]): Entitlement => ({ tenantId: "t", version: "1", planVersionId: "p", limits });
const plan = (overrides: Partial<PlanVersion> = {}): PlanVersion => ({
  id: "team-2",
  code: "mock-team",
  name: "Team",
  version: "2",
  price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  period: "CALENDAR_MONTH",
  limits: [],
  state: "PUBLISHED",
  ...overrides,
});

describe("the lead and the owner's rows", () => {
  it("the lead says where the money is to anybody but the owner", () => {
    expect(planLeadText("Umbrella", true)).toBe("The plan Umbrella is on and what it uses.");
    expect(planLeadText(null, false)).toBe("The plan this company is on and what it uses. Its price and payments are shown only to its owner.");
  });

  it("renewal, automatic payments (an unknown state as it came), the announced change", () => {
    expect(renewalNote("Consolidated")).toBe("When the paid period ends, Consolidated becomes read-only. It doesn’t move to a free plan on its own.");
    expect(["CONSENTED", "DISABLED", "SUSPENDED", "PAUSED_BY_BANK"].map(autopayWord)).toEqual(["On", "Off", "Suspended", "PAUSED_BY_BANK"]);
    expect(announcedTail(plan(), "€20 a month")).toBe(": Team · version 2, €20 a month");
    expect(announcedTail(plan({ version: null }), null)).toBe(": Team");
    expect(announcedTail(null, null)).toBe(", the plan changes.");
    expect(planById([plan()], "team-2")?.name).toBe("Team");
    expect(planById([plan()], "elsewhere")).toBeNull();
    expect(planById([plan()], null)).toBeNull();
  });
});

describe("Usage — one template whatever the numbers (B3)", () => {
  it("below, at and over a limit read alike; seats are used + reserved; the order PROJECT, SEAT, STORAGE, issues", () => {
    const rows = (projects: string) =>
      usageLines(
        snapshot([
          { kind: "SEAT", used: "4", reserved: "1", limit: "5", unlimited: false },
          { kind: "STORAGE_BYTES", used: "1250000000", reserved: "0", limit: "5000000000", unlimited: false },
          { kind: "PROJECT", used: projects, reserved: "0", limit: "1", unlimited: false },
        ]),
        entitlement([{ kind: "TASK_LIFETIME", limit: "50", unlimited: false }]),
      );
    for (const used of ["0", "1", "3"]) {
      expect(rows(used).map((line) => [line.label, line.value, line.note])).toEqual([
        ["Projects", `${used} used · 1 allowed`, "Archived projects count too."],
        ["Seats", "5 in use · 5 allowed", "Suspended members and pending invitations hold seats too."],
        ["Storage", "1.3 GB used · 5 GB allowed", null],
        ["Issues per project", "50 allowed", "Deleted issues still count."],
      ]);
    }
    const all = rows("3").map((line) => line.value).join(" ");
    expect(all).not.toMatch(/full|over|left|%/);
  });

  it("unlimited is «no limit»; bytes being uploaded are a tail; an unknown kind keeps the template", () => {
    const lines = usageLines(
      snapshot([
        { kind: "PROJECT", used: "1234", reserved: "0", limit: null, unlimited: true },
        { kind: "SEAT", used: "1", reserved: "0", limit: null, unlimited: true },
        { kind: "STORAGE_BYTES", used: "100000000", reserved: "2000000", limit: null, unlimited: true },
        { kind: "API_CALLS", used: "7", reserved: "0", limit: "1000", unlimited: false },
      ]),
      entitlement([{ kind: "TASK_LIFETIME", limit: null, unlimited: true }]),
    );
    expect(lines.map((line) => [line.label, line.value, line.note])).toEqual([
      ["Projects", "1,234 used · no limit", "Archived projects count too."],
      ["Seats", "1 in use · no limit", "Suspended members and pending invitations hold seats too."],
      ["Storage", "100 MB used · no limit · 2 MB being uploaded", null],
      ["Issues per project", "No limit", null],
      ["API_CALLS", "7 used · 1,000 allowed", null],
    ]);
  });

  it("either source alone: the snapshot's rows without the entitlement, «Issues per project» without the snapshot", () => {
    expect(usageLines(null, entitlement([{ kind: "TASK_LIFETIME", limit: "50", unlimited: false }])).map((line) => line.label)).toEqual([
      "Issues per project",
    ]);
    expect(usageLines(snapshot([{ kind: "SEAT", used: "3", reserved: "1", limit: "25", unlimited: false }]), null).map((line) => line.value)).toEqual([
      "4 in use · 25 allowed",
    ]);
    // The entitlement's other limits are never drawn: the snapshot is their source (B2).
    expect(usageLines(null, entitlement([{ kind: "SEAT", limit: "5", unlimited: false }]))).toEqual([]);
  });
});
