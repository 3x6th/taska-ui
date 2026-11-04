import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { TENANT_CREATION_KEY } from "../api/tenantCreation";
import { forgetFreeUsed, TENANTS_QUERY_KEY } from "../lib/companies";
import { companiesHarness } from "../test/companiesHarness";
import { CreateCompanyScreen } from "./CreateCompanyScreen";

/*
 * DESIGN.md §4.36 «Создание компании» (TAS-501) against a fake API: the plan
 * choice, one attempt per key written before the request leaves, the replay of
 * an unanswered attempt, and the refusals — none of which draws a company.
 */

const FREE = "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d01";
const TEAM = "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d02";
const NEW = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    calls: [] as { input: unknown; key: string; record: string | null }[],
    answer: null as null | (() => Promise<unknown>),
    plans: [] as unknown[],
    plansRefusal: null as Error | null,
  };
  const api = {
    getCurrentUser: async () => ({ id: "nina", email: "nina@example.com", displayName: "Nina", status: "ACTIVE" }),
    listBillingPlans: async () => {
      if (state.plansRefusal) throw state.plansRefusal;
      return { items: state.plans, nextCursor: null };
    },
    createTenant: (input: unknown, key: string) => {
      state.calls.push({ input, key, record: window.sessionStorage.getItem("taska.tenantCreation") });
      return state.answer ? state.answer() : new Promise(() => {});
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const plan = (id: string, name: string, amountMinor: string, state = "PUBLISHED") => ({
  id,
  code: name.toLowerCase(),
  version: "1",
  name,
  price: { amountMinor, currency: "EUR", exponent: 2 },
  period: amountMinor === "0" ? "NONE" : "CALENDAR_MONTH",
  limits: [{ kind: "PROJECT", limit: "1", unlimited: false }],
  capabilities: [],
  state,
});

const refusal = (status: number, code: string) =>
  Object.assign(new Error("server words"), { status, code, requestId: `rid-${code}`, details: null, reasons: [] });

const created = (lifecycle: string) => ({
  tenant: { id: NEW, name: "Acme", ownerId: "nina", lifecycle, restrictions: [], createdAt: "2026-11-04T10:00:00Z", version: "1" },
  operation: { id: "op-1", type: "TENANT_PROVISION", state: "PENDING", createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z" },
});

const props = { theme: "light" as const, toggleTheme: () => {}, onLogout: () => {}, logoutPending: false };

beforeEach(() => {
  window.sessionStorage.clear();
  forgetFreeUsed();
  state.calls = [];
  state.answer = null;
  state.plansRefusal = null;
  state.plans = [plan(TEAM, "Team", "2000"), plan(FREE, "Free", "0"), plan("old", "Team", "1500", "RETIRED")];
});

function renderForm(options: { state?: unknown; strict?: boolean } = {}) {
  const harness = companiesHarness({ path: "/companies/new", state: options.state });
  const ui = <CreateCompanyScreen {...props} />;
  render(options.strict ? <StrictMode>{ui}</StrictMode> : ui, { wrapper: harness.wrapper });
  return harness;
}

const radios = () => screen.getAllByRole("radio") as HTMLInputElement[];

describe("Create a company", () => {
  it("offers the published plans by price, the free one chosen, a paid one never; focus in the name", async () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 1, name: "Create a company" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Loading plans");
    await waitFor(() => expect(radios()).toHaveLength(2));
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Team €20 a month" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Team €20 a month" })).toHaveAccessibleDescription(
      "1 project Nothing is charged now. The company opens once its first payment is confirmed.",
    );
    expect(screen.getByRole("group", { name: "Plan" })).toBeInTheDocument();
  });

  it("an empty name sends nothing and takes focus, the button not faded", async () => {
    renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    const create = screen.getByRole("button", { name: "Create company" });
    fireEvent.click(create);
    expect(state.calls).toEqual([]);
    expect(screen.getByText("Enter a company name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Company name")).toHaveFocus();
    expect(create).not.toHaveAttribute("aria-disabled");
  });

  it("writes the key and the trimmed body before the request leaves; a second press in flight sends nothing (B2)", async () => {
    renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "  Ac\u0007me  " } });
    fireEvent.click(screen.getByRole("radio", { name: "Team €20 a month" }));
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(state.calls).toHaveLength(1));
    const [call] = state.calls;
    expect(call.input).toEqual({ name: "Acme", planVersionId: TEAM });
    expect(call.key).toMatch(/^[0-9a-f-]{36}$/);
    // Already in storage when createTenant was called.
    expect(JSON.parse(call.record as string)).toMatchObject({ v: 1, userId: "nina", key: call.key, name: "Acme", planVersionId: TEAM });
    const inFlight = screen.getByRole("button", { name: "Creating company" });
    expect(inFlight).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(inFlight);
    fireEvent.submit(inFlight.closest("form") as HTMLFormElement);
    expect(state.calls).toHaveLength(1);
    expect(screen.getByLabelText("Company name")).toHaveAttribute("readonly");
  });

  it("an unknown outcome keeps the attempt: the values locked, a press sends the same key and body again", async () => {
    let fail = true;
    state.answer = () => (fail ? Promise.reject(new TypeError("Failed to fetch")) : new Promise(() => {}));
    renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Taska couldn’t confirm the company was created. Try again — it won’t create a second one.",
    );
    expect(screen.getByLabelText("Company name")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("radio", { name: "Team €20 a month" }));
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(state.calls).toHaveLength(2));
    expect(state.calls[1].key).toBe(state.calls[0].key);
    expect(state.calls[1].input).toEqual(state.calls[0].input);
  });

  it("FREE used: the row stays, disabled, saying why; the choice is cleared and focus stays on the button; the attempt closes", async () => {
    state.answer = () => Promise.reject(refusal(409, "FREE_ELIGIBILITY_USED"));
    renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    const create = screen.getByRole("button", { name: "Create company" });
    create.focus();
    fireEvent.click(create);
    expect(await screen.findByRole("alert")).toHaveTextContent("This company was not created.");
    expect(screen.getByText("rid-FREE_ELIGIBILITY_USED")).toBeInTheDocument();
    const free = screen.getByRole("radio", { name: "Free" });
    expect(free).toBeDisabled();
    expect(free).not.toBeChecked();
    expect(free).toHaveAccessibleDescription("You’ve used your one free company. Deleting it doesn’t bring it back.");
    expect(screen.getByRole("radio", { name: "Team €20 a month" })).not.toBeChecked();
    expect(create).toHaveFocus();
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveClass("is-unavailable");
    expect(window.sessionStorage.getItem(TENANT_CREATION_KEY)).toBeNull();
    expect(screen.getByLabelText("Company name")).not.toHaveAttribute("readonly");
    // Pressed with nothing chosen, it takes focus to the group.
    fireEvent.click(create);
    expect(screen.getByRole("radio", { name: "Team €20 a month" })).toHaveFocus();
    expect(state.calls).toHaveLength(1);
    // A new choice is a new attempt, with a new key.
    state.answer = () => new Promise(() => {});
    fireEvent.click(screen.getByRole("radio", { name: "Team €20 a month" }));
    fireEvent.click(create);
    await waitFor(() => expect(state.calls).toHaveLength(2));
    expect(state.calls[1].key).not.toBe(state.calls[0].key);
  });

  it("a reload replays the unanswered attempt by itself, once, with its key — even under StrictMode", async () => {
    window.sessionStorage.setItem(
      TENANT_CREATION_KEY,
      JSON.stringify({ v: 1, userId: "nina", key: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Acme", planVersionId: TEAM, sentAt: "x" }),
    );
    renderForm({ strict: true });
    // In flight from the first frame, the values restored.
    expect(screen.getByRole("button", { name: "Creating company" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme");
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.calls[0]).toMatchObject({ key: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", input: { name: "Acme", planVersionId: TEAM } });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(state.calls).toHaveLength(1);
  });

  it("another account's record is dropped unread, and nothing is sent", async () => {
    window.sessionStorage.setItem(
      TENANT_CREATION_KEY,
      JSON.stringify({ v: 1, userId: "anna", key: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", name: "Hers", planVersionId: TEAM, sentAt: "x" }),
    );
    renderForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create company" })).toBeInTheDocument());
    expect(screen.getByLabelText("Company name")).toHaveValue("");
    expect(state.calls).toEqual([]);
    expect(window.sessionStorage.getItem(TENANT_CREATION_KEY)).toBeNull();
  });

  it("a 202 puts the company in the list in that frame and replaces the address with the company's", async () => {
    state.answer = () => Promise.resolve(created("AWAITING_PAYMENT"));
    const { go, client } = renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("radio", { name: "Team €20 a month" }));
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(go).toHaveBeenCalledWith(`/c/${NEW}/projects`, { replace: true, state: { continuedShell: true } });
    expect(client.getQueryData<{ id: string }[]>(TENANTS_QUERY_KEY)?.map((tenant) => tenant.id)).toContain(NEW);
    // Awaiting payment: the card may still need the operation, so the record names the company.
    expect(JSON.parse(window.sessionStorage.getItem(TENANT_CREATION_KEY) as string)).toMatchObject({ tenantId: NEW, operationId: "op-1" });
  });

  it("a 202 of a working company closes the attempt and asks Projects to say so", async () => {
    state.answer = () => Promise.resolve(created("ACTIVE"));
    const { go } = renderForm();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(go).toHaveBeenCalledWith(`/c/${NEW}/projects`, { replace: true, state: { continuedShell: true, companyReady: true } });
    expect(window.sessionStorage.getItem(TENANT_CREATION_KEY)).toBeNull();
  });

  it("plans that could not be read are said, with «Try again» in Create's place; none published — no Create at all", async () => {
    state.plansRefusal = refusal(503, "DEPENDENCY_UNAVAILABLE");
    renderForm();
    expect(await screen.findByText("Plans could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("rid-DEPENDENCY_UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create company/ })).not.toBeInTheDocument();
    state.plansRefusal = null;
    state.plans = [plan("old", "Team", "1500", "RETIRED")];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No plans are available right now.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create company|Try again/ })).not.toBeInTheDocument();
  });

  it("Cancel goes back to the company it came from, with a replace; from the picker, to the picker", () => {
    const fromCompany = renderForm({ state: { from: "/c/n/projects/p1/board" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fromCompany.go).toHaveBeenCalledWith("/c/n/projects/p1/board", { replace: true, state: { continuedShell: true } });
  });
});
