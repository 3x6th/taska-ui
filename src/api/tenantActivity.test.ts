import { describe, expect, it } from "vitest";
import { apiErrorFacts } from "./errors";
import {
  ACTIVITY_KINDS,
  activityKindsParam,
  activitySearch,
  ofCompanyActivity,
  toActivityRecord,
  toCompanyActivityPage,
} from "./tenantActivity";
import { ForeignCompanyAnswerError } from "./tenants";

/*
 * The company's log as the client reads it (TAS-524, api-contract-guard B2):
 * open unions, every field optional, no record ever dropped, an unreadable
 * time kept as none rather than «now», the platform mark only on `true`,
 * details only for the four kinds that carry them — and the page's two
 * guards, a foreign record and the wire's `kind` list.
 */

const NW = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";
const GX = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b02";

const RECORD = {
  id: "r-1",
  tenantId: NW,
  createdAt: "2026-11-05T10:15:30Z",
  actor: { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false },
  kind: "ROLE_CHANGED",
  target: { type: "MEMBER", id: "u-tom", displayName: "Tom Becker", email: "tom@example.com" },
  details: { fromRole: "MEMBER", toRole: "TENANT_ADMIN" },
  outcome: "SUCCEEDED",
  requestId: "rid-1",
};

describe("toActivityRecord (B2)", () => {
  it("reads the proposal's whole record", () => {
    expect(toActivityRecord(RECORD)).toEqual({
      id: "r-1",
      tenantId: NW,
      createdAt: "2026-11-05T10:15:30Z",
      actor: { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false },
      kind: "ROLE_CHANGED",
      target: { type: "MEMBER", id: "u-tom", displayName: "Tom Becker", email: "tom@example.com" },
      details: { kind: "ROLE_CHANGED", fromRole: "MEMBER", toRole: "TENANT_ADMIN" },
      outcome: "SUCCEEDED",
      requestId: "rid-1",
    });
  });

  it("keeps a kind, a target type and an outcome this build does not know, as they came", () => {
    const record = toActivityRecord({ ...RECORD, kind: "TENANT_EXPORTED", target: { type: "PROJECT", id: "p" }, outcome: "DENIED" });
    expect(record.kind).toBe("TENANT_EXPORTED");
    expect(record.target?.type).toBe("PROJECT");
    expect(record.outcome).toBe("DENIED");
    // Details are kept for the four kinds only, and an unknown kind is none of them.
    expect(record.details).toBeNull();
  });

  it("a missing kind, target, outcome and actor are null — never a guess", () => {
    const record = toActivityRecord({ id: "r", createdAt: "2026-11-05T10:15:30Z" });
    expect(record).toMatchObject({ kind: null, target: null, outcome: null, actor: null, details: null, requestId: null, tenantId: null });
  });

  it("an unparseable or missing time is null: drawn «Time unknown», never now", () => {
    expect(toActivityRecord({ ...RECORD, createdAt: "yesterday" }).createdAt).toBeNull();
    expect(toActivityRecord({ ...RECORD, createdAt: "" }).createdAt).toBeNull();
    expect(toActivityRecord({ ...RECORD, createdAt: 1730800000 }).createdAt).toBeNull();
    const { createdAt: _gone, ...rest } = RECORD;
    expect(toActivityRecord(rest).createdAt).toBeNull();
  });

  it("platformAdmin only for a literal true", () => {
    for (const value of ["true", 1, null, undefined, {}]) {
      expect(toActivityRecord({ ...RECORD, actor: { ...RECORD.actor, platformAdmin: value } }).actor?.platformAdmin).toBe(false);
    }
    expect(toActivityRecord({ ...RECORD, actor: { userId: "u-mark", platformAdmin: true } }).actor).toEqual({
      userId: "u-mark",
      displayName: null,
      email: null,
      platformAdmin: true,
    });
  });

  it("names by tenantMembers' text rule: a blank name or an empty address is none", () => {
    const record = toActivityRecord({
      ...RECORD,
      actor: { userId: "u", displayName: "   ", email: "", platformAdmin: false },
      target: { type: "MEMBER", id: "t", displayName: " ", email: 4 },
    });
    expect(record.actor).toMatchObject({ displayName: null, email: null });
    expect(record.target).toMatchObject({ displayName: null, email: null });
  });

  it("details for the four kinds, and only their named fields", () => {
    expect(toActivityRecord({ ...RECORD, kind: "TENANT_RENAMED", details: { fromName: "Old", toName: "New", reason: "secret" } }).details).toEqual({
      kind: "TENANT_RENAMED",
      fromName: "Old",
      toName: "New",
    });
    expect(toActivityRecord({ ...RECORD, kind: "INVITATION_CREATED", details: { role: "TENANT_ADMIN", projectGrants: [] } }).details).toEqual({
      kind: "INVITATION_CREATED",
      role: "TENANT_ADMIN",
    });
    expect(
      toActivityRecord({
        ...RECORD,
        kind: "OWNERSHIP_TRANSFERRED",
        details: { previousOwner: { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com", token: "x" } },
      }).details,
    ).toEqual({ kind: "OWNERSHIP_TRANSFERRED", previousOwner: { userId: "u-anna", displayName: "Anna Ivanova", email: "anna@example.com" } });
    // A kind outside the four, or details that are not an object: none.
    expect(toActivityRecord({ ...RECORD, kind: "TENANT_BLOCKED", details: { reason: "fraud" } }).details).toBeNull();
    expect(toActivityRecord({ ...RECORD, details: "MEMBER→ADMIN" }).details).toBeNull();
    expect(toActivityRecord({ ...RECORD, details: ["MEMBER"] }).details).toBeNull();
  });

  it("an entry that is not an object is still a record — no record is dropped", () => {
    expect(toActivityRecord(null)).toMatchObject({ id: null, kind: null, actor: null, createdAt: null });
    expect(toActivityRecord("TENANT_CREATED")).toMatchObject({ id: null, kind: null });
  });
});

describe("toCompanyActivityPage (B2)", () => {
  it("every item kept, in the server's order, a missing id included", () => {
    const page = toCompanyActivityPage({ items: [RECORD, { ...RECORD, id: undefined }, null, { ...RECORD, id: "r-1" }], nextCursor: "next" });
    expect(page.items.map((item) => item.id)).toEqual(["r-1", null, null, "r-1"]);
    expect(page.nextCursor).toBe("next");
  });

  it("items not an array is no records; nextCursor a non-empty string or null", () => {
    expect(toCompanyActivityPage({ items: { 0: RECORD } })).toEqual({ items: [], nextCursor: null });
    expect(toCompanyActivityPage({ items: [], nextCursor: "" }).nextCursor).toBeNull();
    expect(toCompanyActivityPage({ items: [], nextCursor: 42 }).nextCursor).toBeNull();
    expect(toCompanyActivityPage(null)).toEqual({ items: [], nextCursor: null });
  });
});

describe("ofCompanyActivity (B3)", () => {
  it("a page whose records name this company, or none, is the company's", () => {
    const page = toCompanyActivityPage({ items: [RECORD, { ...RECORD, tenantId: undefined }] });
    expect(ofCompanyActivity(page, NW)).toBe(page);
  });

  it("one record naming another company fails the whole page — the client's rule, without a server's facts", () => {
    const page = toCompanyActivityPage({ items: [RECORD, { ...RECORD, id: "r-2", tenantId: GX }] });
    let failure: unknown = null;
    try {
      ofCompanyActivity(page, NW);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ForeignCompanyAnswerError);
    expect(apiErrorFacts(failure)).toEqual({ message: null, requestId: null, status: null, code: null, details: null });
  });
});

describe("the wire's parameters (B1)", () => {
  it("kind repeated, sorted and de-duplicated; empty ones dropped", () => {
    expect(activityKindsParam(["ROLE_CHANGED", "INVITATION_CREATED", "ROLE_CHANGED", ""])).toEqual(["INVITATION_CREATED", "ROLE_CHANGED"]);
    expect(activityKindsParam(undefined)).toEqual([]);
  });

  it("limit, actorUserId, kind…, cursor — in that order, the absent ones not sent", () => {
    expect(
      activitySearch({ cursor: "c1", kinds: ["ROLE_CHANGED", "INVITATION_CREATED", "ROLE_CHANGED"], actorUserId: "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6", limit: 50 }).toString(),
    ).toBe("limit=50&actorUserId=6d774efa-57d8-4ae0-a27e-2984d1dfbbf6&kind=INVITATION_CREATED&kind=ROLE_CHANGED&cursor=c1");
    expect(activitySearch({ limit: 50 }).toString()).toBe("limit=50");
    expect(activitySearch({}).toString()).toBe("");
  });

  it("sixteen kinds, in the table's order (§4.41)", () => {
    expect(ACTIVITY_KINDS).toHaveLength(16);
    expect(ACTIVITY_KINDS[0]).toBe("TENANT_CREATED");
    expect(ACTIVITY_KINDS[7]).toBe("INVITATION_CREATED");
    expect(ACTIVITY_KINDS[11]).toBe("ROLE_CHANGED");
  });
});
