import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../../domain/types";
import {
  actorIdProblem,
  auditEntryKeys,
  auditFiltersProblem,
  auditQueryFor,
  formatAuditDocument,
  formatAuditTime,
  isAuditDay,
  readAuditViewState,
  writeAuditViewState,
} from "./audit";

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "5e7a0700-2c4b-4d1e-9f3a-6b8c0d2e4f1a",
  actorUserId: "e65186a2-b807-42ae-a66f-711be116a93b",
  actorDisplayName: "Mark Lee",
  actorEmail: "mark@example.com",
  action: "BLOCK_USER",
  targetService: "auth",
  targetTable: "users",
  targetId: "c47a9b21-6d5e-4f0b-8c72-9e13a4f8d602",
  reason: "Left",
  requestId: null,
  createdAt: "2026-10-09T16:40:00Z",
  oldValue: null,
  newValue: null,
  ...overrides,
});

describe("audit view state", () => {
  it("round-trips the page and every filter it would send", () => {
    const params = new URLSearchParams(
      "page=3&filter=action:equals:BLOCK_USER&filter=createdAt:from:2026-10-01&filter=createdAt:to:2026-10-09",
    );
    const view = readAuditViewState(params);
    expect(view.page).toBe(3);
    expect(view.filters).toHaveLength(3);
    expect(writeAuditViewState(view).toString()).toBe(params.toString().replaceAll(":", "%3A"));
  });

  it("reads as not set what it would not send: unknown, refused, repeated, blank", () => {
    const view = readAuditViewState(
      new URLSearchParams(
        "page=-1&filter=status:equals:x&filter=actorUserId:equals:mark&filter=action:equals:A&filter=action:equals:B&filter=targetId:equals:&filter=createdAt:from:2026-13-01",
      ),
    );
    expect(view).toEqual({ page: 1, filters: [{ column: "action", operator: "equals", value: "A" }] });
  });

  it("drops both bounds when From is after To", () => {
    const view = readAuditViewState(new URLSearchParams("filter=createdAt:from:2026-10-05&filter=createdAt:to:2026-10-01"));
    expect(view.filters).toEqual([]);
  });

  it("becomes a query with each filter under its own parameter", () => {
    expect(
      auditQueryFor(
        {
          page: 2,
          filters: [
            { column: "targetService", operator: "equals", value: "auth" },
            { column: "createdAt", operator: "from", value: "2026-10-01" },
            { column: "createdAt", operator: "to", value: "2026-10-02" },
          ],
        },
        20,
      ),
    ).toEqual({ page: 2, pageSize: 20, targetService: "auth", createdAtFrom: "2026-10-01", createdAtTo: "2026-10-02" });
  });
});

describe("audit checks", () => {
  it("wants a UUID for the actor", () => {
    expect(actorIdProblem("e65186a2-b807-42ae-a66f-711be116a93b")).toBeNull();
    expect(actorIdProblem("mark")).not.toBeNull();
  });

  it("takes only a real yyyy-MM-dd day", () => {
    expect(isAuditDay("2026-10-09")).toBe(true);
    expect(isAuditDay("2026-02-30")).toBe(false);
    expect(isAuditDay("2026-10-09T00:00:00Z")).toBe(false);
  });

  it("refuses a From after a To, and nothing else", () => {
    const from = { column: "createdAt", operator: "from" as const, value: "2026-10-02" };
    const to = { column: "createdAt", operator: "to" as const, value: "2026-10-01" };
    expect(auditFiltersProblem([from, to])).not.toBeNull();
    expect(auditFiltersProblem([from, { ...to, value: "2026-10-02" }])).toBeNull();
    expect(auditFiltersProblem([from])).toBeNull();
  });
});

describe("audit entry readings", () => {
  it("keys an entry by its id, wherever it stands on the page", () => {
    const a = entry({ id: "0000000a-0000-4000-8000-000000000000" });
    const b = entry({ id: "0000000b-0000-4000-8000-000000000000" });
    const [keyOfB] = auditEntryKeys([b, a]);
    // Two entries that say the same thing, told apart by id; and the key of
    // one does not move when another lands in front of it.
    expect(auditEntryKeys([a, b])).toEqual([auditEntryKeys([a])[0], keyOfB]);
    expect(new Set(auditEntryKeys([a, b])).size).toBe(2);
  });

  it("falls back to what an entry says when it has no id, and keeps even two identical ones apart", () => {
    const keys = auditEntryKeys([entry({ id: null }), entry({ id: null }), entry({ id: null, action: "UNBLOCK_USER" })]);
    expect(new Set(keys).size).toBe(3);
  });

  it("never lets a row without an id take the key of one with it, nor two rows share one", () => {
    // The server's primary key rules the second out; a key collision would
    // still draw one React row twice, so it is not left to the server.
    const keys = auditEntryKeys([entry(), entry({ id: null }), entry()]);
    expect(new Set(keys).size).toBe(3);
  });

  it("writes the time in UTC to the second, and an unreadable one as it came", () => {
    expect(formatAuditTime("2026-10-09T19:40:00.123+03:00")).toBe("2026-10-09T16:40:00Z");
    expect(formatAuditTime("yesterday")).toBe("yesterday");
  });

  it("lays out a JSON document and keeps text that is not one", () => {
    expect(formatAuditDocument('{"status":"ACTIVE","token":"***"}')).toEqual({
      text: '{\n  "status": "ACTIVE",\n  "token": "***"\n}',
      json: true,
    });
    expect(formatAuditDocument("not json")).toEqual({ text: "not json", json: false });
    expect(formatAuditDocument(null)).toBeNull();
  });
});
