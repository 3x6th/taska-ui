import { describe, expect, it } from "vitest";
import {
  companyMarker,
  companyWriteRefusalText,
  firstKnownRestriction,
  quotaRefusalText,
  reasonedRefusal,
  reasonsDifferFrom,
  restrictionPhrase,
  writeRefusalText,
} from "./companyRestrictions";

/*
 * TAS-512's words in the workspace (DESIGN.md §4.34, §4.35, §4.40;
 * art-director B6–B8, G3): the reason phrase of a refused write, from the
 * refusal's own reasons only; §4.40's quota sentences, keyed to the refused
 * action; the state marker.
 */

const refusal = (status: number, code: string, reasons: string[] = [], viaDetails = false) =>
  Object.assign(new Error("The tenant is read-only"), {
    status,
    code: viaDetails ? "FAILED_PRECONDITION" : code,
    requestId: `rid-${code}`,
    details: viaDetails ? { reason: code } : null,
    reasons,
  });

describe("§4.35's reason phrase", () => {
  it("one per known reason, the first in §4.39's order — the dispute's «until it’s settled»", () => {
    expect(restrictionPhrase("PLATFORM_BLOCK", "Hooli")).toBe("Taska has blocked Hooli, so nothing in it can be changed.");
    expect(restrictionPhrase("OWNER_PAUSE", "Initech")).toBe("Initech is paused, so nothing in it can be changed.");
    expect(restrictionPhrase("PAYMENT_DISPUTE", "Northwind")).toBe("A payment for Northwind is disputed, so nothing in it can be changed until it’s settled.");
    expect(restrictionPhrase("PAYMENT_EXPIRED", "Umbrella")).toBe("Umbrella’s paid period has ended, so nothing in it can be changed.");
    expect(restrictionPhrase("OVER_QUOTA", null)).toBe("This company is over its plan’s limits, so nothing in it can be changed.");
    expect(restrictionPhrase("PLATFORM_BLOCK", null)).toBe("Taska has blocked this company, so nothing in it can be changed.");
    expect(firstKnownRestriction(["OVER_QUOTA", "MYSTERY", "PAYMENT_EXPIRED"])).toBe("PAYMENT_EXPIRED");
    expect(firstKnownRestriction(["MYSTERY", "PENDING_FIRST_PAYMENT"])).toBeNull();
  });

  it("only from READ_ONLY or CAPABILITY_DISABLED with a known reason; otherwise the server's words stay (null)", () => {
    expect(writeRefusalText(refusal(403, "READ_ONLY", ["OVER_QUOTA"]), "Northwind")).toBe("Northwind is over its plan’s limits, so nothing in it can be changed.");
    expect(writeRefusalText(refusal(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"]), "Initech")).toBe("Initech is paused, so nothing in it can be changed.");
    expect(writeRefusalText(refusal(403, "READ_ONLY", []), "Northwind")).toBeNull();
    expect(writeRefusalText(refusal(403, "READ_ONLY", ["MYSTERY"]), "Northwind")).toBeNull();
    expect(writeRefusalText(refusal(403, "PERMISSION_DENIED", ["OVER_QUOTA"]), "Northwind")).toBeNull();
    expect(writeRefusalText(new Error("plain"), "Northwind")).toBeNull();
  });

  it("the «… right now» rows: the clause and the action's own consequence", () => {
    expect(reasonedRefusal(refusal(403, "READ_ONLY", ["PAYMENT_EXPIRED"]), "Northwind", "it can’t be renamed.")).toBe(
      "Northwind’s paid period has ended, so it can’t be renamed.",
    );
    expect(reasonedRefusal(refusal(403, "READ_ONLY", ["PAYMENT_DISPUTE"]), "Umbrella", "it was not transferred.")).toBe(
      "A payment for Umbrella is disputed, so it was not transferred.",
    );
    expect(reasonedRefusal(refusal(403, "READ_ONLY"), "Umbrella", "it was not transferred.")).toBeNull();
  });
});

describe("§4.40's quota sentences — the kind from the refused action, never the server's words", () => {
  it("New issue, New project, an attachment; the legacy envelope's details.reason counts too", () => {
    const quota = refusal(422, "QUOTA_EXCEEDED");
    expect(quotaRefusalText(quota, "issue", { company: "Northwind", projectKey: "WEB" })).toBe(
      "WEB has reached its plan’s limit on issues, so this issue was not created. Deleted issues still count, and existing issues can still be edited, moved and commented on.",
    );
    expect(quotaRefusalText(quota, "project", { company: "Northwind" })).toBe(
      "Northwind has reached its plan’s limit on projects, so this project was not created. Archived projects count too.",
    );
    expect(quotaRefusalText(quota, "attachment", { company: null, fileName: "plan.pdf" })).toBe(
      "plan.pdf was not attached. This company has reached its plan’s storage limit.",
    );
    expect(quotaRefusalText(refusal(422, "QUOTA_EXCEEDED", [], true), "issue", { company: "N", projectKey: "TAS" })).toMatch(/^TAS has reached/);
    expect(quotaRefusalText(refusal(403, "READ_ONLY", ["OVER_QUOTA"]), "issue", { company: "N", projectKey: "TAS" })).toBeNull();
  });

  it("a READ_ONLY with OVER_QUOTA on the same form says the reason phrase, not the quota sentence", () => {
    expect(companyWriteRefusalText(refusal(403, "READ_ONLY", ["OVER_QUOTA"]), "project", { company: "Consolidated" })).toBe(
      "Consolidated is over its plan’s limits, so nothing in it can be changed.",
    );
    expect(companyWriteRefusalText(refusal(400, "VALIDATION_FAILED"), "project", { company: "N" })).toBeNull();
  });
});

describe("§4.34's state marker", () => {
  it("blocked, paused, read-only — the first that applies; an unknown code gives none", () => {
    expect(companyMarker(["OWNER_PAUSE", "PLATFORM_BLOCK"])).toBe("blocked");
    expect(companyMarker(["PAYMENT_EXPIRED", "OWNER_PAUSE"])).toBe("paused");
    for (const code of ["PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"]) expect(companyMarker([code])).toBe("read-only");
    expect(companyMarker(["MYSTERY"])).toBeNull();
    expect(companyMarker(["PENDING_FIRST_PAYMENT"])).toBeNull();
    expect(companyMarker([])).toBeNull();
    expect(companyMarker(null)).toBeNull();
  });

  it("a READ_ONLY whose known reasons are not the cached row's asks for the list again (B4, G8)", () => {
    expect(reasonsDifferFrom(refusal(403, "READ_ONLY", ["OVER_QUOTA"]), [])).toBe(true);
    expect(reasonsDifferFrom(refusal(403, "READ_ONLY", ["OVER_QUOTA"]), ["OVER_QUOTA"])).toBe(false);
    expect(reasonsDifferFrom(refusal(403, "READ_ONLY", ["OVER_QUOTA", "MYSTERY"]), ["OVER_QUOTA"])).toBe(false);
    expect(reasonsDifferFrom(refusal(403, "READ_ONLY", []), undefined)).toBe(false);
  });
});
