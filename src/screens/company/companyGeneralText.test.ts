import { describe, expect, it } from "vitest";
import { handOverOf, recipientLabel, transferCandidates } from "./companyGeneral";
import {
  isLostAnswer,
  leadText,
  pauseQuestion,
  renameRefusalWords,
  stateLines,
  stillWorksText,
  transferConsequences,
  transferRefusalWords,
  zoneRefusalWords,
  type TransferOutcome,
} from "./companyGeneralText";
import type { Membership } from "../../api/tenantMembers";

/*
 * Company › General's words (TAS-504, DESIGN.md §4.39), every table row, and
 * the pure rules beside them: who may be the new owner, and what a route entry
 * hands over across a re-entry.
 */

const refusal = (status: number | null, code: string | null, reasons: string[] = [], extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("server words"), { status, code, requestId: "rid-1", details: null, reasons, ...extra });
const lost = () => new TypeError("Failed to fetch");

describe("the page's words", () => {
  it("one lead for every role, the company by name or «this company»", () => {
    expect(leadText("Umbrella")).toBe("Only the owner of Umbrella can rename it, pause it or transfer it.");
    expect(leadText(null)).toBe("Only the owner of this company can rename it, pause it or transfer it.");
  });

  it("the state lines in the table's order, the owner's block line its own, unknown codes last as they came", () => {
    expect(stateLines(["OVER_QUOTA", "MYSTERY", "OWNER_PAUSE", "PLATFORM_BLOCK", "PAYMENT_EXPIRED", "PAYMENT_DISPUTE"], true)).toEqual([
      { code: "PLATFORM_BLOCK", fact: "Blocked by Taska.", explanation: "No one can change anything in it, and only Taska can lift the block." },
      { code: "OWNER_PAUSE", fact: "Paused by its owner.", explanation: "No one can change anything in it while it’s paused." },
      // TAS-512: the three financial ones explained by role (§4.39).
      // TAS-516 (T6): never a promise that access comes back once a dispute is settled, nor that renewing restores it.
      { code: "PAYMENT_DISPUTE", fact: "A payment is disputed.", explanation: "Nothing in it can be changed, and no automatic payments are taken." },
      {
        code: "PAYMENT_EXPIRED",
        fact: "Its paid period has ended.",
        explanation: "Nothing in it can be changed until it’s paid for again. There’s no grace period, and it doesn’t move to a free plan on its own.",
      },
      { code: "OVER_QUOTA", fact: "It’s over its plan’s limits.", explanation: "Nothing in it can be changed until it’s back within them." },
      { code: "MYSTERY", fact: "MYSTERY", explanation: null },
    ]);
    expect(stateLines(["PLATFORM_BLOCK"], false)[0].explanation).toBe("No one can change anything in it while it’s blocked.");
    // «Paused by its owner» to everybody — never «by you» (D244).
    expect(stateLines(["OWNER_PAUSE"], false)).toEqual(stateLines(["OWNER_PAUSE"], true));
    // A company awaiting its first payment never reaches this page (§4.37).
    expect(stateLines(["PENDING_FIRST_PAYMENT"], true)).toEqual([]);
    expect(stateLines([], true)).toEqual([]);
  });

  it("TAS-512: the financial explanations by role, and «what still works» only when every restriction is financial", () => {
    const others = Object.fromEntries(stateLines(["PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"], false).map((line) => [line.code, line.explanation]));
    expect(others).toEqual({
      PAYMENT_DISPUTE: "Nothing in it can be changed.",
      PAYMENT_EXPIRED: "Nothing in it can be changed until its owner pays for it again.",
      OVER_QUOTA: "Nothing in it can be changed until it’s back within them.",
    });
    expect(stillWorksText(["OVER_QUOTA"], true)).toBe(
      "Everything in it can still be read, and admins can still remove members and revoke invitations.",
    );
    expect(stillWorksText(["PAYMENT_EXPIRED", "PAYMENT_DISPUTE"], false)).toBe(
      "Everything in it can still be read, admins can still remove members and revoke invitations, and you can still leave it.",
    );
    for (const codes of [[], ["OWNER_PAUSE"], ["PAYMENT_EXPIRED", "OWNER_PAUSE"], ["OVER_QUOTA", "PLATFORM_BLOCK"], ["OVER_QUOTA", "MYSTERY"]]) {
      expect(stillWorksText(codes, true), codes.join()).toBeNull();
    }
  });

  it("the pause question names the end of the paid period only when the server sent one (D129, D130)", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(pauseQuestion("Umbrella", null, now)).toBe(
      "Umbrella will be paused: no one can change anything in it until you resume it, and its projects may not open at all. Pausing doesn’t extend the paid period, and no automatic payments are taken while it’s paused.",
    );
    const dated = pauseQuestion("Umbrella", "2026-12-20T09:00:00Z", now);
    expect(dated).toMatch(/^Umbrella will be paused: .* Pausing doesn’t extend the paid period — it still ends Dec 20, \d\d:\d\d — and no automatic payments are taken while it’s paused\.$/);
    expect(pauseQuestion(null, "2027-12-20T09:00:00Z", now)).toContain("it still ends Dec 20, 2027, ");
  });
});

