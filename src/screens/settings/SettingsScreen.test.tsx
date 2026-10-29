import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { App } from "../App";

/**
 * Settings as the app routes it (TAS-380, DESIGN.md §5.9): the area, its two
 * sections and the redirect into the first, behind the session guard for every
 * role, and Appearance's three choices applied the moment they are pressed.
 * Against `App` itself, so the routes under test are the ones that ship.
 */
const { fakeApi, state } = vi.hoisted(() => {
  const state = { profileFails: false };
  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getNotificationPreferences: async () => ({
      emailEnabled: true,
      telegramEnabled: false,
      email: "anna@example.com",
      telegramAvailable: false,
      // No binding with the integration off: what the backend answers.
      telegramStatus: "NOT_CONNECTED",
      telegramUsername: null,
      telegramName: null,
      telegramLinkId: null,
      telegramLinkExpiresAt: null,
      telegramError: null,
    }),
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    getCurrentUser: async () => {
      if (state.profileFails) throw Object.assign(new Error("Auth service unavailable"), { status: 503 });
      return {
        id: "3f1f5a2e-0000-4000-8000-000000000001",
        email: "tom@example.com",
        displayName: "Tom Becker",
        status: "ACTIVE" as const,
        globalRole: "USER" as const,
        avatarUrl: null,
        avatarUnavailable: false,
      };
    },
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0, unreadCount: 0 }),
    listConnectedApps: async () => ({ available: true, items: [] }),
    listAccessTokens: async () => ({ tokens: [], policy: { maxLifetimeDays: 90, maxActiveTokens: 10 } }),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

function Whereabouts() {
  const location = useLocation();
  return <p data-testid="whereabouts">{location.pathname}</p>;
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Whereabouts />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const root = document.documentElement;
const clear = () => {
  window.localStorage.clear();
  root.removeAttribute("data-theme");
  root.removeAttribute("data-issue-details");
  root.removeAttribute("data-board-columns");
};

beforeEach(() => {
  clear();
  state.profileFails = false;
});

afterEach(clear);

describe("the Settings area", () => {
  it("opens on My profile from /settings, in the shared area recipe", async () => {
    renderAt("/settings");

    await waitFor(() => expect(screen.getByTestId("whereabouts")).toHaveTextContent("/settings/profile"));
    expect(screen.getByRole("heading", { level: 1, name: /Settings.*My profile/ })).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings" });
    expect(within(rail).getByRole("link", { name: "My profile" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Appearance" })).not.toHaveAttribute("aria-current");
    expect(within(rail).getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
    // Access tokens (TAS-412) second, beside the profile it belongs with.
    expect(within(rail).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "My profile",
      "Access tokens",
      "Connected apps",
      "Appearance",
      "Back to projects",
    ]);
    // The app shell's own bar, with the theme toggle, as on /admin.
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
    expect(await screen.findByText("tom@example.com")).toBeVisible();
  });

  it("opens Access tokens at /settings/tokens for any role, with no gate", async () => {
    renderAt("/settings/tokens");

    expect(await screen.findByRole("heading", { level: 1, name: /Settings.*Access tokens/ })).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings" });
    expect(within(rail).getByRole("link", { name: "Access tokens" })).toHaveAttribute("aria-current", "page");
    // Tom is a plain USER here; the section is his own, as My profile is.
    expect(await screen.findByText("No tokens yet.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Connect an AI agent" })).toBeVisible();
  });

  it("opens Connected apps for the signed-in user", async () => {
    renderAt("/settings/connected-apps");
    expect(await screen.findByRole("heading", { level: 1, name: /Settings.*Connected apps/ })).toBeVisible();
    expect(await screen.findByText("No connected apps.")).toBeVisible();
  });

  it("answers an address inside /settings that is no section with the not-found screen", async () => {
    renderAt("/settings/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("draws for a profile that could not be read, so Appearance stays reachable", async () => {
    state.profileFails = true;
    renderAt("/settings/profile");

    expect(await screen.findByText("Your profile could not be loaded.")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Appearance" }));
    expect(await screen.findByRole("group", { name: "Issue details" })).toBeVisible();
  });

  it("moves focus to the heading when the section changes, and not on arrival", async () => {
    renderAt("/settings/profile");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).not.toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Appearance" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Settings.*Appearance/ })).toHaveFocus());
  });

  it("brings the current link into the rail's strip on arrival and on each move, at once and without taking focus (§5.8)", async () => {
    // jsdom lays nothing out, so where the strip ends up is measured in the
    // browser; here, which element is asked to scroll, how, and that focus
    // still lands on the heading.
    const scrolls = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      renderAt("/settings/appearance");
      const rail = await screen.findByRole("navigation", { name: "Settings" });
      const appearance = within(rail).getByRole("link", { name: "Appearance" });
      await waitFor(() => expect(scrolls.mock.contexts).toContain(appearance));
      expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();

      scrolls.mockClear();
      fireEvent.click(within(rail).getByRole("link", { name: "Access tokens" }));

      const tokens = within(rail).getByRole("link", { name: "Access tokens" });
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Settings.*Access tokens/ })).toHaveFocus());
      const railCalls = scrolls.mock.calls.filter((_, index) => rail.contains(scrolls.mock.contexts[index] as Node));
      expect(railCalls).toEqual([[{ inline: "nearest", block: "nearest" }]]);
      expect(scrolls.mock.contexts).toContain(tokens);
    } finally {
      scrolls.mockRestore();
    }
  });
});

