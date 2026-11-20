import { describe, expect, it } from "vitest";
import { toTenant, type Tenant } from "../api/tenants";
import {
  chooseCompanyRoute,
  closedCompanyReason,
  closedCompanyWords,
  companyRoute,
  documentTitleFor,
  inCompanyRest,
  isOutsideCompanies,
  orderTenants,
  restrictedSearchText,
  splitCompanyRoute,
  switcherStateLabel,
  tenantGroup,
  tenantStateLine,
} from "./companies";

const tenant = (id: string, name: string, lifecycle = "ACTIVE", restrictions: string[] = []): Tenant =>
  toTenant({ id, name, ownerId: "o", lifecycle, restrictions, createdAt: "2026-05-01T09:00:00Z", version: "1" })!;

const none: ReadonlySet<string> = new Set();

describe("the company in the address (DESIGN.md §5.1)", () => {
  it("builds and splits /c/{companyId}{rest}", () => {
    expect(companyRoute("n1")).toBe("/c/n1/projects");
    expect(companyRoute("n1", "/browse/WEB-12?x=1")).toBe("/c/n1/browse/WEB-12?x=1");
    expect(companyRoute("n 1", "settings")).toBe("/c/n%201/settings");
    expect(companyRoute("n1", "/")).toBe("/c/n1");
    expect(splitCompanyRoute("/c/n1/projects/p/board?q=a")).toEqual({ companyId: "n1", rest: "/projects/p/board?q=a" });
    expect(splitCompanyRoute("/c/n1")).toEqual({ companyId: "n1", rest: "/" });
    expect(splitCompanyRoute("/c/n%201/x")).toEqual({ companyId: "n 1", rest: "/x" });
    expect(splitCompanyRoute("/projects")).toBeNull();
    expect(splitCompanyRoute("/c/")).toBeNull();
    expect(splitCompanyRoute("/c/%E0%A4%A/x")).toBeNull();
  });

  it("knows the routes outside every company, and what an address without one would open", () => {
    for (const path of ["/login", "/invite?token=x", "/auth/callback", "/companies"]) expect(isOutsideCompanies(path)).toBe(true);
    // TAS-527: the two pages of a password reset.
    for (const path of ["/forgot-password", "/reset-password", "/reset-password?token=x"]) expect(isOutsideCompanies(path)).toBe(true);
    expect(inCompanyRest("/reset-password")).toBeNull();
    for (const path of ["/projects", "/c/x/login", "/loginx"]) expect(isOutsideCompanies(path)).toBe(false);
    expect(inCompanyRest("/")).toBe("/projects");
    expect(inCompanyRest("/projects/p/issues/i")).toBe("/projects/p/issues/i");
    expect(inCompanyRest("/browse/WEB-12")).toBe("/browse/WEB-12");
    expect(inCompanyRest("/settings/tokens?x")).toBe("/settings/tokens?x");
    // Not in-company pages: they answer for themselves.
    for (const path of ["/admin", "/admin/users", "/browse", "/projectsx", "/nope"]) expect(inCompanyRest(path)).toBeNull();
  });
});

