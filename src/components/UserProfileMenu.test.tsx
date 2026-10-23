import { QueryClient, QueryClientProvider, focusManager, onlineManager, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { keepSignedAvatarLink, ME_QUERY_KEY } from "../lib/ownAvatarLink";
import { UserProfileMenu } from "./UserProfileMenu";

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

/**
 * The menu writes nothing since TAS-380 — the photo controls moved to Settings
 * → My profile (`SettingsProfileSection.test.tsx`) — so the fake stands in for
 * the two reads it still depends on: `getCurrentUser`, which carries the
 * reader's avatar since TAS-223 and is read by the harness the way the screens
 * read it, and `GET /meta` for the status names. Hoisted because `vi.mock` is.
 */
const { fakeApi, state, reset } = vi.hoisted(() => {
  const state: {
    avatarUrl: string | null;
    /** Profile reads, one `"me"` each. */
    reads: string[];
    /** What `GET /meta` lists as account statuses (TAS-173); `null` for none. */
    userStatuses: { code: string; name: string }[] | null;
  } = {
    avatarUrl: null,
    reads: [],
    userStatuses: null,
  };

  const fakeApi = {
    getMeta: async () => ({
      issueTypes: null,
      priorities: null,
      linkTypes: null,
      notificationTypes: null,
      userStatuses: state.userStatuses,
    }),
    getCurrentUser: async () => {
      state.reads.push("me");
      // The avatar's id stays the same while the picture does, as on the
      // server: only the link is signed afresh on every read.
      return {
        ...anna,
        avatarUrl: state.avatarUrl,
        avatarId: state.avatarUrl ? "avatar-1" : null,
        avatarUnavailable: false,
      };
    },
  } as unknown as TaskaApi;

  const reset = () => {
    state.avatarUrl = null;
    state.reads = [];
    state.userStatuses = null;
  };

  return { fakeApi, state, reset };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A client with the `["me"]` rule `main.tsx` sets, so the link-keeping is the app's. */
const appClient = () => {
  const client = freshClient();
  client.setQueryDefaults(ME_QUERY_KEY, { structuralSharing: keepSignedAvatarLink });
  return client;
};

/** The menu fed by the `["me"]` query, as every screen feeds it. */
function MenuOnProfile() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => fakeApi.getCurrentUser() });
  return <UserProfileMenu loading={me.isPending} onLogout={() => {}} user={me.data} />;
}

