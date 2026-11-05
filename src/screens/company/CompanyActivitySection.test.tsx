import { onlineManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { toCompanyActivityPage, type ListTenantActivityParams } from "../../api/tenantActivity";
import { companiesHarness } from "../../test/companiesHarness";
import { CompanyActivitySection } from "./CompanyActivitySection";

/*
 * Company › Activity (DESIGN.md §4.41, TAS-524) against a fake API: the rows
 * and their recipe, the author link and its chip, the kind popover and the
 * multi-kind chip, «Show more» and the end line, every state, focus after
 * each action, the one live region's phrases and silences, and the reads —
 * the first page only on entry, «Try again», «Start again» and a change of
 * filter; the pages «Show more» added dropped, never re-read.
 */

const NW = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const TOM = "8a1f4c2e-7b3d-4e5f-9a0b-1c2d3e4f5a6b";
const MARK = "e65186a2-b807-42ae-a66f-711be116a93b";

type Answer = { items: unknown[]; nextCursor?: string } | Error;

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    calls: [] as ListTenantActivityParams[],
    /** By cursor ("" for the first page), then by the filters' string: an answer or a refusal. */
    answer: (_params: ListTenantActivityParams): Answer => ({ items: [] }),
    /** Every read waits behind it while it is set — a request held in flight. */
    gate: null as Promise<void> | null,
  };
  const api = {
    getCurrentUser: async () => ({ id: "anna", email: "anna@example.com", displayName: "Anna Ivanova", status: "ACTIVE" }),
    listTenants: async () => ({
      items: [{ id: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01", name: "Northwind", ownerId: "anna", lifecycle: "ACTIVE", restrictions: [], createdAt: null, version: "3" }],
      nextCursor: null,
    }),
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
    listTenantActivity: async (_companyId: string, params: ListTenantActivityParams) => {
      state.calls.push(params);
      if (state.gate) await state.gate;
      const answer = state.answer(params);
      if (answer instanceof Error) throw answer;
      return { items: answer.items, nextCursor: answer.nextCursor ?? null };
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const record = (id: string, wire: Record<string, unknown> = {}) => ({
  id,
  tenantId: NW,
  createdAt: "2026-11-04T09:12:00Z",
  actor: { userId: ANNA, displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false },
  kind: "TENANT_PAUSED",
  target: { type: "TENANT", id: NW, displayName: "Northwind" },
  outcome: "SUCCEEDED",
  ...wire,
});

/** A page as the session layer hands it on — through the mapper, so the fake answers what it would. */
const page = (items: unknown[], nextCursor?: string) => {
  const mapped = toCompanyActivityPage({ items, nextCursor });
  return { items: mapped.items as unknown[], ...(mapped.nextCursor ? { nextCursor: mapped.nextCursor } : {}) };
};

const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("the server's words"), { status, code, requestId: `rid-${code}`, details: null, reasons: [], ...extra });

function Whereabouts() {
  const location = useLocation();
  return <p data-testid="whereabouts">{`${location.pathname}${location.search}`}</p>;
}

function renderActivity(path = "/company/activity") {
  const harness = companiesHarness({ companyId: NW, path });
  const view = render(
    <div className="settings-area">
      <h1 className="area-section-title" tabIndex={-1}>
        Activity
      </h1>
      <CompanyActivitySection />
      <Whereabouts />
    </div>,
    { wrapper: harness.wrapper },
  );
  return { ...harness, view };
}

const heading = () => screen.getByRole("heading", { level: 1 });
const list = () => screen.getByRole("list", { name: "Activity" });
const rows = () => within(list()).getAllByRole("listitem");
const status = () => document.querySelector<HTMLElement>('.company-activity > [role="status"]') as HTMLElement;
const whereabouts = () => screen.getByTestId("whereabouts").textContent ?? "";
const addFilter = () => screen.getByRole("button", { name: "Filter" });
/** A notice's own sentence — the status region may say the same words. */
const notice = (text: string) => screen.findByText(text, { selector: ".api-notice-sentence" });
const note = (text: string) => screen.findByText(text, { selector: ".error-note-sentence" });

const NORTHWIND_LOG = [
  record("r-5", {
    kind: "INVITATION_RESENT",
    actor: { userId: MARK, platformAdmin: true },
    target: { type: "INVITATION", id: "i-kai", email: "kai@example.com" },
  }),
  record("r-4", { kind: "INVITATION_CREATED", target: { type: "INVITATION", id: "i-kai", email: "kai@example.com" }, details: { role: "MEMBER" } }),
  record("r-3", { kind: "MEMBER_SUSPENDED", actor: { userId: TOM, displayName: "Tom Becker", platformAdmin: true }, target: { type: "MEMBER", id: "u-omar", displayName: "Omar Haddad" } }),
  record("r-2", { kind: "TENANT_EXPORTED", createdAt: "soon" }),
  record("r-1", { kind: "TENANT_CREATED", actor: { userId: "not-a-uuid", displayName: "Old Import", platformAdmin: false } }),
];

beforeEach(() => {
  state.calls = [];
  state.gate = null;
  state.answer = () => page(NORTHWIND_LOG);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the list (§4.41 «Форма», «Строка»)", () => {
  it("the lead, then one row per record in the server's order — a sentence and its meta line", async () => {
    renderActivity();
    expect(await screen.findByText("Who changed what in Northwind, newest first.")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(rows().map((row) => row.querySelector(".company-activity-sentence")?.textContent)).toEqual([
      "A Taska administrator resent the invitation to kai@example.com.",
      "Anna Ivanova invited kai@example.com as a Member.",
      "Tom Becker suspended Omar Haddad.",
      "Other action by Anna Ivanova on the company.",
      "Old Import created the company.",
    ]);
    // The first page only, 50, no filters (B1).
    expect(state.calls).toEqual([{ limit: 50 }]);
    // No count, no total, no grouping.
    expect(screen.queryByText(/\d+ entr/)).not.toBeInTheDocument();
  });

  it("the meta line: the local time in <time>, the platform mark for a named administrator, an unknown kind's code, «Time unknown»", async () => {
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    const [nameless, , named, unknown] = rows();
    const time = nameless.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-11-04T09:12:00Z");
    expect(time?.getAttribute("title")).toMatch(/2026/);
    // A nameless administrator is named by the sentence, not the mark.
    expect(nameless.querySelector(".company-activity-mark")).toBeNull();
    expect(named.querySelector(".company-activity-mark")).toHaveTextContent("Taska administrator");
    expect(named.querySelector('.company-activity-meta [aria-hidden="true"]')).toHaveTextContent("·");
    expect(unknown.querySelector(".company-activity-code")).toHaveTextContent("TENANT_EXPORTED");
    expect(unknown.querySelector(".company-activity-meta")).toHaveTextContent(/^Time unknown/);
    expect(unknown.querySelector("time")).toBeNull();
  });

  it("names are 550, words are not; «Not done: » before a record that did not take effect", async () => {
    state.answer = () => page([record("r-1", { kind: "MEMBER_SUSPENDED", outcome: "DENIED", target: { type: "MEMBER", id: "u" } })]);
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const sentence = rows()[0].querySelector(".company-activity-sentence") as HTMLElement;
    expect(sentence).toHaveTextContent("Not done: Anna Ivanova suspended someone.");
    expect(sentence.querySelector(".company-activity-not-done")).toHaveTextContent("Not done:");
    expect(within(sentence).getByText("someone")).not.toHaveClass("company-activity-named");
  });

  it("the author is a link to their filter — unless the id is not a UUID — described once, and its own name", async () => {
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    const link = within(rows()[1]).getByRole("link", { name: "Anna Ivanova" });
    expect(link).toHaveAttribute("href", `/company/activity?actorUserId=${ANNA}`);
    expect(link).toHaveAttribute("title", "Shows only this person’s actions.");
    expect(link).toHaveAccessibleDescription("Shows only this person’s actions.");
    expect(within(rows()[0]).getByRole("link", { name: "A Taska administrator" })).toHaveAttribute("href", `/company/activity?actorUserId=${MARK}`);
    expect(within(rows()[4]).queryByRole("link")).toBeNull();
    // One description node for the section.
    expect(document.querySelectorAll("[hidden]")).toHaveLength(1);
  });
});

describe("the states (§4.41 «Состояния»)", () => {
  it("first entry: the lead, the filter row and three skeleton rows, «Loading activity» — the list busy", async () => {
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderActivity();
    // Drawn before the answer: the lead does not wait for it.
    expect(screen.getByText(/^Who changed what in (this company|Northwind), newest first\.$/)).toBeInTheDocument();
    expect(addFilter()).toBeInTheDocument();
    expect(list()).toHaveAttribute("aria-busy", "true");
    expect(list().querySelectorAll(".value-skeleton")).toHaveLength(6);
    expect(screen.getByText("Loading activity")).toHaveAttribute("role", "status");
    await act(async () => release());
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(list()).not.toHaveAttribute("aria-busy");
    // Silent on entry (§5.6).
    expect(status()).toBeEmptyDOMElement();
  });

  it("empty: «No activity in {Company} yet.», no foot; with filters, «No activity matches these filters.» and «Clear filters»", async () => {
    state.answer = () => page([]);
    const first = renderActivity();
    expect(await screen.findByText("No activity in Northwind yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("No older activity.")).not.toBeInTheDocument();
    first.view.unmount();

    renderActivity(`/company/activity?kind=MEMBER_LEFT`);
    expect(await screen.findByText("No activity matches these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(whereabouts()).toBe("/company/activity"));
    await waitFor(() => expect(addFilter()).toHaveFocus());
    await waitFor(() => expect(status()).toHaveTextContent("No activity in Northwind yet."));
  });

  it("a 403 SCOPE_DENIED is a refusal with its id — no filter row, no list, no button, never an empty log", async () => {
    state.answer = () => refusal(403, "SCOPE_DENIED");
    renderActivity();
    expect(await notice("Only the admins and the owner of Northwind can see its activity.")).toBeInTheDocument();
    expect(screen.getByText("rid-SCOPE_DENIED")).toBeInTheDocument();
    // Not the server's words.
    expect(screen.queryByText("the server's words")).not.toBeInTheDocument();
    // Only the request id's own copy button.
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Copy request id rid-SCOPE_DENIED"]);
    expect(screen.queryByRole("list", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No activity/)).not.toBeInTheDocument();
    // A notice found on arrival is not live.
    expect(await notice("Only the admins and the owner of Northwind can see its activity.")).not.toHaveAttribute("role");
    expect(status()).toBeEmptyDOMElement();
  });

  it("a first page that did not load: the notice, the server's words for a code outside the dictionary, «Try again» — the filter row stays", async () => {
    state.answer = () => Object.assign(new Error("No static resource api/v1/tenants/x/activity"), { status: 404, code: "NOT_FOUND", requestId: "rid-404" });
    renderActivity();
    expect(await notice("Activity could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("No static resource api/v1/tenants/x/activity")).toBeInTheDocument();
    expect(screen.getByText("rid-404")).toBeInTheDocument();
    expect(addFilter()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("«Try again»: the refusal stays drawn while it is out, then the rows and the heading — said nothing", async () => {
    let fail = true;
    state.answer = () => (fail ? refusal(409, "INVALID_STATE") : page(NORTHWIND_LOG));
    renderActivity();
    const retry = await screen.findByRole("button", { name: "Try again" });
    // A known code's words are not printed.
    expect(screen.queryByText("the server's words")).not.toBeInTheDocument();
    fail = false;
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-disabled", "true"));
    expect(await notice("Activity could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Loading activity")).not.toBeInTheDocument();
    fireEvent.click(retry);
    await act(async () => release());
    await waitFor(() => expect(rows()).toHaveLength(5));
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(state.calls).toHaveLength(2);
    expect(status()).toBeEmptyDOMElement();
  });

  it("«Try again» refused again: focus on the new refusal's button, the sentence said", async () => {
    state.answer = () => refusal(409, "INVALID_STATE");
    renderActivity();
    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await waitFor(() => expect(status()).toHaveTextContent("Activity could not be loaded."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus());
  });

  it("a 429 says its wait", async () => {
    state.answer = () => refusal(429, "RATE_LIMITED", { retryAfterSeconds: 20 });
    renderActivity();
    expect(await notice("Activity could not be loaded. Try again in 20 seconds.")).toBeInTheDocument();
    expect(screen.getByText("rid-RATE_LIMITED")).toBeInTheDocument();
  });

  it("a 400 on the first page with filters: «Taska didn’t accept these filters.» and «Clear filters»; without filters, the plain refusal", async () => {
    state.answer = () => refusal(400, "VALIDATION_FAILED");
    const filtered = renderActivity("/company/activity?kind=TENANT_EXPORTED");
    expect(await notice("Taska didn’t accept these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    // The address's kinds are sent as they stand: the server validates them.
    expect(state.calls).toEqual([{ limit: 50, kinds: ["TENANT_EXPORTED"] }]);
    filtered.view.unmount();
    renderActivity();
    expect(await notice("Activity could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("re-entry: the cached first page at once, read again; a re-read that fails keeps the rows under a notice", async () => {
    const first = renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    first.view.unmount();
    state.answer = () => refusal(409, "INVALID_STATE");
    // The same query client: a re-entry.
    render(
      <div className="settings-area">
        <h1 className="area-section-title" tabIndex={-1}>
          Activity
        </h1>
        <CompanyActivitySection />
      </div>,
      { wrapper: first.wrapper },
    );
    // No skeleton: the cached rows, then the notice above them.
    expect(rows()).toHaveLength(5);
    expect(await notice("Activity could not be refreshed. The last loaded list is shown.")).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
    expect(state.calls).toEqual([{ limit: 50 }, { limit: 50 }]);
  });
});

describe("«Show more» and the end (§4.41 «Подвал»)", () => {
  const long = (from: number, count: number) => Array.from({ length: count }, (_, index) => record(`r-${from + index}`));

  beforeEach(() => {
    state.answer = (params) => {
      if (params.cursor === undefined) return page(long(0, 50), "c-1");
      if (params.cursor === "c-1") return page(long(50, 50), "c-2");
      return page(long(100, 3));
    };
  });

  it("appends in the server's order, focuses the first new row, and ends with «No older activity.»", async () => {
    renderActivity();
    const more = await screen.findByRole("button", { name: "Show more activity" });
    expect(more).toHaveTextContent(/^Show more$/);
    fireEvent.click(more);
    await waitFor(() => expect(rows()).toHaveLength(100));
    const firstNew = rows()[50];
    await waitFor(() => expect(firstNew).toHaveFocus());
    expect(firstNew).toHaveAttribute("tabindex", "-1");
    // Only the new page's first row is a script target; none is a Tab stop.
    expect(rows()[0]).not.toHaveAttribute("tabindex");
    expect(state.calls.at(-1)).toEqual({ limit: 50, cursor: "c-1" });
    fireEvent.click(screen.getByRole("button", { name: "Show more activity" }));
    await waitFor(() => expect(rows()).toHaveLength(103));
    expect(screen.queryByRole("button", { name: "Show more activity" })).not.toBeInTheDocument();
    expect(screen.getByText("No older activity.")).toBeInTheDocument();
    // Success with rows is said by focus, not by the status region.
    expect(status()).toBeEmptyDOMElement();
  });

  it("in flight: aria-disabled and data-busy, the label unchanged, a second press asks nothing", async () => {
    renderActivity();
    const more = await screen.findByRole("button", { name: "Show more activity" });
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(more);
    await waitFor(() => expect(more).toHaveAttribute("aria-disabled", "true"));
    expect(more).toHaveAttribute("data-busy", "true");
    expect(more).toHaveTextContent(/^Show more$/);
    fireEvent.click(more);
    await act(async () => release());
    await waitFor(() => expect(rows()).toHaveLength(100));
    expect(state.calls).toHaveLength(2);
  });

  it("a continuation that did not load keeps the rows; the same «Show more» tries again, the box goes with its success", async () => {
    let fail = true;
    state.answer = (params) => {
      if (params.cursor === undefined) return page(long(0, 50), "c-1");
      return fail ? refusal(409, "INVALID_STATE") : page(long(50, 2));
    };
    renderActivity();
    const more = await screen.findByRole("button", { name: "Show more activity" });
    fireEvent.click(more);
    expect(await note("More activity could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("rid-INVALID_STATE")).toBeInTheDocument();
    expect(rows()).toHaveLength(50);
    expect(status()).toHaveTextContent("More activity could not be loaded.");
    // Not live: the status region said it, the box does not.
    expect(screen.getByText("More activity could not be loaded.", { selector: ".error-note-sentence" })).not.toHaveAttribute("role");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Show more activity" }));
    await waitFor(() => expect(rows()).toHaveLength(52));
    expect(screen.queryByText("More activity could not be loaded.", { selector: ".error-note-sentence" })).not.toBeInTheDocument();
    expect(screen.getByText("No older activity.")).toBeInTheDocument();
  });

  it("a 400 on a continuation: «Start again from the newest» in its place, focused; it reads the first page alone, the heading takes focus", async () => {
    state.answer = (params) => (params.cursor === undefined ? page(long(0, 50), "c-1") : refusal(400, "VALIDATION_FAILED"));
    renderActivity();
    fireEvent.click(await screen.findByRole("button", { name: "Show more activity" }));
    const again = await screen.findByRole("button", { name: "Start again from the newest" });
    expect(await note("Taska couldn’t continue the list from here.")).toBeInTheDocument();
    await waitFor(() => expect(again).toHaveFocus());
    expect(status()).toHaveTextContent("Taska couldn’t continue the list from here.");
    expect(screen.queryByRole("button", { name: "Show more activity" })).not.toBeInTheDocument();
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(again);
    // The rows give way to the skeleton at once.
    await waitFor(() => expect(list()).toHaveAttribute("aria-busy", "true"));
    expect(list().querySelectorAll(".value-skeleton")).toHaveLength(6);
    await act(async () => release());
    await waitFor(() => expect(rows()).toHaveLength(50));
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(state.calls.at(-1)).toEqual({ limit: 50 });
  });

  it("a 403 on a continuation drops the rows, the filter row and the foot; focus to the heading", async () => {
    state.answer = (params) => (params.cursor === undefined ? page(long(0, 50), "c-1") : refusal(403, "SCOPE_DENIED"));
    renderActivity();
    const more = await screen.findByRole("button", { name: "Show more activity" });
    more.focus();
    fireEvent.click(more);
    expect(await notice("Only the admins and the owner of Northwind can see its activity.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more|Filter/ })).not.toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(status()).toHaveTextContent("Only the admins and the owner of Northwind can see its activity.");
  });

  it("a reconnect or a return to the tab re-reads a failed first page and nothing else: «Show more» pages stay", async () => {
    renderActivity();
    fireEvent.click(await screen.findByRole("button", { name: "Show more activity" }));
    await waitFor(() => expect(rows()).toHaveLength(100));
    expect(state.calls).toHaveLength(2);
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(state.calls).toHaveLength(2);
    expect(rows()).toHaveLength(100);
  });

  it("a failed continuation and a reconnect: no read, its note stays", async () => {
    state.answer = (params) => (params.cursor === undefined ? page(long(0, 50), "c-1") : refusal(409, "INVALID_STATE"));
    renderActivity();
    fireEvent.click(await screen.findByRole("button", { name: "Show more activity" }));
    expect(await note("More activity could not be loaded.")).toBeInTheDocument();
    expect(state.calls).toHaveLength(2);
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await act(async () => {});
    expect(state.calls).toHaveLength(2);
    expect(screen.getByText("More activity could not be loaded.", { selector: ".error-note-sentence" })).toBeInTheDocument();
    expect(rows()).toHaveLength(50);
  });

  it("a failed first page and a reconnect: one read", async () => {
    state.answer = () => refusal(409, "INVALID_STATE");
    renderActivity();
    await screen.findByRole("button", { name: "Try again" });
    expect(state.calls).toHaveLength(1);
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(state.calls).toHaveLength(2));
  });

  describe("a failed continuation brings «Show more» back into view", () => {
    const scrolled = vi.fn();
    beforeEach(() => {
      scrolled.mockClear();
      Element.prototype.scrollIntoView = scrolled;
    });

    it.each([
      [503, "UNAVAILABLE"],
      [429, "RATE_LIMITED"],
    ])("a %i: scrollIntoView on the button, no animation", async (status, code) => {
      state.answer = (params) => (params.cursor === undefined ? page(long(0, 50), "c-1") : refusal(status, code));
      renderActivity();
      const more = await screen.findByRole("button", { name: "Show more activity" });
      fireEvent.click(more);
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
      expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole("button", { name: "Show more activity" }));
    });

    it("a 400 is unchanged: «Start again» takes focus, nothing scrolled", async () => {
      state.answer = (params) => (params.cursor === undefined ? page(long(0, 50), "c-1") : refusal(400, "VALIDATION_FAILED"));
      renderActivity();
      fireEvent.click(await screen.findByRole("button", { name: "Show more activity" }));
      await screen.findByRole("button", { name: "Start again from the newest" });
      expect(scrolled).not.toHaveBeenCalled();
    });
  });

  it("with filters the end reads «No older activity matches these filters.»", async () => {
    state.answer = () => page([record("r-1")]);
    renderActivity(`/company/activity?kind=TENANT_PAUSED`);
    expect(await screen.findByText("No older activity matches these filters.")).toBeInTheDocument();
  });
});

describe("the author filter (§4.41 «Фильтр по автору»)", () => {
  it("a row's link writes the address with replace, the chip «By {Name}» takes focus, its × is next and named", async () => {
    renderActivity("/company/activity?kind=INVITATION_CREATED");
    await waitFor(() => expect(rows()).toHaveLength(5));
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(within(rows()[1]).getByRole("link", { name: "Anna Ivanova" }));
    await waitFor(() => expect(whereabouts()).toBe(`/company/activity?actorUserId=${ANNA}&kind=INVITATION_CREATED`));
    // Named from the row it was followed from while the filtered page is out — the skeleton under it.
    const chip = await screen.findByText("By Anna Ivanova");
    await waitFor(() => expect(chip).toHaveFocus());
    expect(list().querySelectorAll(".value-skeleton")).toHaveLength(6);
    await act(async () => release());
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(chip).toHaveFocus();
    expect(chip.tagName).toBe("SPAN");
    expect(screen.getByRole("button", { name: "Remove filter By Anna Ivanova" })).toBeInTheDocument();
    // The kind stays, and the first page is read with both.
    await waitFor(() => expect(state.calls.at(-1)).toEqual({ limit: 50, actorUserId: ANNA, kinds: ["INVITATION_CREATED"] }));
    // No link to the filter already set.
    await waitFor(() => expect(within(list()).queryByRole("link", { name: "Anna Ivanova" })).not.toBeInTheDocument());
  });

  it("an id with no loaded record names the chip by its short id, in mono", async () => {
    state.answer = () => page([]);
    renderActivity(`/company/activity?actorUserId=${TOM}`);
    const id = await screen.findByText(TOM.slice(0, 8), { selector: ".company-activity-chip-id" });
    expect(id.closest(".company-activity-chip-label")).toHaveTextContent(`By ${TOM.slice(0, 8)}`);
    expect(screen.getByRole("button", { name: `Remove filter By ${TOM.slice(0, 8)}` })).toBeInTheDocument();
  });

  it("an author id that is not a UUID is never sent and leaves the address", async () => {
    renderActivity("/company/activity?actorUserId=anna&kind=MEMBER_LEFT");
    await waitFor(() => expect(whereabouts()).toBe("/company/activity?kind=MEMBER_LEFT"));
    expect(state.calls.every((call) => call.actorUserId === undefined)).toBe(true);
  });

  it("× on the author chip: the address loses it, «+ Filter» takes focus", async () => {
    renderActivity(`/company/activity?actorUserId=${ANNA}`);
    fireEvent.click(await screen.findByRole("button", { name: "Remove filter By Anna Ivanova" }));
    await waitFor(() => expect(whereabouts()).toBe("/company/activity"));
    await waitFor(() => expect(addFilter()).toHaveFocus());
  });
});

describe("the kind filter (§4.41 «Фильтр по виду»)", () => {
  it("«+ Filter» opens «Filter activity» on its first option: one labelled select in three groups, and Apply", async () => {
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(addFilter());
    const dialog = screen.getByRole("dialog", { name: "Filter activity" });
    const select = within(dialog).getByRole("combobox", { name: "Action" });
    expect(select).toHaveValue("TENANT_CREATED");
    expect([...select.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Company", "Invitations", "Members"]);
    expect(select.querySelectorAll("option")).toHaveLength(16);
    expect(within(dialog).queryByRole("combobox", { name: "Filter" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("Apply: the address gets the kind, the chip «Action is …» takes focus on its open half; the first page is read with it", async () => {
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(addFilter());
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "INVITATION_CREATED" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(whereabouts()).toBe("/company/activity?kind=INVITATION_CREATED"));
    const open = await screen.findByRole("button", { name: "Action is Invitation sent" });
    await waitFor(() => expect(open).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();
    await waitFor(() => expect(state.calls.at(-1)).toEqual({ limit: 50, kinds: ["INVITATION_CREATED"] }));
    // Ended with rows: silent.
    expect(status()).toBeEmptyDOMElement();
  });

  it("Esc returns focus to the control that opened it", async () => {
    renderActivity("/company/activity?kind=ROLE_CHANGED");
    const open = await screen.findByRole("button", { name: "Action is Role changed" });
    fireEvent.click(open);
    expect(screen.getByRole("combobox", { name: "Action" })).toHaveValue("ROLE_CHANGED");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("an address with several kinds is sent as it stands and drawn as one chip; × removes them all", async () => {
    renderActivity("/company/activity?kind=MEMBER_LEFT&kind=TENANT_PAUSED&kind=TENANT_EXPORTED");
    expect(await screen.findByRole("button", { name: "Action is Company paused or Member left or TENANT_EXPORTED" })).toBeInTheDocument();
    expect(state.calls[0]).toEqual({ limit: 50, kinds: ["MEMBER_LEFT", "TENANT_PAUSED", "TENANT_EXPORTED"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Action is Company paused or Member left or TENANT_EXPORTED" }));
    await waitFor(() => expect(whereabouts()).toBe("/company/activity"));
    await waitFor(() => expect(addFilter()).toHaveFocus());
  });

  it("a change of filter ending empty says the empty phrase; ending refused, the refusal; and drops the pages «Show more» added", async () => {
    state.answer = (params) => {
      if (params.kinds?.includes("MEMBER_LEFT")) return page([]);
      if (params.kinds?.includes("ROLE_CHANGED")) return refusal(409, "INVALID_STATE");
      return params.cursor === undefined ? page([record("r-1")], "c-1") : page([record("r-2")]);
    };
    renderActivity();
    fireEvent.click(await screen.findByRole("button", { name: "Show more activity" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(addFilter());
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "MEMBER_LEFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(status()).toHaveTextContent("No activity matches these filters."));
    expect(screen.getByText("No activity matches these filters.", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Action is Member left" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "ROLE_CHANGED" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(status()).toHaveTextContent("Activity could not be loaded."));

    fireEvent.click(screen.getByRole("button", { name: "Remove filter Action is Role changed" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    // The first page alone each time: the continuation was never re-read.
    expect(state.calls.filter((call) => call.cursor !== undefined)).toHaveLength(1);
  });

  it("a change of filter refused 403: the heading takes focus", async () => {
    state.answer = (params) => (params.kinds ? refusal(403, "SCOPE_DENIED") : page(NORTHWIND_LOG));
    renderActivity();
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(addFilter());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await notice("Only the admins and the owner of Northwind can see its activity.")).toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(status()).toHaveTextContent("Only the admins and the owner of Northwind can see its activity.");
  });
});
