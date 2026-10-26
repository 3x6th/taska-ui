import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessToken, AccessTokenList, AccessTokenPolicy, IssuedAccessToken } from "../../domain/types";
import { SettingsTokensSection } from "./SettingsTokensSection";

/**
 * Settings → Access tokens (TAS-412): the list's states, creating a token and
 * the one showing of its value, revoking one, and the snippets. The acceptance
 * this file carries is the secret's: after the dialog closes it is in no query
 * or mutation cache, no browser storage, no address, no log and no node.
 */
const { api } = vi.hoisted(() => ({
  api: {
    getCurrentUser: vi.fn(),
    listAccessTokens: vi.fn(),
    createAccessToken: vi.fn(),
    revokeAccessToken: vi.fn(),
  },
}));
vi.mock("../../api/client", () => ({ taskaApi: api }));

const SECRET = "tsk_pat_Zq8RkW2mNcY4pLx7Hs1Jd9Vt6Bf3Ga0Ek-u_Pw4";
/** What the row of a token whose create outlived its dialog says (§5.9). */
const UNSEEN_LINE = "Its value was never shown. Revoke this token and create another.";
const MCP_URL = "http://localhost:8087/mcp";
const DAY = 24 * 60 * 60 * 1000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

/** In the server's order: `createdAt`, then `id`, newest first (backend TAS-402). */
const seeded = (): AccessToken[] => [
  {
    id: "token-newer",
    name: "Claude Code on laptop",
    tokenPrefix: "tsk_pat_3fA9",
    scopes: ["read", "write"],
    createdAt: iso(-2 * DAY),
    expiresAt: iso(28 * DAY),
    lastUsedAt: iso(-1 * DAY),
  },
  {
    id: "token-older",
    name: "Weekly report script",
    tokenPrefix: "tsk_pat_Qm7x",
    scopes: ["read"],
    createdAt: iso(-10 * DAY),
    expiresAt: iso(20 * DAY),
    lastUsedAt: null,
  },
];
const weekly = () => seeded()[1];

/** The server's list, as this fixture's server holds it — newest first. */
let tokens: AccessToken[];
/** The policy the list states (backend TAS-402's defaults unless a test says otherwise). */
let policy: AccessTokenPolicy | null;
let client: QueryClient;

const refusal = (message: string, fields: object) => Object.assign(new Error(message), fields);

const draw = () =>
  render(
    <QueryClientProvider client={client}>
      <SettingsTokensSection />
    </QueryClientProvider>,
  );
const rows = () => screen.queryAllByRole("listitem");
const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
/** Every query's and mutation's state, as one string to search for the secret. */
const cached = () =>
  JSON.stringify([
    client.getQueryCache().getAll().map((query) => query.state),
    client.getMutationCache().getAll().map((mutation) => mutation.state),
  ]);
/** From now on every read of the list hangs: what is drawn can only be what the section itself put there. */
const hangReads = () => api.listAccessTokens.mockImplementation(() => new Promise<AccessTokenList>(() => {}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_TASKA_MCP_URL", MCP_URL);
  window.localStorage.clear();
  window.sessionStorage.clear();
  tokens = seeded();
  policy = { maxLifetimeDays: 90, maxActiveTokens: 10 };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.getCurrentUser.mockResolvedValue({
    id: "user-anna",
    email: "anna@example.com",
    displayName: "Anna Ivanova",
    status: "ACTIVE",
    avatarUrl: null,
  });
  api.listAccessTokens.mockImplementation(
    async (): Promise<AccessTokenList> => ({ tokens: tokens.map((token) => ({ ...token })), policy }),
  );
  api.createAccessToken.mockImplementation(async (input: { name: string; scopes: string[]; expiresInDays?: number }) => {
    const token: AccessToken = {
      id: "token-new",
      name: input.name,
      tokenPrefix: SECRET.slice(0, 12),
      scopes: input.scopes,
      createdAt: new Date().toISOString(),
      expiresAt: iso((input.expiresInDays ?? 30) * DAY),
      lastUsedAt: null,
    };
    tokens = [token, ...tokens];
    return { token, secret: SECRET } satisfies IssuedAccessToken;
  });
  api.revokeAccessToken.mockImplementation(async (id: string) => {
    tokens = tokens.filter((token) => token.id !== id);
  });
});

