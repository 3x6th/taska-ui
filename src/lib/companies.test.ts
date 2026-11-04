import { describe, expect, it } from "vitest";
import { toTenant, type Tenant } from "../api/tenants";
import {
  chooseCompanyRoute,
  closedCompanyWords,
  companyRoute,
  documentTitleFor,
  inCompanyRest,
  isOutsideCompanies,
  orderTenants,
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

  it("knows the four routes outside every company, and what an address without one would open", () => {
    for (const path of ["/login", "/invite?token=x", "/auth/callback", "/companies"]) expect(isOutsideCompanies(path)).toBe(true);
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
    expect(line(tenant("a", "A", "OWNER_CANCELLED"))).toBe("Closed");
    expect(line(tenant("a", "A", "PROVISIONING"))).toBe("Being set up");
    expect(line(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE", "PLATFORM_BLOCK"]))).toBe("Blocked by Taska");
    expect(line(tenant("a", "A", "ACTIVE", ["OWNER_PAUSE"]))).toBe("Paused by its owner");
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
    expect(closedCompanyWords("M", { code: "PROVISIONING", reasons: [] }, null).title).toBe("M is still being set up");
    // A code outside the table: the server's words go where the sentence would.
    expect(closedCompanyWords("Massive Dynamic", { code: "INVALID_STATE", reasons: [] }, null)).toEqual({
      title: "Massive Dynamic could not be opened",
      text: null,
    });
  });

  it("titles the document by the company, the picker or nothing", () => {
    expect(documentTitleFor({ companyName: "Globex", inCompany: true, picker: false })).toBe("Globex — Taska");
    expect(documentTitleFor({ companyName: null, inCompany: true, picker: false })).toBe("Taska");
    expect(documentTitleFor({ companyName: null, inCompany: false, picker: true })).toBe("Choose a company — Taska");
    expect(documentTitleFor({ companyName: null, inCompany: false, picker: false })).toBe("Taska");
  });
});
