import { describe, expect, it, vi } from "vitest";
import { apiErrorFacts } from "./errors";
import {
  COMPANY_PAGE_CAP,
  UnendedListError,
  decimal,
  freeSeats,
  invitationEmailProblem,
  isSendableVersion,
  readAllPages,
  sameInvitationEmail,
  seatsOf,
  toInvitationPage,
  toMembership,
  toMembershipPage,
  toQuotaSnapshot,
} from "./tenantMembers";

/*
 * The blueprint's Membership, Invitation and QuotaSnapshot as this build reads
 * them (TAS-502, api-contract-guard §1, B4, B8): unknown values kept as
 * strings, versions and counts as decimal strings, seats in BigInt only.
 */

describe("Membership and Invitation", () => {
  it("keeps a role, a state and a grant role this build does not know, as they came", () => {
    const member = toMembership({
      id: "m1",
      tenantId: "t1",
      userId: "u1",
      role: "TENANT_AUDITOR",
      state: "ARCHIVED",
      isOwner: "yes",
      displayName: "  ",
      email: "a@example.com",
      avatarPath: "avatars/u1.png",
      version: "12",
    });
    expect(member).toEqual({
      id: "m1",
      tenantId: "t1",
      userId: "u1",
      role: "TENANT_AUDITOR",
      state: "ARCHIVED",
      // Only `true` is the owner; a blank name is no name (develop sends none until TAS-321).
      isOwner: false,
      displayName: null,
      email: "a@example.com",
      avatarPath: "avatars/u1.png",
      version: "12",
    });
    const page = toInvitationPage({
      items: [
        { id: "i1", email: "k@example.com", role: "MEMBER", state: "SNOOZED", expiresAt: "2026-11-12T10:00:00Z", createdBy: "u1", projectGrants: [{ projectId: "p1", role: "OWNER" }, { projectId: "" }], version: "3" },
        { email: "no-id@example.com" },
      ],
      nextCursor: "",
    });
    expect(page.items).toEqual([
      {
        id: "i1",
        tenantId: null,
        email: "k@example.com",
        role: "MEMBER",
        state: "SNOOZED",
        expiresAt: "2026-11-12T10:00:00Z",
        createdBy: "u1",
        projectGrants: [{ projectId: "p1", role: "OWNER" }],
        version: "3",
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("reads a version only as the blueprint's decimal string — anything else is none, and is never sent", () => {
    for (const version of [12, "012", "-1", "1.5", "12345678901234567890", ""]) {
      expect(toMembership({ userId: "u", version })?.version, String(version)).toBeNull();
    }
    expect(isSendableVersion("0")).toBe(true);
    expect(isSendableVersion("1234567890123456789")).toBe(true);
    expect(isSendableVersion(null)).toBe(false);
    expect(isSendableVersion("v1")).toBe(false);
    expect(toMembershipPage({ items: [{ userId: "" }, { userId: "u" }], nextCursor: "c" })).toMatchObject({ items: [{ userId: "u" }], nextCursor: "c" });
  });
});

describe("seats come from the SEAT row, in BigInt", () => {
  it("reads used, reserved and the limit as BigInt; unlimited has no limit; a malformed row is no row", () => {
    const snapshot = toQuotaSnapshot({
      tenantId: "t",
      version: "7",
      quotas: [
        { kind: "PROJECT", used: "1", reserved: "0", limit: "1", unlimited: false },
        { kind: "SEAT", used: "9223372036854775806", reserved: "1", limit: "9223372036854775807", unlimited: false },
      ],
      asOf: "2026-11-05T10:00:00Z",
    });
    expect(seatsOf(snapshot)).toEqual({ used: 9223372036854775806n, reserved: 1n, limit: 9223372036854775807n });
    expect(freeSeats({ used: 9223372036854775806n, reserved: 1n, limit: 9223372036854775807n })).toBe(0n);
    // An administrator of the platform may push `used` past the limit: free is 0, never negative.
    expect(freeSeats({ used: 7n, reserved: 1n, limit: 5n })).toBe(0n);
    expect(freeSeats({ used: 2n, reserved: 1n, limit: 5n })).toBe(2n);
    expect(seatsOf(toQuotaSnapshot({ quotas: [{ kind: "SEAT", used: "3", reserved: "0", unlimited: true }] }))).toEqual({
      used: 3n,
      reserved: 0n,
      limit: null,
    });
    expect(freeSeats({ used: 3n, reserved: 0n, limit: null })).toBeNull();
    expect(seatsOf(toQuotaSnapshot({ quotas: [{ kind: "SEAT", used: 3, reserved: "0", limit: "5" }] }))).toBeNull();
    expect(seatsOf(toQuotaSnapshot({ quotas: [{ kind: "SEAT", used: "3", reserved: "0" }] }))).toBeNull();
    expect(seatsOf(toQuotaSnapshot(null))).toBeNull();
    expect(decimal("12")).toBe(12n);
    expect(decimal("1e3")).toBeNull();
  });
});

describe("the address rule shared by the form and the mock", () => {
  it("trims, wants something on both sides of an @, at most 254", () => {
    expect(invitationEmailProblem("   ")).toBe("empty");
    expect(invitationEmailProblem(" kai@example.com ")).toBeNull();
    expect(invitationEmailProblem("kai")).toBe("invalid");
    expect(invitationEmailProblem("@example.com")).toBe("invalid");
    expect(invitationEmailProblem("kai@")).toBe("invalid");
    expect(invitationEmailProblem("k ai@example.com")).toBe("invalid");
    expect(invitationEmailProblem(`${"k".repeat(243)}@example.com`)).toBe("too-long");
    expect(sameInvitationEmail("Kai@Example.com", " kai@example.com")).toBe(true);
    expect(sameInvitationEmail(null, "kai@example.com")).toBe(false);
  });
});

describe("readAllPages", () => {
  const refusal = (code: string) => Object.assign(new Error(code), { status: 400, code, requestId: "rid", details: null, reasons: [] });

  it("follows the cursor at 100 a page to the end", async () => {
    const list = vi.fn(async (params: { cursor?: string }) =>
      params.cursor === undefined ? { items: [1, 2], nextCursor: "a" } : { items: [3], nextCursor: null },
    );
    await expect(readAllPages(list)).resolves.toEqual([1, 2, 3]);
    expect(list.mock.calls.map(([params]) => params)).toEqual([{ limit: 100 }, { cursor: "a", limit: 100 }]);
  });

  it("starts again from the first page once when a later page's cursor went stale; a second time is the error", async () => {
    let calls = 0;
    const flaky = vi.fn(async (params: { cursor?: string }): Promise<{ items: Array<number | string>; nextCursor: string | null }> => {
      calls += 1;
      if (params.cursor === undefined) return { items: [calls], nextCursor: "a" };
      if (calls === 2) throw refusal("VALIDATION_FAILED");
      return { items: ["end"], nextCursor: null };
    });
    await expect(readAllPages(flaky)).resolves.toEqual([3, "end"]);
    const stale = vi.fn(async (params: { cursor?: string }) => {
      if (params.cursor === undefined) return { items: [1], nextCursor: "a" };
      throw refusal("VALIDATION_FAILED");
    });
    await expect(readAllPages(stale)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(stale).toHaveBeenCalledTimes(4);
    // A list that does not end is the read's error, never a list cut short (guard N2).
    const endless = vi.fn(async (params: { cursor?: string }) => ({ items: [1], nextCursor: `c${(params.cursor ?? "c0").slice(1) + 1}` }));
    const unended = await readAllPages(endless).catch((error: unknown) => error);
    expect(unended).toBeInstanceOf(UnendedListError);
    expect(endless).toHaveBeenCalledTimes(COMPANY_PAGE_CAP);
    // Its message is empty: no client words go out as the server's.
    expect(apiErrorFacts(unended)).toMatchObject({ message: null, status: null, code: null });
    const repeating = vi.fn(async () => ({ items: [1], nextCursor: "same" }));
    await expect(readAllPages(repeating)).rejects.toBeInstanceOf(UnendedListError);
    expect(repeating).toHaveBeenCalledTimes(2);
    // The first page's own refusal is the read's error at once.
    const first = vi.fn(async () => {
      throw refusal("VALIDATION_FAILED");
    });
    await expect(readAllPages(first)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(first).toHaveBeenCalledTimes(1);
  });
});