afterEach(() => {
  client.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the list of access tokens", () => {
  it("draws skeleton rows while it is read, then each token with its prefix, access and dates", async () => {
    let answer: (value: AccessTokenList) => void = () => {};
    api.listAccessTokens.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    draw();

    expect(await screen.findByText("Loading access tokens")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
    expect(document.querySelectorAll(".token-skeleton-row")).toHaveLength(2);

    await act(async () => answer({ tokens: seeded(), policy }));

    expect(await screen.findByRole("button", { name: "Create token" })).toBeVisible();
    const list = screen.getByRole("list", { name: "Your access tokens" });
    expect(within(list).getAllByRole("listitem").map((row) => row.querySelector(".token-name")?.textContent)).toEqual([
      "Claude Code on laptop",
      "Weekly report script",
    ]);
    const newer = rowOf("Claude Code on laptop");
    expect(newer.querySelector(".token-meta")).toHaveTextContent("Starts with tsk_pat_3fA9… · Read and write");
    expect(newer.querySelector(".token-dates")?.textContent).toMatch(/^Created \w{3} \d+ · Expires \w{3} \d+(, \d{4})? · Last used \w{3} \d+$/);
    expect(rowOf("Weekly report script").querySelector(".token-meta")).toHaveTextContent("tsk_pat_Qm7x… · Read");
    expect(rowOf("Weekly report script").querySelector(".token-dates")).toHaveTextContent(/Never used$/);
    expect(document.querySelectorAll(".token-skeleton-row")).toHaveLength(0);
  });

  // Backend TAS-402 orders the list itself; the section draws it as it came.
  it("draws the tokens in the server's order, never re-sorted", async () => {
    tokens = [...seeded()].reverse();
    draw();
    await screen.findByText("Claude Code on laptop");
    expect(rows().map((row) => row.querySelector(".token-name")?.textContent)).toEqual([
      "Weekly report script",
      "Claude Code on laptop",
    ]);
  });

  it("says a past lifetime as Expired", async () => {
    tokens = [{ ...weekly(), expiresAt: iso(-DAY) }];
    draw();
    expect((await screen.findByText("Weekly report script")).closest("li")?.querySelector(".token-dates")).toHaveTextContent(
      / · Expired \w{3} \d+/,
    );
  });

  it("says when there are none, and offers Create token", async () => {
    tokens = [];
    draw();
    expect(await screen.findByText("No tokens yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create token" })).toBeVisible();
  });

  it("says a failed read with the server's words and tries again on request", async () => {
    // Every read fails until the reader asks again: the list keeps the app's
    // one retry for an ordinary failure, so a single refusal would heal alone.
    api.listAccessTokens.mockRejectedValue(refusal("Service unavailable", { status: 503, requestId: "req-503" }));
    draw();

    expect(await screen.findByText("Your access tokens could not be loaded.", {}, { timeout: 4000 })).toBeVisible();
    expect(api.listAccessTokens).toHaveBeenCalledTimes(2);
    api.listAccessTokens.mockImplementation(async () => ({ tokens: tokens.map((token) => ({ ...token })), policy }));
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: /req-503/ })).toBeVisible();
    expect(screen.queryByText("No tokens yet.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Claude Code on laptop")).toBeVisible();
  });

  it("says a gateway without the routes has none to show, and offers nothing to create", async () => {
    api.listAccessTokens.mockRejectedValue(
      refusal("No static resource api/v1/users/me/access-tokens.", { status: 404, code: "NOT_FOUND" }),
    );
    draw();

    expect(
      await screen.findByText("Access tokens are not on this gateway yet, so they cannot be shown here."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
    expect(screen.queryByText("Your access tokens could not be loaded.")).toBeNull();
    expect(api.listAccessTokens).toHaveBeenCalledTimes(1);
  });
});

