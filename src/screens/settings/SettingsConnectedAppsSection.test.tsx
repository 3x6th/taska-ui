import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsConnectedAppsSection } from "./SettingsConnectedAppsSection";

const { api } = vi.hoisted(() => ({ api: { getCurrentUser: vi.fn(), listConnectedApps: vi.fn(), revokeConnectedApp: vi.fn() } }));
vi.mock("../../api/client", () => ({ taskaApi: api }));
const app = { appId: "client-1", name: "Claude", host: "claude.ai", metadataUrl: null, scopes: ["read", "future_scope"], connectedAt: "2026-10-20T10:00:00Z", lastUsedAt: "2026-10-28T12:40:00Z", expiresAt: "2026-11-27T10:00:00Z" };
const MCP_URL = "https://mcp.taska.example/mcp";
const CLAUDE_HELP = "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp";
const CHATGPT_HELP = "https://developers.openai.com/plugins/deploy/connect-chatgpt";
const CURSOR_HELP = "https://cursor.com/docs/mcp";
/** Cursor's OAuth entry: the address alone, pretty-printed as Access tokens prints its Cursor snippet. */
const CURSOR_CONFIG = `{
  "mcpServers": {
    "taska": {
      "url": "${MCP_URL}"
    }
  }
}`;
const LEAD = "Applications connected to Taska can act with the access you gave them.";
/** The app's row, not the guide's "Claude" button below the list. */
const ROW_NAME = { selector: ".token-name" };
/** The guide's link to Access tokens is a router link, so the section needs a router round it. */
const routed = (node: ReactNode) => <MemoryRouter initialEntries={["/settings/connected-apps"]}>{node}</MemoryRouter>;
const draw = () => render(routed(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><SettingsConnectedAppsSection /></QueryClientProvider>));
const guide = () => screen.queryByRole("region", { name: "Connect an AI app" });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("VITE_TASKA_MCP_URL", MCP_URL); api.getCurrentUser.mockResolvedValue({ id: "user-1" }); api.listConnectedApps.mockResolvedValue({ available: true, items: [app] }); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Connected apps", () => {
  it("shows server values and an unknown scope; cancels and confirms revoke", async () => {
    api.revokeConnectedApp.mockResolvedValue(undefined);
    draw();
    expect(await screen.findByText("claude.ai")).toBeVisible();
    expect(screen.getByText("Access: read, future_scope")).toBeVisible();
    expect(screen.getByText(/Token last issued/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.revokeConnectedApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await waitFor(() => expect(api.revokeConnectedApp).toHaveBeenCalledWith("client-1"));
    expect(await screen.findByText("No apps are connected yet.")).toBeVisible();
    // The last row gone, focus falls back on the lead — not into the guide below.
    expect(screen.getByText(LEAD)).toHaveFocus();
    expect(guide()).toBeVisible();
  });
  it("distinguishes disabled from empty and a 503", async () => {
    api.listConnectedApps.mockResolvedValue({ available: false, items: [] });
    const { unmount } = draw();
    expect(await screen.findByText(/OAuth is turned off/)).toBeVisible();
    unmount();
    api.listConnectedApps.mockRejectedValue(Object.assign(new Error("Unavailable"), { status: 503, requestId: "req-1" }));
    draw();
    expect(await screen.findByText("Connected apps could not be loaded.")).toBeVisible();
    expect(screen.queryByText("No apps are connected yet.")).toBeNull();
  });
  it("optimistically removes and restores a failed revoke", async () => {
    let reject!: (reason: Error) => void;
    api.revokeConnectedApp.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    draw();
    await screen.findByText("Claude", ROW_NAME);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    expect(await screen.findByText("No apps are connected yet.")).toBeVisible();
    reject(Object.assign(new Error("Service unavailable"), { status: 503, requestId: "req-503" }));
    expect(await screen.findByText("Claude", ROW_NAME)).toBeVisible();
    expect(await screen.findByText(/could not confirm that Claude was disconnected/)).toBeVisible();
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByText("req-503")).toBeVisible();
  });
  it("discards a late pre-revoke GET after a successful DELETE, including across remount", async () => {
    let finishDelete!: () => void;
    let finishRead!: (value: { available: boolean; items: typeof app[] }) => void;
    api.revokeConnectedApp.mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const element = routed(<QueryClientProvider client={client}><SettingsConnectedAppsSection /></QueryClientProvider>);
    const first = render(element);
    await screen.findByText("Claude", ROW_NAME);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await screen.findByText("No apps are connected yet.");
    first.unmount();
    api.listConnectedApps.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    render(element);
    void client.invalidateQueries({ queryKey: ["connected-apps", "user-1"] });
    await waitFor(() => expect(api.listConnectedApps.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => { finishDelete(); });
    await act(async () => { finishRead({ available: true, items: [app] }); });
    expect(screen.queryByText("Claude", ROW_NAME)).toBeNull();
    expect(client.getQueryData(["connected-apps", "user-1"])).toEqual({ available: true, items: [] });
  });

  it("reconciles concurrent revokes independently when a remount starts a stale read", async () => {
    const second = { ...app, appId: "client-2", name: "Other app" };
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    let finishRead!: (value: { available: boolean; items: typeof app[] }) => void;
    api.listConnectedApps.mockResolvedValue({ available: true, items: [app, second] });
    api.revokeConnectedApp.mockImplementation((id: string) => new Promise<void>((resolve) => {
      if (id === app.appId) finishFirst = resolve;
      else finishSecond = resolve;
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const element = routed(<QueryClientProvider client={client}><SettingsConnectedAppsSection /></QueryClientProvider>);
    const first = render(element);
    await screen.findByText("Claude", ROW_NAME);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await waitFor(() => expect(screen.queryByText("Claude", ROW_NAME)).toBeNull());
    first.unmount();
    render(element);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Other app" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await screen.findByText("No apps are connected yet.");
    api.listConnectedApps.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    void client.invalidateQueries({ queryKey: ["connected-apps", "user-1"] });
    await waitFor(() => expect(api.listConnectedApps.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => { finishSecond(); });
    await act(async () => { finishFirst(); });
    await act(async () => { finishRead({ available: true, items: [app, second] }); });
    expect(client.getQueryData(["connected-apps", "user-1"])).toEqual({ available: true, items: [] });
  });

});

describe("Connect an AI app (TAS-414)", () => {
  const steps = () => within(guide()!).getAllByRole("listitem").map((item) => item.textContent);
  const picker = () => within(guide()!).getByRole("group", { name: "App" });
  const choose = (name: string) => fireEvent.click(within(picker()).getByRole("button", { name }));
  const pressed = () => within(picker()).getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent);
  const helpLink = (name: string, href: string) => {
    const link = within(guide()!).getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  };

  it("is under the list when apps are connected, and under the empty line when none are", async () => {
    const { unmount } = draw();
    await screen.findByText("claude.ai");
    expect(screen.getByRole("heading", { level: 2, name: "Connect an AI app" })).toBeVisible();
    expect(within(guide()!).getByText("Claude, ChatGPT and Cursor can work in Taska as you through Taska’s MCP server. You sign in to Taska and choose what to allow, and the app then appears in this list.")).toBeVisible();
    expect(steps()).toHaveLength(3);
    unmount();

    api.listConnectedApps.mockResolvedValue({ available: true, items: [] });
    draw();
    expect(await screen.findByText("No apps are connected yet.")).toBeVisible();
    expect(guide()).toBeVisible();
    expect(steps()).toHaveLength(3);
  });

  it("is not drawn while the profile or the list loads, when OAuth is off, or when the list could not be read", async () => {
    api.getCurrentUser.mockReturnValue(new Promise(() => {}));
    const first = draw();
    expect(screen.getByText("Loading connected apps")).toBeInTheDocument();
    expect(guide()).toBeNull();
    first.unmount();

    api.getCurrentUser.mockResolvedValue({ id: "user-1" });
    api.listConnectedApps.mockReturnValue(new Promise(() => {}));
    const second = draw();
    await waitFor(() => expect(api.listConnectedApps).toHaveBeenCalled());
    expect(screen.getByText("Loading connected apps")).toBeInTheDocument();
    expect(guide()).toBeNull();
    second.unmount();

    api.listConnectedApps.mockResolvedValue({ available: false, items: [] });
    const third = draw();
    expect(await screen.findByText("Connected apps are not available because OAuth is turned off.")).toBeVisible();
    expect(guide()).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    third.unmount();

    api.listConnectedApps.mockRejectedValue(Object.assign(new Error("Unavailable"), { status: 503, requestId: "req-1" }));
    draw();
    expect(await screen.findByText("Connected apps could not be loaded.")).toBeVisible();
    expect(guide()).toBeNull();
  });

  it("picks the app with pressed buttons, Claude first, and pressing the chosen one changes nothing", async () => {
    draw();
    await screen.findByText("claude.ai");
    expect(within(picker()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Claude", "ChatGPT", "Cursor"]);
    expect(pressed()).toEqual(["Claude"]);
    choose("ChatGPT");
    expect(pressed()).toEqual(["ChatGPT"]);
    expect(steps()[0]).toContain("In ChatGPT");
    choose("ChatGPT");
    expect(pressed()).toEqual(["ChatGPT"]);
    expect(steps()[0]).toContain("In ChatGPT");
    choose("Cursor");
    expect(pressed()).toEqual(["Cursor"]);
    choose("Claude");
    expect(pressed()).toEqual(["Claude"]);
  });

  it("walks Claude through a custom connector", async () => {
    draw();
    await screen.findByText("claude.ai");
    expect(steps()).toEqual([
      "In Claude, open Customize → Connectors, choose Add, then Add custom connector.How to add a custom connector",
      expect.stringContaining("Name it Taska and paste this server address:"),
      "Choose Connect, sign in to Taska and allow access.",
    ]);
    expect(within(guide()!).getByText(MCP_URL)).toBeVisible();
    helpLink("How to add a custom connector", CLAUDE_HELP);
  });

  it("walks ChatGPT through a custom MCP server", async () => {
    draw();
    await screen.findByText("claude.ai");
    choose("ChatGPT");
    expect(steps()).toEqual([
      "In ChatGPT, open Plugins, choose Add, then Add custom MCP server.How to add a custom MCP server",
      expect.stringContaining("Name it Taska, choose Public endpoint and paste this server address:"),
      "Set authentication to OAuth and create the plugin, then sign in to Taska and allow access.",
    ]);
    expect(within(guide()!).getByText(MCP_URL)).toBeVisible();
    helpLink("How to add a custom MCP server", CHATGPT_HELP);
    expect(within(guide()!).queryByRole("link", { name: "How to add a custom connector" })).toBeNull();
  });

  it("gives Cursor an mcp.json entry with the address alone, and no token", async () => {
    draw();
    await screen.findByText("claude.ai");
    choose("Cursor");
    expect(steps()).toEqual([
      expect.stringContaining("Add this to ~/.cursor/mcp.json:"),
      "In Cursor’s MCP settings, choose to connect Taska, then sign in to Taska and allow access.",
    ]);
    expect(guide()!.querySelector(".mcp-snippet-code")?.textContent).toBe(CURSOR_CONFIG);
    expect(guide()!.textContent).not.toContain("Bearer");
    helpLink("Cursor’s MCP guide", CURSOR_HELP);
  });

  it.each([
    ["Claude", "Copy the server address", MCP_URL, "Address copied."],
    ["ChatGPT", "Copy the server address", MCP_URL, "Address copied."],
    ["Cursor", "Copy the Cursor configuration", CURSOR_CONFIG, "Configuration copied."],
  ])("copies exactly what %s takes and says so", async (name, label, text, answer) => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    await screen.findByText("claude.ai");
    choose(name);
    fireEvent.click(within(guide()!).getByRole("button", { name: label }));
    expect(await within(guide()!).findByText(answer)).toBeVisible();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(within(guide()!).getByRole("status")).toHaveTextContent(answer);
  });

  it("does not carry a copy's answer over to another app's steps", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Copy the server address" }));
    expect(await screen.findByText("Address copied.")).toBeVisible();
    choose("ChatGPT");
    expect(within(guide()!).getByRole("status")).toBeEmptyDOMElement();
    choose("Claude");
    expect(within(guide()!).getByRole("status")).toBeEmptyDOMElement();
  });

  it.each([
    ["Claude", "Copy the server address", "address", MCP_URL],
    ["Cursor", "Copy the Cursor configuration", "configuration", CURSOR_CONFIG],
  ])("selects the text and says how to copy it when the clipboard refuses %s's", async (name, label, what, text) => {
    const writeText = vi.fn(async () => {
      throw new Error("Write permission denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw();
    await screen.findByText("claude.ai");
    choose(name);
    fireEvent.click(within(guide()!).getByRole("button", { name: label }));
    expect(
      await screen.findByText(`Couldn’t copy the ${what} automatically. It’s selected — press Ctrl+C or ⌘C to copy it.`),
    ).toBeVisible();
    expect(window.getSelection()?.toString()).toBe(text);
  });

  it("sends Claude Code and scripts to Access tokens, whichever app is chosen", async () => {
    draw();
    await screen.findByText("claude.ai");
    for (const name of ["Claude", "ChatGPT", "Cursor"]) {
      choose(name);
      const tokens = within(guide()!).getByRole("link", { name: "create an access token" });
      expect(tokens).toHaveAttribute("href", "/settings/tokens");
      expect(tokens).not.toHaveAttribute("target");
      expect(tokens.closest("p")).toHaveTextContent("For Claude Code or a script, create an access token instead.");
    }
  });

  it("says the MCP server is not available when the build has no address, and shows no picker or steps", async () => {
    vi.stubEnv("VITE_TASKA_MCP_URL", "");
    draw();
    expect(await screen.findByText("The MCP server is not available yet.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Connect an AI app" })).toBeVisible();
    expect(within(guide()!).queryByRole("group")).toBeNull();
    expect(within(guide()!).queryByRole("list")).toBeNull();
    expect(within(guide()!).queryByRole("button")).toBeNull();
    expect(within(guide()!).queryByRole("link")).toBeNull();
  });
});