describe("the rename table (§4.39 «Rename»)", () => {
  const words = (error: unknown) => renameRefusalWords(error, "Initech");
  it("by code, then the reasons — the block before the pause", () => {
    expect(words(refusal(400, "VALIDATION_FAILED"))).toEqual({ text: "Taska didn’t accept this name.", words: null });
    expect(words(refusal(403, "READ_ONLY", ["OWNER_PAUSE", "PLATFORM_BLOCK"])).text).toBe("Taska has blocked Initech, so it can’t be renamed.");
    expect(words(refusal(403, "READ_ONLY", ["OWNER_PAUSE"])).text).toBe("Initech is paused. Resume it to rename it.");
    // TAS-512: another known reason names itself (§4.35's clause); none known — «right now».
    expect(words(refusal(403, "READ_ONLY", ["PAYMENT_EXPIRED"])).text).toBe("Initech’s paid period has ended, so it can’t be renamed.");
    expect(words(refusal(403, "READ_ONLY", ["MYSTERY"])).text).toBe("Initech can’t be renamed right now.");
    expect(words(refusal(403, "CAPABILITY_DISABLED")).text).toBe("Initech can’t be renamed right now.");
    expect(words(refusal(403, "OWNER_REQUIRED")).text).toBe("Only the owner of Initech can rename it.");
    expect(words(refusal(412, "VERSION_CONFLICT"))).toEqual({
      text: "Initech changed while you were editing, so it was not renamed. Check it and save again.",
      words: null,
    });
    expect(words(refusal(429, "RATE_LIMITED", [], { retryAfterSeconds: 12 })).text).toBe("Too many attempts. Try again in 12 seconds.");
  });

  it("an answer that never came keeps the server's words; the rest is «was not renamed», words only for an unknown code", () => {
    expect(words(lost())).toEqual({ text: "Taska couldn’t confirm the new name. Save again — it won’t be applied twice.", words: "Failed to fetch" });
    expect(words(refusal(503, "DEPENDENCY_UNAVAILABLE")).words).toBe("server words");
    for (const error of [refusal(409, "INVALID_STATE"), refusal(428, "VERSION_CONFLICT"), refusal(409, "IDEMPOTENCY_CONFLICT")]) {
      expect(words(error)).toEqual({ text: "Initech was not renamed.", words: null });
    }
    expect(words(refusal(409, "SOMETHING_NEW"))).toEqual({ text: "Initech was not renamed.", words: "server words" });
  });
});