// The menu always holds router <Link>s (Settings, and Administration for an
// admin), so every case renders inside a router. The query client is per
// render unless a case brings its own, so one case's avatar never answers the
// next one's read.
const renderMenu = (
  props: ComponentProps<typeof UserProfileMenu>,
  { client = freshClient(), path = "/projects" }: { client?: QueryClient; path?: string } = {},
) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <UserProfileMenu {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const renderOnProfile = ({ client = appClient() }: { client?: QueryClient } = {}) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MenuOnProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

/**
 * The degraded case is the one that matters here. Since TAS-150 a client that
 * still holds tokens is bounced away from `/login`, so this menu is the only
 * way out of the app — and any failure of `GET /users/me` that is not a 401
 * (5xx, network, CORS; the gateway is recorded 500-ing in TAS-139) leaves the
 * tokens in place with no user to show. Gating the trigger on the user made
 * that a dead end recoverable only by clearing site data.
 */
describe("UserProfileMenu", () => {
  it("keeps the menu and Log out usable when the profile failed to load", () => {
    const onLogout = vi.fn();
    renderMenu({ loading: false, onLogout });

    const trigger = screen.getByRole("button", { name: "Open profile" });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeVisible();
    // Nothing invented about who this is — only that we could not find out.
    expect(screen.getByText("Your profile could not be loaded.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("stays disabled only while the profile request is still in flight", () => {
    renderMenu({ loading: true, onLogout: vi.fn() });

    expect(screen.getByRole("button", { name: "Open profile" })).toBeDisabled();
  });

  it("shows the identity once it is known", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Anna Ivanova")).toBeVisible();
    expect(screen.queryByText("Your profile could not be loaded.")).not.toBeInTheDocument();
  });

  it("puts the email under the name, whole, and does not list it again (TAS-389)", () => {
    renderMenu({ user: { ...anna, globalRole: "USER" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    // In the header, where the handle the account no longer has used to be —
    // and only there: the list below is Status and Role.
    const head = document.querySelector<HTMLElement>(".user-profile-head")!;
    expect(within(head).getByText("anna@example.com")).toBeVisible();
    expect(screen.getAllByText("anna@example.com")).toHaveLength(1);
    expect(head).not.toHaveTextContent("@anna");
    const terms = [...document.querySelectorAll(".user-profile-details dt")].map((term) => term.textContent);
    expect(terms).toEqual(["Status", "Role"]);
  });

  it("prints a status it has never heard of instead of an empty badge", () => {
    // A backend newer than this build can add to `UserStatusDto` (TAS-173), so
    // a status the domain union does not carry can arrive. A bare lookup put `undefined` in
    // the badge, which renders as nothing at all. (`UNSPECIFIED`, the zero
    // value, no longer gets this far: the API layer reads it as no status.)
    renderMenu({
      user: { ...anna, status: "SUSPENDED" },
      loading: false,
      onLogout: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("SUSPENDED")).toBeVisible();
  });

  it("names an unknown status by its English /meta name, and passes a Russian one over", async () => {
    state.userStatuses = [
      { code: "SUSPENDED", name: "Suspended" },
      { code: "ARCHIVED", name: "В архиве" },
    ];
    const { unmount } = renderMenu({ user: { ...anna, status: "SUSPENDED" }, loading: false, onLogout: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
    expect(await screen.findByText("Suspended")).toBeVisible();
    unmount();

    renderMenu({ user: { ...anna, status: "ARCHIVED" }, loading: false, onLogout: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
    expect(screen.getByText("ARCHIVED")).toBeVisible();
  });

  it("draws a missing status as a dash rather than throwing on it", () => {
    // `toUser` reads a non-string status — the gateway's `null` — as `null`,
    // and `.toLowerCase()` on it used to take the whole menu down (TAS-173).
    renderMenu({ user: { ...anna, status: null }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Status")).toBeVisible();
    expect(screen.getByText("—")).toBeVisible();
  });

  it("writes the fourth status out now that the domain carries it", () => {
    renderMenu({ user: { ...anna, status: "LOCKED" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Locked")).toBeVisible();
  });

  it("names the global role of an admin", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Role")).toBeVisible();
    expect(screen.getByText("Global admin")).toBeVisible();
  });

  it("names the global role of a plain user", () => {
    renderMenu({ user: { ...anna, globalRole: "USER" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Role")).toBeVisible();
    expect(screen.getByText("User")).toBeVisible();
  });

  // A gateway that predates the field, or one answering UNSPECIFIED, arrives
  // here as no role at all. The menu says nothing rather than inventing an
  // "Unknown" role for an account that certainly has one.
  it("omits the role row entirely when the server did not state one", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Status")).toBeVisible();
    expect(screen.queryByText("Role")).not.toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
    expect(screen.queryByText("Global admin")).not.toBeInTheDocument();
  });

  it("offers a global admin a link into the administration section", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    // A link, not a button: /admin is a page, so it has to be middle-clickable
    // and copyable.
    const entry = screen.getByRole("link", { name: "Administration" });
    expect(entry).toHaveAttribute("href", "/admin");
    // Before Log out, which stays the last item in the menu.
    expect(entry.nextElementSibling).toBe(screen.getByRole("button", { name: "Log out" }));
  });

  // Nothing unmounts the trigger here, and that is the case being pinned: the
  // real app reaches it by choosing Administration while already on /admin, so
  // the popover closes without a route change. When the route does change,
  // focus lands on <body> a tick later no matter what this component does —
  // app-wide behaviour, recorded in docs/ai/BACKLOG.md.
  it("closes the popover on selection, keeping focus on the trigger when no navigation follows", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: "Administration" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The element that had focus went with the popover, so without the handoff
    // the keyboard would be left on <body> (§7).
    expect(trigger).toHaveFocus();
  });

  // Absent from the markup, not hidden and not disabled: a plain user has no
  // Administration entry to find in the DOM at all.
  /**
   * DESIGN.md §4.16 asks for all three ways out, and this menu is where the
   * repository's implementation of them lives — it is now `useDismissOnOutside`
   * and the notifications popover and the global search share it, so these
   * cases pin the behaviour all three depend on rather than one component's.
   */
  it("closes on Escape, on a press outside, and on a second press of its own trigger", () => {
    renderMenu({ loading: false, onLogout: vi.fn(), user: anna });
    const trigger = screen.getByRole("button", { name: /Open profile for/ });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Current user profile" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The classic failure of this pattern: the outside handler fires on the
    // press, the toggle fires on the release, and the menu closes and reopens
    // in one click. The ref goes around the trigger, so it never starts.
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("gives a plain user no administration entry", () => {
    renderMenu({ user: { ...anna, globalRole: "USER" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    // Settings is the only link the menu holds for them.
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings"]);
  });

  // An account whose role the gateway never stated counts as not an admin —
  // lossy in the safe direction (docs/ai/API-DIVERGENCE.md).
  it("gives an account with no stated role no administration entry either", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
  });
  /**
   * The reader's face, drawn from the profile since backend PR #193 (TAS-223):
   * `GET /users/me` carries the reader's own avatar, so the menu spends no
   * request of its own on it, and a re-read does not swap its link while the
   * avatar is the same one. The controls that write it are on Settings → My
   * profile since TAS-380 (`SettingsProfileSection.test.tsx`).
   */
  describe("the profile photo", () => {
    const FACE = "https://store.example/face.png?sig=1";

    it("draws the reader's face from the profile, with no avatar request of its own", async () => {
      state.avatarUrl = FACE;
      renderOnProfile();

      const trigger = await screen.findByRole("button", { name: "Open profile for Anna Ivanova" });
      // The picture is in the trigger as well as in the popover, and the name
      // stays on the circle rather than moving onto the image.
      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      expect(trigger.querySelector("img")).toHaveAttribute("src", FACE);
      expect(trigger.querySelector("img")).toHaveAttribute("alt", "");
      expect(trigger.querySelector(".avatar")).toHaveAttribute("aria-label", "Anna Ivanova");
      expect(trigger.textContent).toBe("");

      fireEvent.click(trigger);
      // The popover's header draws the same face; its controls are gone.
      expect(screen.getByRole("dialog").querySelector(".user-profile-head img")).toHaveAttribute("src", FACE);
      expect(screen.queryByRole("button", { name: /photo/ })).not.toBeInTheDocument();
      // One profile read, and nothing else: the avatar rode on it.
      expect(state.reads).toEqual(["me"]);
    });

    it("keeps the drawn link when a re-read re-signs the same avatar, and takes a new one after ten minutes", async () => {
      // Every read of `/users/me` signs a fresh link — a new URL for the same
      // picture — and the browser's cache never recognises it. A focus re-read
      // must not swap the <img src> and download the face again.
      const realNow = Date.now.bind(Date);
      let elapsed = 0;
      vi.spyOn(Date, "now").mockImplementation(() => realNow() + elapsed);
      state.avatarUrl = "https://store.example/face.png?sig=keep-1";
      const client = appClient();
      renderOnProfile({ client });
      const trigger = await screen.findByRole("button", { name: "Open profile for Anna Ivanova" });
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", state.avatarUrl));

      elapsed = 9 * 60 * 1000;
      state.avatarUrl = "https://store.example/face.png?sig=keep-2";
      await act(() => client.invalidateQueries({ queryKey: ["me"] }));
      await waitFor(() => expect(state.reads).toEqual(["me", "me"]));
      expect(trigger.querySelector("img")).toHaveAttribute("src", "https://store.example/face.png?sig=keep-1");

      // Past ten minutes the held link is too close to its fifteen, and the
      // next answer's link is drawn instead.
      elapsed = 11 * 60 * 1000;
      state.avatarUrl = "https://store.example/face.png?sig=keep-3";
      await act(() => client.invalidateQueries({ queryKey: ["me"] }));
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", "https://store.example/face.png?sig=keep-3"));
    });

  });

  /**
   * Settings (TAS-380, art-director's ruling 6): one row above Administration
   * and Log out, in Administration's own shape and class, for every reader —
   * including one whose profile did not load, because Appearance needs none.
   */
  describe("the Settings row", () => {
    it.each([
      ["a plain user", { ...anna, globalRole: "USER" as const }, "Open profile for Anna Ivanova"],
      ["a global admin", { ...anna, globalRole: "GLOBAL_ADMIN" as const }, "Open profile for Anna Ivanova"],
      ["an account with no stated role", anna, "Open profile for Anna Ivanova"],
      ["a profile that failed to load", undefined, "Open profile"],
    ])("is there for %s, first of the rows, in the class Administration wears", (_who, user, triggerName) => {
      renderMenu({ user, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: triggerName }));

      const settings = screen.getByRole("link", { name: "Settings" });
      expect(settings).toHaveAttribute("href", "/settings");
      expect(settings).toHaveClass("user-profile-link");
      expect(settings).not.toHaveAttribute("aria-current");
      const rows = [...settings.parentElement!.children].map((row) => row.textContent);
      expect(rows[0]).toBe("Settings");
      expect(rows[rows.length - 1]).toBe("Log out");
      const admin = screen.queryByRole("link", { name: "Administration" });
      if (admin) {
        expect(admin).toHaveClass("user-profile-link");
        expect(settings.nextElementSibling).toBe(admin);
      }
      // The photo controls left with TAS-380; nothing else did.
      expect(screen.queryByRole("button", { name: /photo/ })).not.toBeInTheDocument();
    });

    it.each(["/settings", "/settings/profile", "/settings/appearance"])("says it is the current page on %s", (path) => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { path });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    });

    it("does not say so on a page that only starts with the same letters", () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { path: "/settingsx" });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
    });

    it("closes the menu on a plain click and gives focus back to the trigger; a modified click leaves it open", () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });

      fireEvent.click(trigger);
      // A modified click is the browser's to follow, in a new tab; jsdom cannot
      // open one, so its default is cancelled before the menu sees the click.
      const stayHere = (event: MouseEvent) => event.preventDefault();
      document.addEventListener("click", stayHere, { capture: true, once: true });
      fireEvent.click(screen.getByRole("link", { name: "Settings" }), { metaKey: true });
      expect(screen.getByRole("dialog", { name: "Current user profile" })).toBeVisible();

      fireEvent.click(screen.getByRole("link", { name: "Settings" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("gives focus back to the trigger on Escape, with the press marked as used", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
    fireEvent.click(trigger);
    const settings = screen.getByRole("link", { name: "Settings" });
    settings.focus();

    // The row that has focus goes with the popover; without the hand-back
    // focus fell to <body> (TAS-380, art-director's ruling 4).
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      settings.dispatchEvent(escape);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(escape.defaultPrevented).toBe(true);
  });
});