describe("Settings → Appearance", () => {
  const group = (name: string) => screen.getByRole("group", { name });
  const option = (row: string, label: string) => within(group(row)).getByRole("button", { name: label });

  it("states each choice in words, with the current option pressed", async () => {
    renderAt("/settings/appearance");
    await screen.findByRole("group", { name: "Issue details" });

    expect(screen.getByText("These choices are saved in this browser.")).toBeVisible();
    expect(group("Issue details")).toHaveAccessibleDescription("Where an issue opens when you select it on the board.");
    expect(group("Board columns")).toHaveAccessibleDescription("Where the columns sit on a wide screen.");
    expect(group("Theme")).toHaveAccessibleDescription("Also switched with the button in the top bar.");
    expect(option("Issue details", "Side panel")).toHaveAttribute("aria-pressed", "true");
    expect(option("Issue details", "Centered window")).toHaveAttribute("aria-pressed", "false");
    expect(option("Board columns", "Left")).toHaveAttribute("aria-pressed", "true");
    expect(option("Theme", "Light")).toHaveAttribute("aria-pressed", "true");
    // No Save: a choice applies as it is pressed.
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("applies a layout choice on <html> at once and remembers it", async () => {
    renderAt("/settings/appearance");
    await screen.findByRole("group", { name: "Issue details" });

    fireEvent.click(option("Issue details", "Centered window"));
    expect(root.dataset.issueDetails).toBe("centered");
    expect(window.localStorage.getItem("taska.issueDetails")).toBe("centered");
    expect(option("Issue details", "Centered window")).toHaveAttribute("aria-pressed", "true");
    expect(option("Issue details", "Side panel")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(option("Board columns", "Centered"));
    expect(root.dataset.boardColumns).toBe("centered");
    expect(window.localStorage.getItem("taska.boardColumns")).toBe("centered");
  });

  it("starts from the stored choice", async () => {
    window.localStorage.setItem("taska.issueDetails", "centered");
    window.localStorage.setItem("taska.boardColumns", "somewhere");
    renderAt("/settings/appearance");
    await screen.findByRole("group", { name: "Issue details" });

    expect(option("Issue details", "Centered window")).toHaveAttribute("aria-pressed", "true");
    // An unknown value is the default.
    expect(option("Board columns", "Left")).toHaveAttribute("aria-pressed", "true");
  });

  it("shares the theme with the top bar's toggle, both ways", async () => {
    renderAt("/settings/appearance");
    await screen.findByRole("group", { name: "Theme" });

    fireEvent.click(option("Theme", "Dark"));
    await waitFor(() => expect(root.dataset.theme).toBe("dark"));
    expect(window.localStorage.getItem("taska.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    await waitFor(() => expect(root.dataset.theme).toBe("light"));
    expect(option("Theme", "Light")).toHaveAttribute("aria-pressed", "true");
  });

  it("changes nothing when the option already chosen is pressed", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    renderAt("/settings/appearance");
    await screen.findByRole("group", { name: "Issue details" });
    writes.mockClear();

    fireEvent.click(option("Issue details", "Side panel"));
    fireEvent.click(option("Board columns", "Left"));

    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});