describe("the pause and resume table (§4.39)", () => {
  it("pause", () => {
    const words = (error: unknown) => zoneRefusalWords("pause", error, "Hooli");
    expect(words(refusal(403, "READ_ONLY", ["PLATFORM_BLOCK"])).text).toBe("Taska has blocked Hooli, so it was not paused.");
    expect(words(refusal(403, "READ_ONLY", ["PAYMENT_DISPUTE"])).text).toBe("A payment for Hooli is disputed, so it was not paused.");
    expect(words(refusal(403, "READ_ONLY")).text).toBe("Hooli can’t be paused right now.");
    expect(words(refusal(403, "CAPABILITY_DISABLED")).text).toBe("Pausing companies isn’t available right now.");
    expect(words(refusal(403, "OWNER_REQUIRED")).text).toBe("Only the owner of Hooli can pause it.");
    expect(words(refusal(412, "VERSION_CONFLICT")).text).toBe("Hooli changed while you were deciding, so it was not paused. Check it and try again.");
    expect(words(refusal(429, "RATE_LIMITED")).text).toBe("Too many attempts. Try again in a few minutes.");
    expect(words(refusal(408, "DEPENDENCY_UNAVAILABLE"))).toEqual({
      text: "Taska couldn’t confirm that Hooli was paused. Press Pause company again to check.",
      words: "server words",
    });
    expect(words(refusal(409, "INVALID_STATE"))).toEqual({ text: "Hooli was not paused.", words: null });
    expect(words(refusal(400, "NEW_CODE")).words).toBe("server words");
  });

  it("resume — never refused by a flag, so CAPABILITY_DISABLED has no row of its own", () => {
    const words = (error: unknown) => zoneRefusalWords("resume", error, null);
    expect(words(refusal(403, "READ_ONLY", ["PLATFORM_BLOCK", "OWNER_PAUSE"])).text).toBe(
      "Taska has blocked this company, so it can’t be resumed until Taska lifts the block.",
    );
    expect(words(refusal(403, "READ_ONLY", ["PAYMENT_DISPUTE"])).text).toBe("A payment for this company is disputed, so it can’t be resumed.");
    expect(words(refusal(403, "READ_ONLY")).text).toBe("This company can’t be resumed right now.");
    expect(words(refusal(403, "OWNER_REQUIRED")).text).toBe("Only the owner of this company can resume it.");
    expect(words(refusal(412, "VERSION_CONFLICT")).text).toBe("This company changed elsewhere, so it was not resumed. Check it and try again.");
    expect(words(lost()).text).toBe("Taska couldn’t confirm that this company was resumed. Press Resume company again to check.");
    expect(words(refusal(403, "CAPABILITY_DISABLED"))).toEqual({ text: "This company was not resumed.", words: null });
  });
});

