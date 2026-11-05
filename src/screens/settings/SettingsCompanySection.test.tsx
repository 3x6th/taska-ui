import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { Membership } from "../../api/tenantMembers";
import type { Tenant } from "../../api/tenants";
import { companiesHarness } from "../../test/companiesHarness";
import { SettingsCompanySection } from "./SettingsCompanySection";

/*
 * Settings › General (DESIGN.md §4.39, TAS-504) against a fake API: controls
 * gated by `Tenant.ownerId` only (api-contract-guard B3, art-director B3), the
 * subscription read only for the owner (B5), no optimism (B1, art-director
 * B5/B8), every refusal by code, the transfer chain through the re-entry (B4,
 * art-director B6, G4, G6), the lost answers (G7, B4) and focus.
 */

const COMPANY = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    me: "tom",
    tenant: {} as Record<string, unknown>,
    listOwner: "tom",
    /** Set: the list's next reads wait on it — so a test sees what was put in the cache, not what was read after. */
    listHold: null as null | Promise<unknown>,
    /** Answers for the next reads of the company, in order; then `tenant`. */
    tenantReads: [] as Array<() => Promise<unknown>>,
    subscription: {} as Record<string, unknown>,
    members: [] as unknown[],
    calls: [] as string[],
    writes: [] as unknown[][],
    /** Answers for the next commands, in order; then the default. */
    answers: [] as Array<(...args: unknown[]) => Promise<unknown>>,
    session: "ts-1",
    reentered: 0,
    onReenter: null as null | (() => void),
  };
  const workspaces = new Map<string, unknown>();
  const api = {
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE" }),
    listTenants: async () => {
      state.calls.push("tenants");
      if (state.listHold) await state.listHold;
      return {
        items: [{ id: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04", name: "Umbrella", ownerId: state.listOwner, lifecycle: "ACTIVE", restrictions: [], createdAt: null, creationDeadline: null, version: "3" }],
        nextCursor: null,
      };
    },
    // One object per session, as the session layer's frozen view is (`useSyncExternalStore` compares it).
    currentWorkspace: () => {
      const view = workspaces.get(state.session) ?? { tenantId: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04", tenantName: "Umbrella", tenantSessionId: state.session };
      workspaces.set(state.session, view);
      return view;
    },
    onWorkspaceChange: () => () => {},
    getTenant: async () => {
      state.calls.push("tenant");
      const next = state.tenantReads.shift();
      return next ? next() : { ...state.tenant };
    },
    getSubscription: async () => {
      state.calls.push("subscription");
      return { ...state.subscription };
    },
    listTenantMembers: async () => {
      state.calls.push("members");
      return { items: state.members, nextCursor: null };
    },
    renameTenant: (...args: unknown[]) => command("rename", args, () => ({ ...state.tenant, name: args[1], version: "4" })),
    pauseTenant: (...args: unknown[]) => command("pause", args, () => ({ ...state.tenant, restrictions: ["OWNER_PAUSE"], version: "4" })),
    resumeTenant: (...args: unknown[]) => command("resume", args, () => ({ ...state.tenant, restrictions: [], version: "4" })),
    transferTenantOwnership: (...args: unknown[]) => command("transfer", args, () => ({ ...state.tenant, ownerId: args[1], version: "4" })),
    reenterCompany: async () => {
      state.reentered += 1;
      state.onReenter?.();
    },
  };
  function command(name: string, args: unknown[], fallback: () => unknown) {
    state.writes.push([name, ...args]);
    const next = state.answers.shift();
    return next ? next(...args) : Promise.resolve(fallback());
  }
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (overrides: Partial<Tenant> = {}) => ({
  id: COMPANY,
  name: "Umbrella",
  ownerId: "tom",
  lifecycle: "ACTIVE",
  restrictions: [] as string[],
  createdAt: "2026-05-04T09:00:00Z",
  creationDeadline: null,
  version: "3",
  ...overrides,
});

const member = (userId: string, name: string, overrides: Partial<Membership> = {}): Membership => ({
  id: `m-${userId}`,
  tenantId: COMPANY,
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

const refusal = (status: number, code: string, reasons: string[] = []) =>
  Object.assign(new Error("server words"), { status, code, requestId: `rid-${code}`, details: null, reasons });
const lost = () => new TypeError("Failed to fetch");

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let routeState: unknown = null;
function RouteState() {
  const { state: current } = useLocation();
  useEffect(() => {
    routeState = current;
  }, [current]);
  return null;
}

function renderSection(options: { state?: unknown } = {}) {
  const harness = companiesHarness({ companyId: COMPANY, path: "/settings/company", state: options.state });
  render(
    <div className="settings-area">
      <h1 className="area-section-title" tabIndex={-1}>
        General
      </h1>
      <SettingsCompanySection />
      <RouteState />
    </div>,
    { wrapper: harness.wrapper },
  );
  return harness;
}

const status = () =>
  [...document.querySelectorAll('.company-general > [role="status"]')].map((node) => node.textContent ?? "").join("");
const dd = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const ready = () => screen.findByText(/^Only the owner of/);

beforeEach(() => {
  state.me = "tom";
  state.tenant = tenant();
  state.listOwner = "tom";
  state.listHold = null;
  state.tenantReads = [];
  state.subscription = { tenantId: COMPANY, planVersionId: "team", version: "2", paidThrough: "2026-12-20T09:00:00Z", autopayState: "CONSENTED", renewalCancelled: false };
  state.members = [
    member("tom", "Tom Becker", { role: "TENANT_ADMIN", isOwner: true }),
    member("priya", "Priya Nair", { role: "TENANT_ADMIN" }),
    member("anna", "Anna Ivanova", { state: "SUSPENDED" }),
    member("sofia", "Sofia Reyes"),
  ];
  state.calls = [];
  state.writes = [];
  state.answers = [];
  state.session = "ts-1";
  state.reentered = 0;
  state.onReenter = null;
  routeState = null;
});

describe("gating by Tenant.ownerId (B3, B5)", () => {
  it("the owner: the lead, the facts with «You» and Paid until, the pencil and both rows of the zone", async () => {
    renderSection();
    expect(await screen.findByText("Only the owner of Umbrella can rename it, pause it or transfer it.")).toBeInTheDocument();
    expect(dd("Name")).toHaveTextContent("Umbrella");
    expect(dd("Owner")).toHaveTextContent("You");
    const paid = within(dd("Paid until")).getByText(/^Dec 20, \d\d:\d\d$/);
    expect(paid.tagName).toBe("TIME");
    expect(paid).toHaveAttribute("dateTime", "2026-12-20T09:00:00Z");
    expect(screen.getByRole("button", { name: "Rename company" })).toHaveAttribute("title", "Rename");
    expect(screen.getByRole("button", { name: "Pause company" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Pausing stops all changes in Umbrella until you resume it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer ownership" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(
      screen.getByText("Make another member the owner of Umbrella. Only a paid company with a current paid period can be transferred."),
    ).toBeInTheDocument();
    // Its two reads went together.
    expect(state.calls.filter((call) => call === "tenant" || call === "subscription").sort()).toEqual(["subscription", "tenant"]);
  });

  it("an admin who is not the owner: no controls in the DOM, no subscription read, the Owner a link to Members", async () => {
    state.me = "priya";
    renderSection();
    await ready();
    expect(screen.queryByRole("button", { name: "Rename company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pause company|Resume company|Transfer ownership/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Paid until")).not.toBeInTheDocument();
    expect(within(dd("Owner")).getByRole("link", { name: "See Members" })).toHaveAttribute("href", "/settings/members");
    expect(state.calls).not.toContain("subscription");
    expect(state.calls).not.toContain("members");
  });

  it("the list's ownership is only a guess: a stale row naming the reader asks once, and the page follows getTenant", async () => {
    state.me = "priya";
    state.listOwner = "priya";
    renderSection();
    await ready();
    expect(screen.queryByRole("button", { name: "Pause company" })).not.toBeInTheDocument();
    expect(screen.queryByText("Paid until")).not.toBeInTheDocument();
  });

  it("an absent or failed paidThrough draws no row — never «Free»", async () => {
    state.subscription = { tenantId: COMPANY, planVersionId: "free", version: "1", autopayState: "DISABLED", renewalCancelled: false };
    renderSection();
    await ready();
    expect(screen.queryByText("Paid until")).not.toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
  });

  it("the state lines from restrictions: the owner's block line, the pause's fact for everyone", async () => {
    state.tenant = tenant({ restrictions: ["OWNER_PAUSE", "PLATFORM_BLOCK"] });
    renderSection();
    await ready();
    const lines = [...document.querySelectorAll(".company-general-state")].map((node) => node.textContent);
    expect(lines).toEqual([
      "Blocked by Taska. No one can change anything in it, and only Taska can lift the block.",
      "Paused by its owner. No one can change anything in it while it’s paused.",
    ]);
    // Paused: the row offers Resume, which asks nothing.
    expect(screen.getByRole("button", { name: "Resume company" })).not.toHaveAttribute("aria-expanded");
  });
});

describe("loading and failing (B8)", () => {
  it("waits for getTenant and the subscription: three bars and a hidden status, no lead and no zone", async () => {
    const subscription = gate<unknown>();
    const getSubscription = fakeApi.getSubscription;
    fakeApi.getSubscription = () => subscription.promise as never;
    try {
      renderSection();
      expect(await screen.findByText("Loading company")).toBeInTheDocument();
      await waitFor(() => expect(state.calls).toContain("tenant"));
      expect(document.querySelectorAll(".company-general-loading .value-skeleton")).toHaveLength(6);
      expect(screen.queryByText(/^Only the owner of/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pause company" })).not.toBeInTheDocument();
      await act(async () => subscription.resolve({ paidThrough: "2026-12-20T09:00:00Z" }));
      await ready();
      expect(screen.getByText("Paid until")).toBeInTheDocument();
    } finally {
      fakeApi.getSubscription = getSubscription;
    }
  });

  it("a failed read: the notice without the server's words, its id, Try again — and the heading takes focus when it answers", async () => {
    state.tenantReads = [() => Promise.reject(refusal(403, "SCOPE_DENIED"))];
    renderSection();
    expect(await screen.findByText("This company’s details could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("server words")).not.toBeInTheDocument();
    expect(screen.getByText("rid-SCOPE_DENIED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    await waitFor(() => expect(screen.getByRole("heading", { name: "General" })).toHaveFocus());
  });
});

describe("more read states (B8)", () => {
  it("a refresh that fails keeps the values, with its notice above them", async () => {
    state.answers = [() => Promise.reject(refusal(409, "INVALID_STATE"))];
    // A refusal the read does not retry (an unanswered one is retried once, and would heal here).
    state.tenantReads = [() => Promise.resolve(tenant()), () => Promise.reject(refusal(403, "SCOPE_DENIED"))];
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    fireEvent.click(within(document.querySelector(".company-general-pause-confirm") as HTMLElement).getByRole("button", { name: "Pause company" }));
    expect(await screen.findByText("This company’s details could not be refreshed. The last loaded details are shown.")).toBeInTheDocument();
    expect(dd("Name")).toHaveTextContent("Umbrella");
    expect(screen.getByRole("button", { name: "Pause company" })).toBeInTheDocument();
  });

  it("a subscription read that fails is an answer too: the page draws, without Paid until", async () => {
    const getSubscription = fakeApi.getSubscription;
    fakeApi.getSubscription = () => Promise.reject(refusal(404, "RESOURCE_NOT_FOUND")) as never;
    try {
      renderSection();
      await ready();
      expect(screen.queryByText("Paid until")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pause company" })).toBeInTheDocument();
    } finally {
      fakeApi.getSubscription = getSubscription;
    }
  });

  it("the modal: members that could not be read offer Try again; with nobody else active it says so", async () => {
    const listTenantMembers = fakeApi.listTenantMembers;
    fakeApi.listTenantMembers = () => Promise.reject(refusal(403, "SCOPE_DENIED")) as never;
    try {
      renderSection();
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
      const dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
      expect(await within(dialog).findByText("Members could not be loaded, so no one can be chosen.")).toBeInTheDocument();
      expect(within(dialog).getByText("rid-SCOPE_DENIED")).toBeInTheDocument();
      fakeApi.listTenantMembers = listTenantMembers;
      state.members = [member("tom", "Tom Becker", { role: "TENANT_ADMIN", isOwner: true }), member("anna", "Anna Ivanova", { state: "SUSPENDED" })];
      fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
      expect(await within(dialog).findByText("Umbrella has no other active members to make its owner.")).toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    } finally {
      fakeApi.listTenantMembers = listTenantMembers;
    }
  });
});

describe("rename (§4.39 «Rename», B4)", () => {
  async function openForm() {
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Rename company" }));
    const field = screen.getByRole("textbox", { name: "Company name" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Umbrella");
    return field as HTMLInputElement;
  }

  it("Save sends the trimmed name with the version; the name changes everywhere in one frame; focus to the pencil", async () => {
    const harness = await (async () => {
      const result = renderSection();
      await ready();
      return result;
    })();
    state.listHold = new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Rename company" }));
    const field = screen.getByRole("textbox", { name: "Company name" });
    fireEvent.change(field, { target: { value: "  Umbrella\u0007 Corp " } });
    expect(field).toHaveValue("  Umbrella Corp ");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(state.writes).toEqual([["rename", COMPANY, "Umbrella Corp", "3", expect.stringMatching(/^[0-9a-f-]{36}$/)]]));
    await waitFor(() => expect(dd("Name")).toHaveTextContent("Umbrella Corp"));
    // The lead and the reader's list (the switcher, the menu and the title read it) in the same frame.
    expect(screen.getByText("Only the owner of Umbrella Corp can rename it, pause it or transfer it.")).toBeInTheDocument();
    expect(harness.client.getQueryData<Tenant[]>(["tenants"])?.[0].name).toBe("Umbrella Corp");
    expect(screen.getByRole("button", { name: "Rename company" })).toHaveFocus();
    expect(status()).toBe("The company is now called Umbrella Corp.");
  });

  it("an unchanged name sends nothing and closes; an empty one is steadily unavailable; Esc returns focus to the pencil", async () => {
    const field = await openForm();
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByText("Enter a company name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(state.writes).toEqual([]);
    fireEvent.change(field, { target: { value: " Umbrella " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(state.writes).toEqual([]);
    expect(screen.queryByRole("textbox", { name: "Company name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename company" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Company name" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Rename company" })).toHaveFocus();
  });

  it("in flight: the field read-only, the buttons aria-disabled with their labels; nothing optimistic", async () => {
    const answer = gate<unknown>();
    state.answers = [() => answer.promise];
    const field = await openForm();
    fireEvent.change(field, { target: { value: "Umbrella Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(field).toHaveAttribute("readonly"));
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toBeInTheDocument();
    await act(async () => answer.resolve({ ...state.tenant, name: "Umbrella Corp", version: "4" }));
    await waitFor(() => expect(dd("Name")).toHaveTextContent("Umbrella Corp"));
  });

  it("a 412 keeps the typed text, says so, re-reads the company and never retries by itself", async () => {
    state.answers = [() => Promise.reject(refusal(412, "VERSION_CONFLICT"))];
    const field = await openForm();
    fireEvent.change(field, { target: { value: "Umbrella Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Umbrella changed while you were editing, so it was not renamed. Check it and save again.",
    );
    expect(field).toHaveValue("Umbrella Corp");
    await waitFor(() => expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2));
    expect(state.writes).toHaveLength(1);
  });

  it("the pause's refusal names the pause; a VALIDATION_FAILED marks the field", async () => {
    state.answers = [() => Promise.reject(refusal(403, "READ_ONLY", ["OWNER_PAUSE"])), () => Promise.reject(refusal(400, "VALIDATION_FAILED"))];
    const field = await openForm();
    fireEvent.change(field, { target: { value: "Umbrella Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Umbrella is paused. Resume it to rename it.");
    expect(screen.getByText("rid-READ_ONLY")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Taska didn’t accept this name."));
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("a new attempt takes the previous refusal away in the frame of the press", async () => {
    const second = gate<unknown>();
    state.answers = [() => Promise.reject(refusal(403, "READ_ONLY", ["OWNER_PAUSE"])), () => second.promise];
    const field = await openForm();
    fireEvent.change(field, { target: { value: "Umbrella Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Umbrella is paused. Resume it to rename it.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => second.resolve({ ...state.tenant, name: "Umbrella Corp", version: "4" }));
    await waitFor(() => expect(dd("Name")).toHaveTextContent("Umbrella Corp"));
  });

  it("a lost answer: no re-read, and Save again sends the same key, version and body", async () => {
    state.answers = [() => Promise.reject(lost())];
    const field = await openForm();
    fireEvent.change(field, { target: { value: "Umbrella Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Taska couldn’t confirm the new name. Save again — it won’t be applied twice.");
    expect(state.calls.filter((call) => call === "tenant")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]).toEqual(state.writes[0]);
  });
});

describe("pause and resume (§4.39, B5, G7)", () => {
  it("Pause asks first — the end date as sent, Cancel focused — and the trigger wears the answer's edge while it is open", async () => {
    renderSection();
    await ready();
    const trigger = screen.getByRole("button", { name: "Pause company" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveClass("strip-trigger");
    expect(screen.getByText(/^Umbrella will be paused: .* it still ends Dec 20, /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(state.writes).toEqual([]);
  });

  it("in flight nothing changes; the answer turns Pause into Resume, in the list row too, focus staying on the button", async () => {
    const answer = gate<unknown>();
    state.answers = [() => answer.promise];
    const harness = renderSection();
    await ready();
    state.listHold = new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    const strip = document.querySelector(".company-general-pause-confirm") as HTMLElement;
    fireEvent.click(within(strip).getByRole("button", { name: "Pause company" }));
    await waitFor(() => expect(state.writes).toEqual([["pause", COMPANY, "3", expect.any(String)]]));
    const row = screen.getAllByRole("button", { name: "Pause company" })[0];
    await waitFor(() => expect(row).toHaveAttribute("aria-disabled", "true"));
    expect(within(strip).getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(/^Paused by its owner/)).not.toBeInTheDocument();
    await act(async () => answer.resolve({ ...state.tenant, restrictions: ["OWNER_PAUSE"], version: "4" }));
    const resume = await screen.findByRole("button", { name: "Resume company" });
    expect(resume).toBe(row);
    expect(resume).toHaveFocus();
    expect(screen.getByText(/^Paused by its owner/)).toBeInTheDocument();
    expect(harness.client.getQueryData<Tenant[]>(["tenants"])?.[0].restrictions).toEqual(["OWNER_PAUSE"]);
    expect(status()).toBe("Umbrella is paused.");
    // The subscription is not read again (D129).
    expect(state.calls.filter((call) => call === "subscription")).toHaveLength(1);
  });

  it("Resume asks nothing; a block's refusal is said under the row, not live, with its id, and the company is re-read", async () => {
    state.tenant = tenant({ restrictions: ["OWNER_PAUSE", "PLATFORM_BLOCK"] });
    state.answers = [() => Promise.reject(refusal(403, "READ_ONLY", ["PLATFORM_BLOCK", "OWNER_PAUSE"]))];
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Resume company" }));
    await waitFor(() => expect(state.writes).toEqual([["resume", COMPANY, "3", expect.any(String)]]));
    const sentence = "Taska has blocked Umbrella, so it can’t be resumed until Taska lifts the block.";
    await waitFor(() => expect(status()).toBe(sentence));
    expect(screen.getByText(sentence, { selector: ".error-note-sentence" })).not.toHaveAttribute("role");
    expect(screen.getByText("rid-READ_ONLY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume company" })).toHaveFocus();
    await waitFor(() => expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2));
  });

  it("a lost pause: said, not re-read; pressed again it repeats the same key and version (G7)", async () => {
    state.answers = [() => Promise.reject(lost())];
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    fireEvent.click(within(document.querySelector(".company-general-pause-confirm") as HTMLElement).getByRole("button", { name: "Pause company" }));
    await waitFor(() => expect(status()).toBe("Taska couldn’t confirm that Umbrella was paused. Press Pause company again to check."));
    expect(state.calls.filter((call) => call === "tenant")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    fireEvent.click(within(document.querySelector(".company-general-pause-confirm") as HTMLElement).getByRole("button", { name: "Pause company" }));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]).toEqual(state.writes[0]);
    await screen.findByRole("button", { name: "Resume company" });
  });

  it("OWNER_REQUIRED whose re-read names another owner: the subscription dropped, the company re-entered, no status (G6)", async () => {
    // Another tab handed it to Priya meanwhile: every read from now on says so.
    state.answers = [
      () => {
        state.tenant = tenant({ ownerId: "priya", version: "4" });
        return Promise.reject(refusal(403, "OWNER_REQUIRED"));
      },
    ];
    const harness = renderSection();
    await ready();
    state.listHold = new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    fireEvent.click(within(document.querySelector(".company-general-pause-confirm") as HTMLElement).getByRole("button", { name: "Pause company" }));
    await waitFor(() => expect(state.reentered).toBe(1));
    expect(harness.client.getQueryData(["company-subscription"])).toBeUndefined();
    // The list row follows the re-read before the re-entry (G2).
    expect(harness.client.getQueryData<Tenant[]>(["tenants"])?.[0].ownerId).toBe("priya");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Pause company|Resume company/ })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "General" })).toHaveFocus());
    expect(status()).toBe("Only the owner of Umbrella can pause it.");
    expect(routeState).toBeNull();
  });
});

describe("transfer (§4.39, B4, art-director B6)", () => {
  async function openModal() {
    renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
    await within(dialog).findByRole("combobox", { name: "New owner" });
    return dialog;
  }
  const choose = (dialog: HTMLElement, userId: string) =>
    fireEvent.change(within(dialog).getByRole("combobox", { name: "New owner" }), { target: { value: userId } });
  const answer = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { name: "Transfer ownership" }).at(-1) as HTMLElement;

  it("the picker: ACTIVE members with a known role, never the reader, nothing chosen; one read on open", async () => {
    const dialog = await openModal();
    const select = within(dialog).getByRole("combobox", { name: "New owner" });
    expect(select).toHaveFocus();
    expect([...select.querySelectorAll("option")].map((option) => [option.textContent, option.disabled])).toEqual([
      ["Choose a member", true],
      ["Priya Nair · priya@example.com", false],
      ["Sofia Reyes · sofia@example.com", false],
    ]);
    expect(select).toHaveValue("");
    expect(within(dialog).getByText("Only active members can become the owner.")).toBeInTheDocument();
    expect(state.calls.filter((call) => call === "members")).toHaveLength(1);
    // Steadily unavailable until a choice: pressing it puts focus on the select.
    expect(answer(dialog)).toHaveAttribute("aria-disabled", "true");
    expect(answer(dialog)).toHaveClass("is-unavailable");
    within(dialog).getByRole("button", { name: "Cancel" }).focus();
    fireEvent.click(answer(dialog));
    expect(select).toHaveFocus();
    expect(state.writes).toEqual([]);
    expect(within(dialog).getByText("The new owner becomes the owner of Umbrella.")).toBeInTheDocument();
    choose(dialog, "sofia");
    expect(within(dialog).getByText("Sofia Reyes becomes the owner of Umbrella and an admin in every project.")).toBeInTheDocument();
    expect(within(dialog).getByText("Automatic payments you set up are turned off. Sofia Reyes sets up their own.")).toBeInTheDocument();
    expect(answer(dialog)).not.toHaveAttribute("aria-disabled");
  });

  it("the 200 keeps the modal in flight through the re-entry and the re-read; then the non-owner view, the recipient, focus and status", async () => {
    const reread = gate<unknown>();
    state.tenantReads = [() => Promise.resolve(tenant()), () => reread.promise];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(state.writes).toEqual([["transfer", COMPANY, "priya", "3", expect.any(String)]]));
    await waitFor(() => expect(state.reentered).toBe(1));
    // The re-entry kept this context (no new session): the page follows the company read again.
    expect(screen.getByRole("dialog", { name: "Transfer ownership" })).toBeInTheDocument();
    expect(answer(dialog)).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("combobox", { name: "New owner" })).toHaveAttribute("aria-disabled", "true");
    expect(routeState).toMatchObject({ companyHandOver: { fromSession: "ts-1", recipient: { userId: "priya", name: "Priya Nair" } } });
    await act(async () => reread.resolve(tenant({ ownerId: "priya", version: "4" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Pause company|Transfer ownership|Rename company/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Paid until")).not.toBeInTheDocument();
    expect(dd("Owner")).toHaveTextContent("Priya Nair");
    expect(screen.getByRole("heading", { name: "General" })).toHaveFocus();
    expect(status()).toBe("Priya Nair now owns Umbrella. You’re still an admin.");
    // The entry is replaced: a reload would not say it again. And nothing of the owner's was read after the 200.
    expect(routeState).toBeNull();
    expect(state.calls.filter((call) => call === "subscription")).toHaveLength(1);
  });

  it("the new context finishes it: the same modal in flight until its company answers, then the status — no subscription read", async () => {
    state.session = "ts-2";
    state.tenant = tenant({ ownerId: "priya", version: "4" });
    const read = gate<unknown>();
    state.tenantReads = [() => read.promise];
    renderSection({
      state: {
        companyHandOver: {
          fromSession: "ts-1",
          recipient: { userId: "priya", name: "Priya Nair", email: "priya@example.com", role: "TENANT_ADMIN" },
          status: "Priya Nair now owns Umbrella. You’re still an admin.",
        },
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
    // Neither the panel nor the scrim enters again (§4.11, art-director BLK-1).
    expect(dialog.closest(".modal-layer")).toHaveClass("is-continued");
    expect(answer(dialog)).toHaveAttribute("aria-disabled", "true");
    // Focus is where the reader left it — the answer in flight — not the select.
    expect(answer(dialog)).toHaveFocus();
    expect(within(dialog).getByRole("combobox", { name: "New owner" })).toHaveValue("priya");
    // ✕ and the scrim close nothing mid-transfer.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(screen.getByRole("dialog", { name: "Transfer ownership" })).toBeInTheDocument();
    expect(state.calls).not.toContain("members");
    await act(async () => read.resolve(tenant({ ownerId: "priya", version: "4" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(dd("Owner")).toHaveTextContent("Priya Nair");
    expect(screen.getByRole("heading", { name: "General" })).toHaveFocus();
    expect(status()).toBe("Priya Nair now owns Umbrella. You’re still an admin.");
    expect(routeState).toBeNull();
    expect(state.calls).not.toContain("subscription");
  });

  it("a lost answer is sent once more with the same key and body; then the re-read company decides — never the 403 itself", async () => {
    state.answers = [() => Promise.reject(lost()), () => Promise.reject(refusal(403, "OWNER_REQUIRED"))];
    state.tenantReads = [() => Promise.resolve(tenant()), () => Promise.resolve(tenant({ ownerId: "priya", version: "4" }))];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]).toEqual(state.writes[0]);
    await waitFor(() => expect(status()).toBe("Priya Nair now owns Umbrella. You’re still an admin."));
    expect(state.reentered).toBe(1);
  });

  it("lost twice and still the reader's: said in the modal, the choice kept — and the next press repeats the same key", async () => {
    state.answers = [() => Promise.reject(lost()), () => Promise.reject(lost())];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Taska couldn’t confirm the transfer, and Umbrella is still yours. Try again.");
    expect(within(dialog).getByRole("combobox", { name: "New owner" })).toHaveValue("priya");
    expect(state.reentered).toBe(0);
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(3));
    expect(state.writes[2]).toEqual(state.writes[0]);
  });

  it("FREE (409 INVALID_STATE): nothing changes; the company and the members are read again and the modal stays", async () => {
    state.answers = [() => Promise.reject(refusal(409, "INVALID_STATE"))];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Umbrella was not transferred.");
    expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2);
    expect(state.calls.filter((call) => call === "members")).toHaveLength(2);
    expect(within(dialog).getByRole("combobox", { name: "New owner" })).toHaveValue("priya");
    expect(dd("Owner")).toHaveTextContent("You");
    expect(state.reentered).toBe(0);
  });

  it("a recipient who stopped being active: their name in the sentence, and the choice taken away", async () => {
    state.answers = [
      () => {
        state.members = state.members.map((row) => ((row as Membership).userId === "priya" ? { ...(row as Membership), state: "SUSPENDED" } : row));
        return Promise.reject(refusal(409, "INVALID_STATE"));
      },
    ];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Priya Nair is no longer an active member, so Umbrella was not transferred.");
    expect(within(dialog).getByRole("combobox", { name: "New owner" })).toHaveValue("");
    expect(answer(dialog)).toHaveAttribute("aria-disabled", "true");
  });

  it("the new context's company could not be read: the modal goes, the failure says so aloud, no status, the route state dropped", async () => {
    state.session = "ts-2";
    state.tenantReads = [() => Promise.reject(refusal(403, "SCOPE_DENIED"))];
    renderSection({
      state: {
        companyHandOver: {
          fromSession: "ts-1",
          recipient: { userId: "priya", name: "Priya Nair", email: "priya@example.com", role: "TENANT_ADMIN" },
          status: "Priya Nair now owns Umbrella. You’re still an admin.",
        },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This company’s details could not be loaded.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(routeState).toBeNull());
    expect(status()).toBe("");
    expect(screen.getByRole("heading", { name: "General" })).toHaveFocus();
    // Try again reads it; nothing says the transfer now — nothing confirmed it when it was said.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(status()).toBe("");
  });

  it("in flight, ✕ and the scrim close nothing; the answer is then said in the modal", async () => {
    const sent = gate<unknown>();
    state.answers = [() => sent.promise];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(answer(dialog)).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(screen.getByRole("dialog", { name: "Transfer ownership" })).toBe(dialog);
    await act(async () => sent.reject(refusal(403, "READ_ONLY", ["PAYMENT_EXPIRED"])));
    // TAS-512: the refusal's own reason names itself (§4.35's clause).
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Umbrella’s paid period has ended, so it was not transferred.");
  });

  it("lost, then 403 OWNER_REQUIRED, and the re-read fails: unconfirmed — «Reload this page», no re-entry, the same key next time", async () => {
    state.answers = [() => Promise.reject(lost()), () => Promise.reject(refusal(403, "OWNER_REQUIRED"))];
    state.tenantReads = [() => Promise.resolve(tenant()), () => Promise.reject(refusal(403, "SCOPE_DENIED"))];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Taska couldn’t confirm the transfer. Reload this page to see who owns Umbrella.",
    );
    expect(within(dialog).queryByText(/Only the owner/)).not.toBeInTheDocument();
    expect(state.reentered).toBe(0);
    expect(status()).toBe("");
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(3));
    expect(state.writes[2]).toEqual(state.writes[0]);
  });

  it("lost, then 403 OWNER_REQUIRED, and the company is still the reader's: «still yours», never a success", async () => {
    state.answers = [() => Promise.reject(lost()), () => Promise.reject(refusal(403, "OWNER_REQUIRED"))];
    const dialog = await openModal();
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Taska couldn’t confirm the transfer, and Umbrella is still yours. Try again.",
    );
    expect(state.reentered).toBe(0);
    expect(status()).toBe("");
    expect(dd("Owner")).toHaveTextContent("You");
    expect(routeState).toBeNull();
  });

  it("refused OWNER_REQUIRED and the re-read names somebody else (another tab's transfer): followed without a status (G6)", async () => {
    state.answers = [
      () => {
        state.tenant = tenant({ ownerId: "sofia", version: "4" });
        return Promise.reject(refusal(403, "OWNER_REQUIRED"));
      },
    ];
    const harness = renderSection();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
    await within(dialog).findByRole("combobox", { name: "New owner" });
    state.listHold = new Promise(() => {});
    choose(dialog, "priya");
    fireEvent.click(answer(dialog));
    await waitFor(() => expect(state.reentered).toBe(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The list row follows the re-read before the re-entry (G2).
    expect(harness.client.getQueryData<Tenant[]>(["tenants"])?.[0].ownerId).toBe("sofia");
    await waitFor(() => expect(screen.getByRole("heading", { name: "General" })).toHaveFocus());
    expect(status()).toBe("");
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).not.toBeInTheDocument();
    expect(routeState).toBeNull();
  });

  it("Cancel closes and hands focus back to Transfer ownership; nothing is sent", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transfer ownership" })).toHaveFocus();
    expect(state.writes).toEqual([]);
  });
});

describe("a late answer after the reader moved away (release-reviewer F4)", () => {
  let path = "";
  function Path() {
    const { pathname } = useLocation();
    useEffect(() => {
      path = pathname;
    }, [pathname]);
    return null;
  }
  function Away() {
    const navigate = useNavigate();
    return (
      <button onClick={() => navigate("/settings/profile")} type="button">
        Away
      </button>
    );
  }

  it("a G6 re-read that answers after the page is gone re-enters the company but never pulls the reader back", async () => {
    const reread = gate<unknown>();
    state.answers = [() => Promise.reject(refusal(403, "OWNER_REQUIRED"))];
    state.tenantReads = [() => Promise.resolve(tenant()), () => reread.promise];
    const harness = companiesHarness({ companyId: COMPANY, path: "/settings/company" });
    render(
      <div className="settings-area">
        <h1 className="area-section-title" tabIndex={-1}>
          General
        </h1>
        <Routes>
          <Route path="/settings/company" element={<SettingsCompanySection />} />
          <Route path="/settings/profile" element={<p>profile</p>} />
        </Routes>
        <Away />
        <Path />
      </div>,
      { wrapper: harness.wrapper },
    );
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pause company" }));
    fireEvent.click(within(document.querySelector(".company-general-pause-confirm") as HTMLElement).getByRole("button", { name: "Pause company" }));
    await waitFor(() => expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Away" }));
    expect(await screen.findByText("profile")).toBeInTheDocument();
    await act(async () => reread.resolve(tenant({ ownerId: "priya", version: "4" })));
    await waitFor(() => expect(state.reentered).toBe(1));
    await act(async () => {});
    expect(path).toBe("/settings/profile");
    expect(screen.getByText("profile")).toBeInTheDocument();
  });
});
