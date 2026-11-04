import { describe, expect, it } from "vitest";
import {
  autoClosedText,
  awaitingPaymentText,
  formatDeadline,
  isTerminalOperation,
  pollDelay,
  setupStateLine,
  type DeadlineSentence,
} from "./companySetupText";

/* DESIGN.md §4.37's words (TAS-501): the deadline as the server sent it, the state line, the cadence. */

const read = ({ before, deadline, after }: DeadlineSentence) => `${before}${deadline ?? ""}${after}`;
const now = new Date("2026-11-04T10:00:00");

describe("the never-opened card's words", () => {
  it("names the state as the picker does", () => {
    expect(setupStateLine("PROVISIONING", false)).toBe("Being set up");
    expect(setupStateLine("PROVISIONING", true)).toBe("Setup failed");
    expect(setupStateLine("AWAITING_PAYMENT", false)).toBe("Awaiting first payment");
    expect(setupStateLine("OWNER_CANCELLED", false)).toBe("Cancelled");
    expect(setupStateLine("AUTO_CLOSED", false)).toBe("Closed");
  });

  it("dates the deadline in local time, with the year only when it is another one", () => {
    expect(formatDeadline("2026-12-04T14:32:00", now)).toBe("Dec 4, 14:32");
    expect(formatDeadline("2027-12-04T14:32:00", now)).toBe("Dec 4, 2027, 14:32");
    expect(formatDeadline("2026-12-04T00:05:00", now)).toBe("Dec 4, 00:05");
  });

  it("awaiting payment: by the deadline, without one, and once it has passed — the server not yet having closed it", () => {
    expect(read(awaitingPaymentText("2026-12-04T14:32:00", now))).toBe(
      "Its projects and invitations open once the first payment is confirmed. If it isn’t paid by Dec 4, 14:32, it closes automatically.",
    );
    expect(read(awaitingPaymentText(null, now))).toBe(
      "Its projects and invitations open once the first payment is confirmed. If it isn’t paid in time, it closes automatically.",
    );
    expect(read(awaitingPaymentText("2026-11-01T09:00:00", now))).toBe(
      "Its payment deadline, Nov 1, 09:00, has passed. If it was paid in time, it opens once Taska confirms the payment.",
    );
  });

  it("closed: never «can no longer be opened» — a late confirmation reopens it (D216)", () => {
    expect(read(autoClosedText("2026-06-05T09:00:00", now))).toBe(
      "Its first payment wasn’t confirmed by Jun 5, 09:00, so it closed without opening. If it was paid in time, it reopens once Taska confirms the payment.",
    );
    expect(read(autoClosedText(null, now))).toBe(
      "Its first payment wasn’t confirmed in time, so it closed without opening. If it was paid in time, it reopens once Taska confirms the payment.",
    );
    expect(read(autoClosedText(null, now))).not.toMatch(/can no longer/);
  });

  it("polls at 1, 2, 4 and 8 s, then every 10 s, and stops at an end — or at a state it does not know", () => {
    expect([0, 1, 2, 3, 4, 5, 40].map(pollDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000, 10000]);
    expect(isTerminalOperation("PENDING")).toBe(false);
    expect(isTerminalOperation("RUNNING")).toBe(false);
    expect(isTerminalOperation(null)).toBe(false);
    for (const state of ["SUCCEEDED", "FAILED", "MANUAL_REVIEW", "COMPENSATING"]) expect(isTerminalOperation(state)).toBe(true);
  });
});