describe("the reader's list (§4.33)", () => {
  it("groups by what the server says of the company, and orders by group, name and id — never by use", () => {
    const list = [
      tenant("z", "beta"),
      tenant("y", "Alpha", "AUTO_CLOSED"),
      tenant("x", "alpha", "ACTIVE", ["OWNER_PAUSE"]),
      tenant("w", "Gamma", "PROVISIONING"),
      tenant("v", "Delta", "HIBERNATING"),
      tenant("u", "Alpha"),
    ];
    expect(orderTenants(list, none).map((item) => item.id)).toEqual(["u", "x", "z", "v", "y", "w"]);
    expect(orderTenants(list, new Set(["u"])).map((item) => item.id)).toEqual(["x", "z", "v", "u", "y", "w"]);
  });

  it("says the first state that applies, and nothing for an active company", () => {
    const line = (item: Tenant, refused = none) => tenantStateLine(item, refused);
    expect(line(tenant("a", "A"), new Set(["a"]))).toBe("You no longer have access");
    expect(line(tenant("a", "A", "DELETED"))).toBe("Deleted");
    expect(line(tenant("a", "A", "DELETING"))).toBe("Being deleted");
    expect(line(tenant("a", "A", "AUTO_CLOSED", ["PLATFORM_BLOCK"]))).toBe("Closed");
    // TAS-501: a cancelled creation is not a closed company (§4.33).
    expect(line(tenant("a", "A", "OWNER_CANCELLED"))).toBe("Cancelled");
    expect(line(tenant("a", "A", "PROVISIONING"))).toBe("Being set up");
    expect(line(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE", "PLATFORM_BLOCK"]))).toBe("Blocked by Taska");
    expect(line(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE"]))).toBe("Paused by its owner");
    // TAS-512: the three financial ones, «Read-only» first; several — the first in the table's order.
    expect(line(tenant("a", "A", "ACTIVE", ["OVER_QUOTA", "PAYMENT_DISPUTE"]))).toBe("Read-only · payment disputed");
    expect(line(tenant("a", "A", "ACTIVE", ["OVER_QUOTA", "PAYMENT_EXPIRED"]))).toBe("Read-only · paid period ended");
    expect(line(tenant("a", "A", "ACTIVE", ["OVER_QUOTA"]))).toBe("Read-only · over plan limits");
    expect(line(tenant("a", "A", "ACTIVE", ["PAYMENT_EXPIRED", "OWNER_PAUSE"]))).toBe("Paused by its owner");
    expect(tenantGroup(tenant("a", "A", "ACTIVE", ["OVER_QUOTA"]), none)).toBe(1);
    expect(line(tenant("a", "A", "AWAITING_PAYMENT"))).toBe("Awaiting first payment");
    expect(line(tenant("a", "A"))).toBeNull();
    expect(line(tenant("a", "A", "HIBERNATING"))).toBe("HIBERNATING");
    expect(tenantGroup(tenant("a", "A", "HIBERNATING"), none)).toBe(1);
    expect(tenantGroup(tenant("a", "A", "DELETED"), none)).toBe(2);
  });

  it("gives the switcher one word at most", () => {
    expect(switcherStateLabel(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE"]))).toBe("Paused");
    expect(switcherStateLabel(tenant("a", "A", "ACTIVE", ["PLATFORM_BLOCK", "OWNER_PAUSE"]))).toBe("Blocked");
    expect(switcherStateLabel(tenant("a", "A", "AWAITING_PAYMENT"))).toBe("Awaiting payment");
    // TAS-512: any of the three financial ones is «Read-only».
    for (const code of ["PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"]) expect(switcherStateLabel(tenant("a", "A", "ACTIVE", [code]))).toBe("Read-only");
    expect(switcherStateLabel(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE", "OVER_QUOTA"]))).toBe("Paused");
    expect(switcherStateLabel(tenant("a", "A"))).toBeNull();
  });
});

describe("where a tab goes (§4.33 «Когда», §5.1)", () => {
  const northwind = tenant("n", "Northwind");
  const globex = tenant("g", "Globex");
  const closed = tenant("c", "Closed Co", "AUTO_CLOSED");

  it("the remembered address that names a company comes first, whatever the list says", () => {
    expect(
      chooseCompanyRoute({ remembered: "/c/elsewhere/browse/X-1", hint: "n", tenants: [northwind], refusedThisVisit: none }),
    ).toEqual({ route: "/c/elsewhere/browse/X-1" });
  });

  it("then the hint, but only when it is in the list — carrying an address without a company", () => {
    expect(chooseCompanyRoute({ remembered: null, hint: "g", tenants: [northwind, globex], refusedThisVisit: none })).toEqual({
      route: "/c/g/projects",
    });
    expect(
      chooseCompanyRoute({ remembered: "/browse/WEB-12", hint: "g", tenants: [northwind, globex], refusedThisVisit: none }),
    ).toEqual({ route: "/c/g/browse/WEB-12" });
    expect(chooseCompanyRoute({ remembered: null, hint: "gone", tenants: [northwind, globex], refusedThisVisit: none })).toEqual({
      picker: true,
      from: null,
    });
  });

  it("then the one company of the first group, even beside closed ones", () => {
    expect(chooseCompanyRoute({ remembered: null, hint: null, tenants: [closed, northwind], refusedThisVisit: none })).toEqual({
      route: "/c/n/projects",
    });
    expect(
      chooseCompanyRoute({ remembered: null, hint: null, tenants: [globex, northwind], refusedThisVisit: new Set(["g"]) }),
    ).toEqual({ route: "/c/n/projects" });
  });

  it("else the picker, holding the address that came without a company", () => {
    expect(
      chooseCompanyRoute({ remembered: "/browse/WEB-12", hint: null, tenants: [northwind, globex], refusedThisVisit: none }),
    ).toEqual({ picker: true, from: "/browse/WEB-12" });
    expect(chooseCompanyRoute({ remembered: null, hint: null, tenants: [], refusedThisVisit: none })).toEqual({
      picker: true,
      from: null,
    });
    // An address that is no page inside a company is not remembered.
    expect(chooseCompanyRoute({ remembered: "/admin", hint: null, tenants: [], refusedThisVisit: none })).toEqual({
      picker: true,
      from: null,
    });
  });
});

describe("the closed company's words (§4.35)", () => {
  it("reads the code, then the reasons, and without a refusal the list row", () => {
    expect(closedCompanyWords(null, { code: "MEMBERSHIP_INACTIVE", reasons: [] }, null).title).toBe(
      "You no longer have access to this company",
    );
    expect(closedCompanyWords(null, { code: "PLATFORM_BLOCK", reasons: [] }, null).title).toBe("This company is blocked");
    expect(closedCompanyWords("Globex", { code: "MEMBERSHIP_INACTIVE", reasons: [] }, null)).toEqual({
      title: "You no longer have access to Globex",
      text: "Your membership was suspended or removed. If that’s a mistake, ask one of the company’s admins.",
    });
    expect(closedCompanyWords("Hooli", { code: "CAPABILITY_DISABLED", reasons: ["PLATFORM_BLOCK"] }, null).title).toBe(
      "Hooli is blocked",
    );
    expect(closedCompanyWords(null, null, tenant("i", "Initech", "ACTIVE", ["OWNER_PAUSE"])).title).toBe("This company is paused");
    expect(closedCompanyWords("M", { code: "DELETED", reasons: [] }, null).title).toBe("M has been deleted");
    expect(closedCompanyWords("M", { code: "DELETING", reasons: [] }, null).title).toBe("M is being deleted");
    // A code outside the table takes the reason from the list row (§4.35, ask A2)…
    expect(
      closedCompanyWords("Vandelay", { code: "INVALID_STATE", reasons: [] }, tenant("v", "Vandelay", "DELETING")),
    ).toEqual({ title: "Vandelay is being deleted", text: "Its projects can no longer be opened." });
    // …and a company that has never opened is not this table's at all (TAS-501): §4.37's card draws it.
    for (const lifecycle of ["PROVISIONING", "AWAITING_PAYMENT", "OWNER_CANCELLED", "AUTO_CLOSED"]) {
      expect(closedCompanyWords("M", { code: lifecycle, reasons: [] }, null), lifecycle).toEqual({
        title: "M could not be opened",
        text: null,
      });
      expect(closedCompanyWords("M", { code: "INVALID_STATE", reasons: [] }, tenant("m", "M", lifecycle)).text, lifecycle).toBeNull();
    }
    expect(
      closedCompanyWords("Hooli", { code: "INVALID_STATE", reasons: [] }, tenant("h", "Hooli", "ACTIVE", ["PLATFORM_BLOCK"])).title,
    ).toBe("Hooli is blocked");
    // …but a refusal that names a reason wins over the row.
    expect(
      closedCompanyWords("Globex", { code: "MEMBERSHIP_INACTIVE", reasons: [] }, tenant("g", "Globex", "AUTO_CLOSED")).title,
    ).toBe("You no longer have access to Globex");
    // No row either: the table's last row, the server's words in place of the sentence.
    expect(closedCompanyWords("Massive Dynamic", { code: "INVALID_STATE", reasons: [] }, null)).toEqual({
      title: "Massive Dynamic could not be opened",
      text: null,
    });
    expect(closedCompanyWords("Northwind", { code: "INVALID_STATE", reasons: [] }, tenant("n", "Northwind")).title).toBe(
      "Northwind could not be opened",
    );
  });

  it("TAS-504: to the owner, the pause's and the block's rows say so; with both, the block's (§4.35)", () => {
    const paused = { code: "CAPABILITY_DISABLED", reasons: ["OWNER_PAUSE"] };
    expect(closedCompanyWords("Initech", paused, null, true)).toEqual({
      title: "Initech is paused",
      text: "Its projects can’t be opened while it’s paused. You can resume it in its settings.",
    });
    expect(closedCompanyWords("Initech", paused, null)).toEqual({
      title: "Initech is paused",
      text: "Its owner has paused it, so its projects can’t be opened right now.",
    });
    const both = { code: "CAPABILITY_DISABLED", reasons: ["OWNER_PAUSE", "PLATFORM_BLOCK"] };
    expect(closedCompanyWords("Hooli", both, null, true)).toEqual({
      title: "Hooli is blocked",
      text: "Taska has blocked this company, so its projects can’t be opened right now. Only Taska can lift the block.",
    });
    expect(closedCompanyWords("Hooli", both, null).text).toBe("Taska has blocked this company, so its projects can’t be opened right now.");
    expect(closedCompanyReason(both, null)).toBe("PLATFORM_BLOCK");
    expect(closedCompanyReason({ code: "MEMBERSHIP_INACTIVE", reasons: ["OWNER_PAUSE"] }, null)).toBe("MEMBERSHIP_INACTIVE");
    expect(closedCompanyReason({ code: "INVALID_STATE", reasons: [] }, tenant("i", "Initech", "ACTIVE", ["OWNER_PAUSE"]))).toBe("OWNER_PAUSE");
    expect(closedCompanyReason({ code: "INVALID_STATE", reasons: [] }, null)).toBeNull();
    // A lapsed membership says the same to the owner as to anybody.
    expect(closedCompanyWords("Globex", { code: "MEMBERSHIP_INACTIVE", reasons: [] }, null, true).title).toBe("You no longer have access to Globex");
  });

  it("TAS-504: a search refused for a pause or a block says so; any other failure is not this sentence", () => {
    const refused = (code: string, reasons: string[]) => Object.assign(new Error("words"), { status: 403, code, reasons, requestId: "r", details: null });
    expect(restrictedSearchText(refused("CAPABILITY_DISABLED", ["OWNER_PAUSE"]), "Initech")).toBe("Initech is paused, so its issues can’t be searched right now.");
    expect(restrictedSearchText(refused("CAPABILITY_DISABLED", ["OWNER_PAUSE", "PLATFORM_BLOCK"]), null)).toBe(
      "This company is blocked, so its issues can’t be searched right now.",
    );
    expect(restrictedSearchText(refused("CAPABILITY_DISABLED", ["PAYMENT_DISPUTE"]), "Initech")).toBeNull();
    expect(restrictedSearchText(refused("READ_ONLY", ["OWNER_PAUSE"]), "Initech")).toBeNull();
    expect(restrictedSearchText(new TypeError("Failed to fetch"), "Initech")).toBeNull();
  });

  it("titles the document by the company, the picker or nothing", () => {
    expect(documentTitleFor({ companyName: "Globex", inCompany: true, picker: false })).toBe("Globex — Taska");
    expect(documentTitleFor({ companyName: null, inCompany: true, picker: false })).toBe("Taska");
    expect(documentTitleFor({ companyName: null, inCompany: false, picker: true })).toBe("Choose a company — Taska");
    expect(documentTitleFor({ companyName: null, inCompany: false, picker: false })).toBe("Taska");
  });
});
