import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { IssueWorklog, IssueWorklogPage } from "../domain/types";
import { IssueWorklogSection } from "./IssueWorklogSection";

/**
 * What the section does with answers the mock never gives: a write the server
 * refuses (the optimistic row has to go back), and the gateway's
 * static-resource 404 of a gateway that does not serve the route.
 */
const PROJECT = "p-1";
const ISSUE = "i-1";
const ANNA = "u-anna";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    worklogs: [] as IssueWorklog[],
    /** What the server states beside the entries, when a test needs other than the truth. */
    totalCount: undefined as number | null | undefined,
    hasMore: undefined as boolean | null | undefined,
    listFailure: null as Error | null,
    /** A failure for every page past the first. */
    nextPageFailure: null as Error | null,
    /** The page reads, in order. */
    pageReads: [] as { page?: number; pageSize?: number }[],
    writeFailure: null as Error | null,
    updates: [] as unknown[],
    /** What a write answers with, author left out unless a test says otherwise. */
    updateAnswer: null as IssueWorklog | null,
    /** Every read after the first never answers: what is drawn is what the section put in the cache. */
    rereadsHeld: false,
  };
  const api = {
    // `GET /meta` (TAS-173), answered with no dictionaries: every reader then
    // uses the build's own words and sets, which is what these tests are about.
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    // The server's paging (backend TAS-421): `state.worklogs` in its order, a
    // page at a time, with the count and `hasMore` it states.
    listIssueWorklogs: async (_p: string, _i: string, params: { page?: number; pageSize?: number } = {}) => {
      state.pageReads.push(params);
      if (state.rereadsHeld && state.pageReads.length > 1) return new Promise<IssueWorklogPage>(() => {});
      if (state.listFailure) throw state.listFailure;
      const page = params.page ?? 0;
      const pageSize = params.pageSize ?? 20;
      if (page > 0 && state.nextPageFailure) throw state.nextPageFailure;
      const items = state.worklogs.slice(page * pageSize, page * pageSize + pageSize);
      return {
        items,
        page,
        pageSize,
        totalCount: state.totalCount === undefined ? state.worklogs.length : state.totalCount,
        hasMore: state.hasMore === undefined ? page * pageSize + items.length < state.worklogs.length : state.hasMore,
      } satisfies IssueWorklogPage;
    },
    addIssueWorklog: async () => {
      if (state.writeFailure) throw state.writeFailure;
      throw new Error("not used");
    },
    updateIssueWorklog: async (_p: string, _i: string, _w: string, input: unknown) => {
      state.updates.push(input);
      if (state.writeFailure) throw state.writeFailure;
      if (state.updateAnswer) return state.updateAnswer;
      throw new Error("not used");
    },
    deleteIssueWorklog: async () => {
      if (state.writeFailure) throw state.writeFailure;
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const entry: IssueWorklog = {
  id: "w-1",
  issueId: ISSUE,
  projectId: PROJECT,
  authorUserId: ANNA,
  spentMinutes: 45,
  workDate: "2026-06-13",
  comment: "Pairing",
  createdAt: "2026-06-13T09:00:00Z",
  updatedAt: "2026-06-13T09:00:00Z",
};

const refusal = (message: string, status: number, code: string) =>
  Object.assign(new Error(message), { status, code, requestId: "req-251" });

function renderSection(props: Partial<{ canLog: boolean; isProjectAdmin: boolean }> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IssueWorklogSection
        canLog={props.canLog ?? true}
        currentUserId={ANNA}
        isProjectAdmin={props.isProjectAdmin ?? true}
        issueId={ISSUE}
        prefetched={false}
        projectId={PROJECT}
        userById={new Map([[ANNA, { id: ANNA, displayName: "Anna Ivanova" }]])}
        writeScope={`issue-write:${ISSUE}`}
      />
    </QueryClientProvider>,
  );
}

describe("the work log section", () => {
  beforeEach(() => {
    state.worklogs = [entry];
    state.totalCount = undefined;
    state.hasMore = undefined;
    state.listFailure = null;
    state.nextPageFailure = null;
    state.pageReads = [];
    state.writeFailure = null;
    state.updates = [];
    state.updateAnswer = null;
    state.rereadsHeld = false;
  });

  it("says the gateway does not serve work logs yet, and offers no form, on the static-resource 404", async () => {
    state.listFailure = refusal("No static resource api/v1/projects/p-1/issues/i-1/worklogs.", 404, "NOT_FOUND");
    renderSection();

    expect(await screen.findByText("This gateway does not serve work logs yet.")).toBeVisible();
    expect(screen.queryByText("No work logged yet")).toBeNull();
    expect(screen.queryByText("The work log could not be loaded.")).toBeNull();
    expect(screen.queryByRole("form", { name: "Log work" })).toBeNull();
  });

  it("says a failed read in the panel's one error box, with the server's words and the request id", async () => {
    // A refusal, so the read is not asked twice (`issueWorklogsOptions`).
    state.listFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();

    // `ErrorNote` since TAS-192 — the box every write refusal in the panel
    // uses — rather than the screen-level banner, so the panel has one look.
    const sentence = await screen.findByText("The work log could not be loaded. Not allowed role");
    expect(sentence.closest(".error-note")).not.toBeNull();
    expect(document.querySelector(".api-notice")).toBeNull();
    expect(screen.getByText("req-251")).toBeVisible();
    // State on opening, not an answer to an action: no live region, as the
    // comments' read failure has none.
    expect(sentence.closest("[role='status'], [role='alert'], [aria-live]")).toBeNull();
  });

  it("closes a Delete question on Esc from the Delete that asked, and gives it focus", async () => {
    renderSection();
    const remove = await screen.findByRole("button", { name: /^Delete 45m logged/ });
    fireEvent.click(remove);
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeVisible();

    // Shift+Tab from Cancel lands on the Delete that opened the strip; Esc there
    // has to close it as it does from inside the strip.
    remove.focus();
    fireEvent.keyDown(remove, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Delete entry" })).toBeNull();
    expect(remove).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(remove).toHaveFocus());

    // And from inside it, as before.
    fireEvent.click(remove);
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Delete entry" })).toBeNull();
    await waitFor(() => expect(remove).toHaveFocus());
  });

  it("takes a refused add back off the list and puts the entry back in the boxes", async () => {
    state.writeFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();
    await screen.findByText("Pairing");

    const form = screen.getByRole("form", { name: "Log work" });
    fireEvent.change(within(form).getByLabelText("Time spent"), { target: { value: "2h" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log work" }));

    expect(await screen.findByText("Your work log entry was not saved. Not allowed role")).toBeVisible();
    await waitFor(() => expect(document.querySelectorAll(".worklog-row")).toHaveLength(1));
    expect(within(form).getByLabelText("Time spent")).toHaveValue("2h");
    expect(screen.getByText("req-251")).toBeVisible();
  });

  it("marks Log work aria-disabled while the duration is empty", async () => {
    renderSection();
    await screen.findByText("Pairing");
    const form = screen.getByRole("form", { name: "Log work" });
    const button = within(form).getByRole("button", { name: "Log work" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(within(form).getByLabelText("Time spent"), { target: { value: "2h" } });
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("puts a refused delete back", async () => {
    state.writeFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete 45m logged/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));

    expect(await screen.findByText("The work log entry was not deleted. Not allowed role")).toBeVisible();
    expect(screen.getByText("Pairing")).toBeVisible();
  });

  it("sends nothing for an edit that changed nothing", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit 45m logged/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(state.updates).toEqual([]);
  });

  it("puts a refused edit back and reopens the editor with what was typed", async () => {
    state.writeFailure = refusal("Worklog with id: w-1 not found", 404, "NOT_FOUND");
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit 45m logged/ }));
    const editor = screen.getByRole("form", { name: /^Edit 45m logged/ });
    fireEvent.change(within(editor).getByLabelText("Time spent"), { target: { value: "1h" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Your change to the work log entry was not saved/)).toBeVisible();
    expect(state.updates).toEqual([{ spentMinutes: 60 }]);
    expect(screen.getByText("45m logged")).toBeVisible();
    expect(within(screen.getByRole("form", { name: /^Edit 45m logged/ })).getByLabelText("Time spent")).toHaveValue("1h");
  });

  it("offers a VIEWER no form and no row actions", async () => {
    renderSection({ canLog: false, isProjectAdmin: false });
    await screen.findByText("Pairing");
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /** `count` entries, newest first, one a day back from Jun 30, by Anna. */
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => {
      const day = new Date(Date.UTC(2026, 5, 30 - index)).toISOString().slice(0, 10);
      return { ...entry, id: `w-${String(index).padStart(3, "0")}`, workDate: day, comment: `Entry ${index}`, spentMinutes: 30 };
    });
  const heading = () => screen.getByRole("heading", { name: /^Work log/ });

  // Backend TAS-421: the list is paged at 100, the pill is the server's count,
  // and no sum is drawn until every entry is read (DESIGN.md §4.24).
  it("reads 100 a page, counts by the server, and holds the sum back until every entry is read", async () => {
    state.worklogs = many(105);
    renderSection();

    await waitFor(() => expect(document.querySelectorAll(".worklog-row")).toHaveLength(100));
    expect(state.pageReads).toEqual([{ page: 0, pageSize: 100 }]);
    expect(heading().querySelector(".count-pill")).toHaveTextContent("105");
    expect(document.querySelector(".worklog-total")).toBeNull();
    const foot = document.querySelector(".list-more") as HTMLElement;
    expect(foot.tagName).toBe("LI");
    expect(foot).toBe(document.querySelector(".worklog-list")?.lastElementChild);
    expect(within(foot).getByText("100 of 105 shown")).toBeVisible();
    const more = within(foot).getByRole("button", { name: "Show more work log entries" });
    expect(more).toHaveTextContent("Show more");
    expect(more).toHaveAccessibleDescription("100 of 105 shown");
  });

  it("appends the next page on Show more, focuses its first row, and then draws the sum and no foot", async () => {
    state.worklogs = many(105);
    renderSection();
    const more = await screen.findByRole("button", { name: "Show more work log entries" });
    more.focus();
    fireEvent.click(more);

    await waitFor(() => expect(document.querySelectorAll(".worklog-row")).toHaveLength(105));
    expect(state.pageReads).toEqual([{ page: 0, pageSize: 100 }, { page: 1, pageSize: 100 }]);
    const first = screen.getByText("Entry 100").closest("li") as HTMLElement;
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(document.querySelector(".list-more")).toBeNull();
    expect(document.querySelector(".worklog-total")).toHaveTextContent("52h 30m logged");
    expect(heading().querySelector(".count-pill")).toHaveTextContent("105");
  });

  it("says a failed Show more in the notice slot with the request id, keeps the rows, and keeps focus on the button", async () => {
    state.worklogs = many(105);
    // A refusal, so the page is not asked twice (`issueWorklogsOptions`).
    state.nextPageFailure = refusal("Not allowed role", 403, "PERMISSION_DENIED");
    renderSection();
    const more = await screen.findByRole("button", { name: "Show more work log entries" });
    more.focus();
    fireEvent.click(more);

    expect(await screen.findByText("More work log entries could not be loaded. Not allowed role")).toBeVisible();
    expect(screen.getByText("req-251")).toBeVisible();
    expect(document.querySelectorAll(".worklog-row")).toHaveLength(100);
    expect(screen.queryByText(/The work log could not be loaded/)).toBeNull();
    expect(more).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show more work log entries" })).toBeVisible();
  });

  it("names an unstated count Unknown, draws no sum, and never reads an unstated hasMore as complete", async () => {
    state.totalCount = null;
    state.hasMore = null;
    renderSection();

    await screen.findByText("Pairing");
    expect(heading().querySelector(".count-pill")).toHaveTextContent("unknown");
    expect(document.querySelector(".worklog-total")).toBeNull();
    expect(document.querySelector(".list-more")).toBeNull();
  });

  // Backend TAS-421: each row names its author — a former member by the
  // summary, then the member list, then Unknown (DESIGN.md §4.24).
  it("names the author from the row's summary, then the member list, then Unknown", async () => {
    state.worklogs = [
      { ...entry, id: "w-a", authorUserId: "u-former", author: { id: "u-former", displayName: "Former Member", avatarUrl: null }, comment: "By a former member" },
      { ...entry, id: "w-b", author: null, comment: "By a member" },
      { ...entry, id: "w-c", authorUserId: "u-gone", author: null, comment: "By nobody named" },
    ];
    renderSection({ isProjectAdmin: false });

    const row = async (text: string) => (await screen.findByText(text)).closest("li") as HTMLElement;
    expect((await row("By a former member")).querySelector(".worklog-head strong")).toHaveTextContent("Former Member");
    expect((await row("By a member")).querySelector(".worklog-head strong")).toHaveTextContent("Anna Ivanova");
    const gone = await row("By nobody named");
    expect(gone.querySelector(".worklog-head strong")).toHaveTextContent("Unknown");
    expect(gone.querySelector(".avatar")).toHaveAttribute("aria-label", "Unknown");
  });

  it("keeps a row's author when the edit's answer leaves it out", async () => {
    state.worklogs = [{ ...entry, authorUserId: "u-former", author: { id: "u-former", displayName: "Former Member", avatarUrl: null } }];
    state.updateAnswer = { ...entry, authorUserId: "u-former", spentMinutes: 60 };
    // The re-read never answers, so the row drawn is the answer laid over it.
    state.rereadsHeld = true;
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit 45m logged/ }));
    const editor = screen.getByRole("form", { name: /^Edit 45m logged/ });
    fireEvent.change(within(editor).getByLabelText("Time spent"), { target: { value: "1h" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(state.updates).toEqual([{ spentMinutes: 60 }]));
    await waitFor(() => expect(document.querySelector(".worklog-duration")).toHaveTextContent("1h"));
    expect(document.querySelector(".worklog-head strong")).toHaveTextContent("Former Member");
  });
});