describe("the connect snippets on the page", () => {
  it("offers Claude Code and Cursor with YOUR_TOKEN in place of a token", async () => {
    draw();
    const group = await screen.findByRole("group", { name: "Agent" });
    const claude = within(group).getByRole("button", { name: "Claude Code" });
    expect(claude).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/claude mcp add --transport http --scope user taska/)).toHaveTextContent(
      `claude mcp add --transport http --scope user taska ${MCP_URL} --header "Authorization: Bearer YOUR_TOKEN"`,
    );
    expect(screen.getByText("Run this in a terminal.")).toBeVisible();

    fireEvent.click(within(group).getByRole("button", { name: "Cursor" }));
    expect(within(group).getByRole("button", { name: "Cursor" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Add this to ~/.cursor/mcp.json.")).toBeVisible();
    expect(JSON.parse(document.querySelector(".mcp-snippet-code")?.textContent ?? "")).toEqual({
      mcpServers: { taska: { url: MCP_URL, headers: { Authorization: "Bearer YOUR_TOKEN" } } },
    });
    expect(screen.getByText("Keep tokens out of project files that are shared or committed.")).toBeVisible();
  });

  it("copies the snippet and says so", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Copy the Claude Code command" }));
    expect(await screen.findByText("Command copied.")).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer YOUR_TOKEN"));
  });

  it("says the MCP server is not available when the build has no address, and shows no snippet", async () => {
    vi.stubEnv("VITE_TASKA_MCP_URL", "");
    draw();
    expect(await screen.findByText("The MCP server is not available yet.")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Agent" })).toBeNull();
    expect(document.querySelector(".mcp-snippet-code")).toBeNull();
  });
});

describe("creating a token", () => {
  const openDialog = async () => {
    // Focused first, as a press focuses a button in the browser: the dialog
    // hands focus back to the control it was opened from.
    const create = await screen.findByRole("button", { name: "Create token" });
    create.focus();
    fireEvent.click(create);
    return within(await screen.findByRole("dialog", { name: "New access token" }));
  };

  it("needs a name, and says so on a press without one", async () => {
    draw();
    const dialog = await openDialog();
    const name = dialog.getByLabelText("Name");
    expect(name).toHaveFocus();
    const submit = dialog.getByRole("button", { name: "Create token" });
    expect(submit).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.click(submit);

    expect(dialog.getByText("Name the token before creating it.")).toBeVisible();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
    expect(api.createAccessToken).not.toHaveBeenCalled();
    expect(name).toHaveAttribute("maxLength", "100");
  });

  it("sends the trimmed name, the access and the lifetime chosen, defaults read and 30 days", async () => {
    draw();
    let dialog = await openDialog();
    expect(dialog.getByRole("radio", { name: "Read" })).toBeChecked();
    expect(dialog.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "  Defaults  " } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));
    await screen.findByRole("dialog", { name: "Token created" });
    expect(api.createAccessToken).toHaveBeenLastCalledWith({ name: "Defaults", scopes: ["read"], expiresInDays: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("radio", { name: "Read and write" }));
    fireEvent.click(dialog.getByRole("button", { name: "90 days" }));
    expect(dialog.getByRole("group", { name: "Expires" })).toHaveAccessibleDescription(/^Expires on \w{3} \d+(, \d{4})?\.$/);
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));
    await screen.findByRole("dialog", { name: "Token created" });
    expect(api.createAccessToken).toHaveBeenLastCalledWith({
      name: "Cursor on laptop",
      scopes: ["read", "write"],
      expiresInDays: 90,
    });
  });

  // Backend TAS-402: the lifetime is 1..`policy.maxLifetimeDays`; "1 year" was
  // a 400 on every click on the stand. The presets up to the maximum, and the
  // maximum itself when it is none of them.
  it.each([
    [90, ["7 days", "30 days", "90 days"], "30 days"],
    [60, ["7 days", "30 days", "60 days"], "30 days"],
    [365, ["7 days", "30 days", "90 days", "365 days"], "30 days"],
    [14, ["7 days", "14 days"], "14 days"],
  ])("offers the lifetimes a policy of %i days allows", async (maxLifetimeDays, offered, chosen) => {
    policy = { maxLifetimeDays, maxActiveTokens: 10 };
    draw();
    const dialog = await openDialog();
    const group = dialog.getByRole("group", { name: "Expires" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(offered);
    expect(within(group).getByRole("button", { name: chosen })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).queryByRole("button", { name: "1 year" })).toBeNull();
  });

  it("offers no lifetime and sends none when the list stated no policy", async () => {
    policy = null;
    draw();
    const dialog = await openDialog();
    expect(dialog.queryByRole("group", { name: "Expires" })).toBeNull();
    expect(dialog.queryByText(/^Expires on/)).toBeNull();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "No policy" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));
    await screen.findByRole("dialog", { name: "Token created" });
    expect(api.createAccessToken).toHaveBeenLastCalledWith({ name: "No policy", scopes: ["read"] });
  });

  it("shows the value once, with Copy and the snippets carrying it, and leaves nothing of it after Done", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    draw();
    const create = await screen.findByRole("button", { name: "Create token" });
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));

    const shown = await screen.findByRole("dialog", { name: "Token created" });
    const title = within(shown).getByRole("heading", { name: "Token created" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(within(shown).getByText("Copy this token now. Taska shows it only once.")).toBeVisible();
    expect(within(shown).getByLabelText("Cursor on laptop")).toHaveValue(SECRET);
    expect(within(shown).getByLabelText("Cursor on laptop")).toHaveAttribute("readonly");
    expect(shown.querySelector(".mcp-snippet-code")).toHaveTextContent(`Bearer ${SECRET}`);

    // Even while it is on screen, nothing but the dialog holds it.
    expect(cached()).not.toContain(SECRET);

    fireEvent.click(within(shown).getByRole("button", { name: "Copy token" }));
    expect(await within(shown).findByText("Token copied.")).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(SECRET);

    fireEvent.click(within(shown).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.outerHTML).not.toContain(SECRET);
    expect(cached()).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    // The 201's token is at the top of the list, by its prefix only, and the
    // list was not read again for it.
    expect(api.listAccessTokens).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Cursor on laptop")).toBeVisible();
    expect(rows()[0].querySelector(".token-name")).toHaveTextContent("Cursor on laptop");
    // Focus is back on the control that opened the dialog.
    await waitFor(() => expect(create).toHaveFocus());
    for (const spy of logs) spy.mockRestore();
  });

  /** Create "Cursor on laptop" and land on its one showing. */
  const createAndShow = async () => {
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));
    return within(await screen.findByRole("dialog", { name: "Token created" }));
  };
  const pressEscape = () => fireEvent.keyDown(window, { key: "Escape" });

  it("keeps the value on Esc until it has been copied (§4.11)", async () => {
    draw();
    const shown = await createAndShow();
    const field = shown.getByLabelText("Cursor on laptop");
    expect(field).toHaveAttribute("data-unsaved-text", "true");

    pressEscape();

    expect(screen.getByRole("dialog", { name: "Token created" })).toBeInTheDocument();
    expect(field).toHaveValue(SECRET);
    expect(field).toHaveAttribute("data-unsaved-text", "true");
  });

  it("closes on Esc, and drops the value, once Copy token has reached the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    const shown = await createAndShow();
    fireEvent.click(shown.getByRole("button", { name: "Copy token" }));
    expect(await shown.findByText("Token copied.")).toBeVisible();
    expect(shown.getByLabelText("Cursor on laptop")).not.toHaveAttribute("data-unsaved-text");

    pressEscape();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.outerHTML).not.toContain(SECRET);
  });

  it("closes on Esc once a snippet carrying the value has reached the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    const shown = await createAndShow();
    fireEvent.click(shown.getByRole("button", { name: "Copy the Claude Code command" }));
    expect(await shown.findByText("Command copied.")).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Bearer ${SECRET}`));
    expect(shown.getByLabelText("Cursor on laptop")).not.toHaveAttribute("data-unsaved-text");

    pressEscape();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.outerHTML).not.toContain(SECRET);
  });

  it("keeps holding Esc when the clipboard refuses either copy", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("Write permission denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    const shown = await createAndShow();
    fireEvent.click(shown.getByRole("button", { name: "Copy token" }));
    expect(await shown.findByText(/Couldn’t copy the token automatically/)).toBeVisible();
    fireEvent.click(shown.getByRole("button", { name: "Copy the Claude Code command" }));
    expect(await shown.findByText(/Couldn’t copy the command automatically/)).toBeVisible();
    expect(writeText).toHaveBeenCalledTimes(2);

    pressEscape();

    expect(screen.getByRole("dialog", { name: "Token created" })).toBeInTheDocument();
    expect(shown.getByLabelText("Cursor on laptop")).toHaveAttribute("data-unsaved-text", "true");
  });

  it.each([
    ["Done", "Done"],
    ["✕", "Close"],
    ["the scrim", "Close modal"],
  ])("closes by %s without a copy, and asks nothing", async (_way, control) => {
    draw();
    await createAndShow();
    fireEvent.click(screen.getByRole("button", { name: control }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.outerHTML).not.toContain(SECRET);
  });

  it("names the value's field as the list names a token whose name came back blank", async () => {
    api.createAccessToken.mockResolvedValueOnce({ token: { ...weekly(), id: "token-new", name: "  " }, secret: SECRET });
    draw();
    const shown = await createAndShow();
    expect(shown.getByRole("textbox", { name: "Unnamed token" })).toHaveValue(SECRET);
  });

  it("says a created token whose value did not come back, by the same stand-in name, never in empty quotes", async () => {
    api.createAccessToken.mockResolvedValueOnce({ token: { ...weekly(), id: "token-new", name: "" }, secret: "" });
    draw();
    const shown = await createAndShow();
    expect(
      shown.getByText("Taska created “Unnamed token” but did not send its value. Revoke it and create another."),
    ).toBeVisible();
    expect(shown.queryByRole("textbox")).toBeNull();
  });

  it.each([
    [
      "the 429 with the server's wait, in minutes",
      refusal("Token issuance rate limit reached; try later", {
        status: 429,
        code: "RESOURCE_EXHAUSTED",
        requestId: "req-1",
        details: { retryAfterSeconds: "3412" },
      }),
      "Too many tokens were created recently. Try again in 57 minutes.",
    ],
    [
      "the 429 without one",
      refusal("Token issuance rate limit reached; try later", { status: 429, code: "RESOURCE_EXHAUSTED", requestId: "req-1" }),
      "Too many tokens were created recently. Try again later.",
    ],
    [
      "the cap on active tokens",
      refusal("Active token limit reached", {
        status: 400,
        code: "FAILED_PRECONDITION",
        requestId: "req-1",
        details: { reason: "ACTIVE_TOKEN_LIMIT", limit: "10" },
      }),
      "You already have 10 active tokens. Revoke one to create another.",
    ],
    [
      "the session-only 403",
      refusal("Session required", {
        status: 403,
        code: "PERMISSION_DENIED",
        requestId: "req-1",
        details: { reason: "SESSION_REQUIRED" },
      }),
      "Tokens can be created only from a signed-in session, not with another token.",
    ],
    ["any other refusal", refusal("Name is already taken", { status: 409, code: "ALREADY_EXISTS", requestId: "req-1" }), "Name is already taken"],
  ])("says %s in the dialog with the request id, and keeps what was typed", async (_case, error, sentence) => {
    api.createAccessToken.mockRejectedValueOnce(error);
    draw();
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(sentence);
    expect(dialog.getByRole("button", { name: /req-1/ })).toBeVisible();
    expect(dialog.getByLabelText("Name")).toHaveValue("Cursor on laptop");
    expect(screen.getByRole("dialog", { name: "New access token" })).toBeInTheDocument();
    // Answered, so Cancel is a way out again.
    expect(dialog.getByRole("button", { name: "Cancel" })).not.toHaveAttribute("aria-disabled");
  });

  it("refuses a second press while the first is out", async () => {
    let answer: (value: IssuedAccessToken) => void = () => {};
    api.createAccessToken.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    draw();
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    const submit = dialog.getByRole("button", { name: "Create token" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("data-busy", "true");
    expect(api.createAccessToken).toHaveBeenCalledTimes(1);
    await act(async () => answer({ token: { ...weekly(), id: "token-new" }, secret: SECRET }));
    expect(await screen.findByRole("dialog", { name: "Token created" })).toBeInTheDocument();
  });

  it("holds Cancel while the create is out, as Esc is held (§4.1, §4.11)", async () => {
    let answer: (value: IssuedAccessToken) => void = () => {};
    api.createAccessToken.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    draw();
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));

    const cancel = dialog.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "New access token" })).toBeInTheDocument();

    await act(async () => answer({ token: { ...weekly(), id: "token-new" }, secret: SECRET }));
    expect(await screen.findByRole("dialog", { name: "Token created" })).toBeInTheDocument();
  });

  it.each([
    ["✕", "Close"],
    ["the scrim", "Close modal"],
  ])(
    "says a token created after %s closed the dialog mid-flight, lists it, and shows its value nowhere",
    async (_way, control) => {
      const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );
      let answer: (value: IssuedAccessToken) => void = () => {};
      api.createAccessToken.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
      draw();
      const create = await screen.findByRole("button", { name: "Create token" });
      const dialog = await openDialog();
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
      fireEvent.click(dialog.getByRole("button", { name: "Create token" }));

      // ✕ and the scrim close while the create is out, by Modal's design.
      fireEvent.click(screen.getByRole("button", { name: control }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(create).toHaveFocus());

      const token: AccessToken = {
        id: "token-new",
        name: "Cursor on laptop",
        tokenPrefix: SECRET.slice(0, 12),
        scopes: ["read"],
        createdAt: new Date().toISOString(),
        expiresAt: iso(30 * DAY),
        lastUsedAt: null,
      };
      tokens = [token, ...tokens];
      const reads = api.listAccessTokens.mock.calls.length;
      await act(async () => answer({ token, secret: SECRET }));

      const sentence =
        "The token “Cursor on laptop” was created, but the dialog closed before its value was shown. Revoke it and create another.";
      expect((await screen.findByText(sentence)).closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      // The row is there, at the top, by its prefix only — the answer's
      // token, with no re-read.
      expect(await screen.findByText("Cursor on laptop")).toBeVisible();
      expect(rows()).toHaveLength(3);
      expect(rows()[0].querySelector(".token-name")).toHaveTextContent("Cursor on laptop");
      expect(api.listAccessTokens.mock.calls.length).toBe(reads);

      // And the row says it in sight, under its own content, and no other row does.
      expect(within(rowOf("Cursor on laptop")).getByText(UNSEEN_LINE)).toHaveClass("token-unseen");
      expect(screen.getAllByText(UNSEEN_LINE)).toHaveLength(1);
      expect(rowOf("Cursor on laptop").querySelector(".token-row-text + .token-revoke + .token-unseen")).not.toBeNull();

      expect(document.documentElement.outerHTML).not.toContain(SECRET);
      expect(cached()).not.toContain(SECRET);
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
      expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);
      expect(window.location.href).not.toContain(SECRET);
      for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
      for (const spy of logs) spy.mockRestore();

      // It leaves with the row.
      fireEvent.click(screen.getByRole("button", { name: "Revoke Cursor on laptop" }));
      fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
      expect(await screen.findByText("The token “Cursor on laptop” was revoked.")).toBeInTheDocument();
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(screen.queryByText(UNSEEN_LINE)).toBeNull();
    },
  );

  /** A create answered after ✕: "Cursor on laptop" is listed, its value never shown. */
  const createUnseen = async () => {
    let answer: (value: IssuedAccessToken) => void = () => {};
    api.createAccessToken.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    draw();
    const dialog = await openDialog();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Cursor on laptop" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create token" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const token: AccessToken = {
      id: "token-new",
      name: "Cursor on laptop",
      tokenPrefix: SECRET.slice(0, 12),
      scopes: ["read"],
      createdAt: new Date().toISOString(),
      expiresAt: iso(30 * DAY),
      lastUsedAt: null,
    };
    tokens = [token, ...tokens];
    await act(async () => answer({ token, secret: SECRET }));
    const line = await screen.findByText(UNSEEN_LINE);
    return within(line.closest("li") as HTMLElement);
  };

  it("keeps the unseen line on a row whose revoke was refused: the token still exists", async () => {
    api.revokeAccessToken.mockRejectedValueOnce(
      refusal("Revocation is unavailable", { status: 503, code: "UNAVAILABLE", requestId: "req-9" }),
    );
    const row = await createUnseen();
    expect(row.getByText("Cursor on laptop")).toBeVisible();
    // The re-read never answers, so only the rollback can bring the row back.
    hangReads();
    fireEvent.click(row.getByRole("button", { name: "Revoke Cursor on laptop" }));
    fireEvent.click(row.getByRole("button", { name: "Revoke token" }));

    const back = (await screen.findAllByText("The token “Cursor on laptop” was not revoked.")).find((node) =>
      node.closest("li"),
    ) as HTMLElement;
    expect(within(back.closest("li") as HTMLElement).getByText(UNSEEN_LINE)).toBeVisible();
  });

  it("forgets the unseen line once a re-read no longer lists the token", async () => {
    await createUnseen();
    // Gone elsewhere: the next read does not list it.
    tokens = tokens.filter((token) => token.id !== "token-new");
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["access-tokens"] });
    });
    await waitFor(() => expect(screen.queryByText("Cursor on laptop")).toBeNull());
    expect(screen.queryByText(UNSEEN_LINE)).toBeNull();

    // And it does not come back if the same id is listed again: the memory went with the row.
    tokens = [{ ...seeded()[0], id: "token-new", name: "Cursor on laptop" }, ...tokens];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["access-tokens"] });
    });
    expect(await screen.findByText("Cursor on laptop")).toBeVisible();
    expect(screen.queryByText(UNSEEN_LINE)).toBeNull();
  });
});

describe("revoking a token", () => {
  it("asks first, and Cancel or Esc closes the question with focus back on Revoke", async () => {
    draw();
    await screen.findByText("Claude Code on laptop");
    const row = within(rowOf("Claude Code on laptop"));
    const revoke = row.getByRole("button", { name: "Revoke Claude Code on laptop" });
    expect(revoke).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(revoke);
    expect(revoke).toHaveAttribute("aria-expanded", "true");
    const cancel = row.getByRole("button", { name: "Cancel" });
    expect(document.getElementById(revoke.getAttribute("aria-controls") ?? "")).toContainElement(cancel);
    expect(cancel).toHaveFocus();
    expect(row.getByRole("button", { name: "Revoke token" })).toHaveAccessibleDescription(
      "The token “Claude Code on laptop” will stop working at once for every agent and script that uses it.",
    );

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(row.queryByRole("button", { name: "Revoke token" })).toBeNull();
    await waitFor(() => expect(revoke).toHaveFocus());

    fireEvent.click(revoke);
    fireEvent.click(row.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(revoke).toHaveFocus());
    expect(api.revokeAccessToken).not.toHaveBeenCalled();
  });

  it("takes the row out at once, puts focus on the row that took its place, and says it was revoked, with no re-read", async () => {
    let answer: () => void = () => {};
    api.revokeAccessToken.mockReturnValueOnce(new Promise<void>((resolve) => (answer = resolve)));
    draw();
    await screen.findByText("Claude Code on laptop");
    const reads = api.listAccessTokens.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Revoke Claude Code on laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));

    // Optimistic: gone before the server answers.
    await waitFor(() => expect(screen.queryByText("Claude Code on laptop")).toBeNull());
    expect(screen.getByRole("button", { name: "Revoke Weekly report script" })).toHaveFocus();
    expect(api.revokeAccessToken).toHaveBeenCalledWith("token-newer");

    await act(async () => answer());
    expect(await screen.findByText("The token “Claude Code on laptop” was revoked.")).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    // A revoke is 204 for any id (backend TAS-401): its success says it all.
    expect(api.listAccessTokens.mock.calls.length).toBe(reads);
  });

  it("gives focus to Create token when the last row goes", async () => {
    tokens = [weekly()];
    draw();
    await screen.findByText("Weekly report script");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Weekly report script" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create token" })).toHaveFocus());
    expect(await screen.findByText("No tokens yet.")).toBeVisible();
  });

  it("brings the row back with a note when the server refuses", async () => {
    api.revokeAccessToken.mockRejectedValueOnce(
      refusal("Revocation is unavailable", { status: 503, code: "UNAVAILABLE", requestId: "req-9" }),
    );
    draw();
    await screen.findByText("Claude Code on laptop");
    // The re-read never answers, so only the rollback can bring the row back.
    hangReads();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Claude Code on laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));

    const note = (await screen.findAllByText("The token “Claude Code on laptop” was not revoked.")).find((node) =>
      node.closest("li"),
    ) as HTMLElement;
    const row = within(note.closest("li") as HTMLElement);
    expect(row.getByText("Claude Code on laptop")).toBeVisible();
    expect(row.getByText("Revocation is unavailable")).toBeVisible();
    expect(row.getByRole("button", { name: /req-9/ })).toBeVisible();
    // Said once in the section's status region, not by the note itself.
    expect(screen.getAllByText("The token “Claude Code on laptop” was not revoked.")).toHaveLength(2);
    expect(rows()).toHaveLength(2);
    // Back where it was, not at the end.
    expect(rows()[0].querySelector(".token-name")).toHaveTextContent("Claude Code on laptop");
  });

  it("says the session-only 403 under the row in plain words", async () => {
    api.revokeAccessToken.mockRejectedValueOnce(
      refusal("Session required", {
        status: 403,
        code: "PERMISSION_DENIED",
        requestId: "req-403",
        details: { reason: "SESSION_REQUIRED" },
      }),
    );
    draw();
    await screen.findByText("Claude Code on laptop");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Claude Code on laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));

    const row = within(
      (await screen.findAllByText("The token “Claude Code on laptop” was not revoked.")).find((node) => node.closest("li"))!
        .closest("li") as HTMLElement,
    );
    expect(row.getByText("Tokens can be revoked only from a signed-in session, not with another token.")).toBeVisible();
    expect(row.getByRole("button", { name: /req-403/ })).toBeVisible();
  });
});