describe("the transfer table (§4.39 «Transfer ownership»)", () => {
  const outcome = (error: unknown, extra: Partial<TransferOutcome> = {}): TransferOutcome => ({
    error,
    unconfirmed: false,
    stillMine: true,
    recipientState: "ACTIVE",
    ...extra,
  });
  const words = (value: TransferOutcome) => transferRefusalWords(value, "Priya Nair", "Umbrella");

  it("by code, the recipient's state from the re-read list for a 409", () => {
    expect(words(outcome(refusal(403, "READ_ONLY", ["PLATFORM_BLOCK"]))).text).toBe("Taska has blocked Umbrella, so it was not transferred.");
    expect(words(outcome(refusal(403, "READ_ONLY", ["PAYMENT_EXPIRED"]))).text).toBe("Umbrella’s paid period has ended, so it was not transferred.");
    expect(words(outcome(refusal(403, "READ_ONLY", ["OVER_QUOTA"]))).text).toBe("Umbrella is over its plan’s limits, so it was not transferred.");
    expect(words(outcome(refusal(403, "CAPABILITY_DISABLED"))).text).toBe("Transferring companies isn’t available right now.");
    expect(words(outcome(refusal(403, "OWNER_REQUIRED"))).text).toBe("Only the owner of Umbrella can transfer it.");
    expect(words(outcome(refusal(404, "RESOURCE_NOT_FOUND"))).text).toBe("Priya Nair is no longer in Umbrella, so it was not transferred.");
    expect(words(outcome(refusal(409, "INVALID_STATE"), { recipientState: "SUSPENDED" })).text).toBe(
      "Priya Nair is no longer an active member, so Umbrella was not transferred.",
    );
    // A FREE company is answered the same 409 for now (ask A32): nothing about the recipient.
    expect(words(outcome(refusal(409, "INVALID_STATE")))).toEqual({ text: "Umbrella was not transferred.", words: null });
    expect(words(outcome(refusal(412, "VERSION_CONFLICT"))).text).toBe(
      "Umbrella changed while you were deciding, so it was not transferred. Check it and try again.",
    );
    expect(words(outcome(refusal(429, "RATE_LIMITED"))).text).toBe("Too many attempts. Try again in a few minutes.");
    for (const code of ["CONFIRMATION_REQUIRED", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"]) {
      expect(words(outcome(refusal(code === "VERSION_CONFLICT" ? 428 : 422, code)))).toEqual({ text: "Umbrella was not transferred.", words: null });
    }
    expect(words(outcome(refusal(400, "BRAND_NEW")))).toEqual({ text: "Umbrella was not transferred.", words: "server words" });
  });

  it("unconfirmed (lost twice, or lost and then OWNER_REQUIRED): still the reader's, or a re-read that failed too", () => {
    expect(words(outcome(lost(), { unconfirmed: true, stillMine: true }))).toEqual({
      text: "Taska couldn’t confirm the transfer, and Umbrella is still yours. Try again.",
      words: "Failed to fetch",
    });
    expect(words(outcome(lost(), { unconfirmed: true, stillMine: null })).text).toBe(
      "Taska couldn’t confirm the transfer. Reload this page to see who owns Umbrella.",
    );
    // The retry's OWNER_REQUIRED is not «Only the owner…» after a lost answer.
    expect(words(outcome(refusal(403, "OWNER_REQUIRED"), { unconfirmed: true, stillMine: null })).text).toBe(
      "Taska couldn’t confirm the transfer. Reload this page to see who owns Umbrella.",
    );
  });

  it("the consequences — only the true ones, autopay never promised; «The new owner» before a choice", () => {
    expect(transferConsequences({ name: "Anna Ivanova", role: "MEMBER" }, "Initech").lines).toEqual([
      "Anna Ivanova becomes the owner of Initech and an admin in every project.",
      "You stay an admin, but lose access to the subscription, payments and invoices.",
      "Automatic payments you set up are turned off. Anna Ivanova sets up their own.",
      "Anna Ivanova isn’t asked to accept. Only they can transfer Initech back.",
    ]);
    expect(transferConsequences({ name: "Priya Nair", role: "TENANT_ADMIN" }, "Umbrella").lines[0]).toBe("Priya Nair becomes the owner of Umbrella.");
    const none = transferConsequences(null, "Umbrella");
    expect(none.lines).toEqual([
      "The new owner becomes the owner of Umbrella.",
      "You stay an admin, but lose access to the subscription, payments and invoices.",
      "Automatic payments you set up are turned off. The new owner sets up their own.",
      "The new owner isn’t asked to accept. Only they can transfer Umbrella back.",
    ]);
    expect(none.rule).toBe("Only a paid company with a current paid period can be transferred.");
  });

  it("a lost answer is no status, 408 or 5xx — never a 429", () => {
    expect(isLostAnswer(lost())).toBe(true);
    expect(isLostAnswer(refusal(408, "X"))).toBe(true);
    expect(isLostAnswer(refusal(502, "X"))).toBe(true);
    expect(isLostAnswer(refusal(429, "RATE_LIMITED"))).toBe(false);
    expect(isLostAnswer(refusal(403, "OWNER_REQUIRED"))).toBe(false);
  });
});

describe("who may be the new owner, and the hand-over", () => {
  const member = (userId: string, name: string | null, overrides: Partial<Membership> = {}): Membership => ({
    id: `m-${userId}`,
    tenantId: "t",
    userId,
    role: "MEMBER",
    state: "ACTIVE",
    isOwner: false,
    displayName: name,
    email: `${userId}@example.com`,
    avatarPath: null,
    version: "1",
    ...overrides,
  });

  it("ACTIVE members with a known role, never the reader, by name", () => {
    const rows = [
      member("tom", "Tom Becker", { role: "TENANT_ADMIN", isOwner: true }),
      member("priya", "Priya Nair", { role: "TENANT_ADMIN" }),
      member("anna", "Anna Ivanova", { state: "SUSPENDED" }),
      member("zed", "zed", { role: "AUDITOR" }),
      member("bea", null),
      member("cal", "Cal", { state: "REMOVED" }),
    ];
    expect(transferCandidates(rows, "tom").map((item) => item.userId)).toEqual(["bea", "priya"]);
    expect(recipientLabel(transferCandidates(rows, "tom")[1])).toBe("Priya Nair · priya@example.com");
    // No name: the address alone, not twice.
    expect(recipientLabel(transferCandidates(rows, "tom")[0])).toBe("bea@example.com");
    expect(transferCandidates(undefined, "tom")).toEqual([]);
  });

  it("reads back only the hand-over this page wrote", () => {
    const value = { fromSession: "ts-1", recipient: { userId: "priya", name: "Priya Nair", email: null, role: "TENANT_ADMIN" }, status: "s" };
    expect(handOverOf({ companyHandOver: value })).toEqual(value);
    expect(handOverOf({ companyHandOver: { ...value, recipient: null, status: null } })).toMatchObject({ recipient: null, status: null });
    expect(handOverOf(null)).toBeNull();
    expect(handOverOf({ focusHeading: true })).toBeNull();
    expect(handOverOf({ companyHandOver: { ...value, status: 4 } })).toBeNull();
    expect(handOverOf({ companyHandOver: { ...value, recipient: { userId: 1 } } })).toBeNull();
  });
});
