import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { UserProfileMenu } from "./UserProfileMenu";

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

/**
 * The avatar half of this menu is the only part of it that talks to a server
 * (TAS-220), so the fake stands in for the five `TaskaApi` calls it can make
 * and records what it was asked. Hoisted because `vi.mock` is.
 */
const { fakeApi, state, reset, release } = vi.hoisted(() => {
  const state: {
    avatarUrl: string | null;
    reads: string[];
    deletes: number;
    failWith?: Error;
    confirmedUrl: string;
    /** Holds the delete open so the optimistic frame can actually be observed. */
    holdDelete: boolean;
  } = {
    avatarUrl: null,
    reads: [],
    deletes: 0,
    confirmedUrl: "https://store.example/new-face.png?sig=2",
    holdDelete: false,
  };

  let releaseDelete: (() => void) | null = null;
  /** Lets a held delete finish — and only then does it succeed or fail. */
  const release = () => {
    releaseDelete?.();
    releaseDelete = null;
  };

  const fakeApi = {
    getUserAvatarUrl: async (userId: string) => {
      state.reads.push(userId);
      if (state.failWith) throw state.failWith;
      return state.avatarUrl;
    },
    createAvatarUploadUrl: async () => {
      if (state.failWith) throw state.failWith;
      return { uploadUrl: "https://store.example/upload?sig=1", objectKey: "obj", expiresIn: 900 };
    },
    putAvatarBytes: async () => undefined,
    confirmAvatarUpload: async () => {
      state.avatarUrl = state.confirmedUrl;
      return {
        id: "avatar-1",
        userId: anna.id,
        objectKey: "obj",
        fileName: "face.png",
        contentType: "image/png",
        sizeBytes: 32,
        createdAt: null,
        downloadUrl: state.confirmedUrl,
      };
    },
    deleteMyAvatar: async () => {
      state.deletes += 1;
      if (state.holdDelete) await new Promise<void>((resolve) => (releaseDelete = resolve));
      if (state.failWith) throw state.failWith;
      state.avatarUrl = null;
    },
  } as unknown as TaskaApi;

  const reset = () => {
    state.avatarUrl = null;
    state.reads = [];
    state.deletes = 0;
    state.failWith = undefined;
    state.confirmedUrl = "https://store.example/new-face.png?sig=2";
    state.holdDelete = false;
    releaseDelete = null;
  };

  return { fakeApi, state, reset, release };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

// The menu can hold a router <Link> (the Administration entry), so every case
// renders inside a router — including the ones where the entry is absent, so a
// missing router can never be what makes them pass. The query client is per
// render, so one case's avatar never answers the next one's read.
const renderMenu = (props: ComponentProps<typeof UserProfileMenu>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <UserProfileMenu {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The file input the "Upload a photo" button drives. */
const pick = (file: File) => {
  const input = document.querySelector<HTMLInputElement>(".avatar-input");
  if (!input) throw new Error("no avatar input in the popover");
  fireEvent.change(input, { target: { files: [file] } });
};

const imageFile = (name = "face.png", bytes = 32, type = "image/png") =>
  new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  reset();
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
    expect(screen.getByText("@anna")).toBeVisible();
    expect(screen.getByText("anna@example.com")).toBeVisible();
    expect(screen.queryByText("Your profile could not be loaded.")).not.toBeInTheDocument();
  });

  it("prints a status it has never heard of instead of an empty badge", () => {
    // `GET /users/me` answers the gateway's own `GatewayUserStatus`, which has
    // no `LOCKED`. Backend PR #146 deployed the state without adding it there,
    // so an account locked by failed sign-ins whose pre-lock token still works
    // reads back as `UNSPECIFIED` today — a value the domain union does not
    // carry and adding `LOCKED` to it does not cover. A bare lookup put
    // `undefined` in the badge, which renders as nothing at all.
    renderMenu({
      user: { ...anna, status: "UNSPECIFIED" as User["status"] },
      loading: false,
      onLogout: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("UNSPECIFIED")).toBeVisible();
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
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // An account whose role the gateway never stated counts as not an admin —
  // lossy in the safe direction (docs/ai/API-DIVERGENCE.md).
  it("gives an account with no stated role no administration entry either", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  /**
   * The avatar controls (TAS-220). Three things are pinned: that the reader's
   * own face costs exactly one request and is not asked for again on a second
   * open, that a refusal happens *before* any request is spent, and that the
   * undeployed gateway is reported as undeployed rather than as a raw failure —
   * which is the answer every reader gets until backend PR #150 ships.
   */
  describe("the profile photo", () => {
    it("spends one read for the reader's own avatar and draws it in place of the initials", async () => {
      state.avatarUrl = "https://store.example/face.png?sig=1";
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      await waitFor(() => expect(state.reads).toEqual([anna.id]));
      // The picture is in the trigger as well as in the popover, and the name
      // stays on the circle rather than moving onto the image.
      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      expect(trigger.querySelector("img")).toHaveAttribute("src", "https://store.example/face.png?sig=1");
      expect(trigger.querySelector("img")).toHaveAttribute("alt", "");
      expect(trigger.querySelector(".avatar")).toHaveAttribute("aria-label", "Anna Ivanova");
      expect(trigger.textContent).toBe("");

      fireEvent.click(trigger);
      // Opening the menu asks nothing new: the read is keyed by user, not by
      // whether the popover is on screen.
      expect(state.reads).toEqual([anna.id]);
      expect(screen.getByRole("button", { name: "Replace photo" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Remove photo" })).toBeVisible();
    });

    it("offers an upload and no removal when the server says there is no avatar", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

      await waitFor(() => expect(state.reads).toEqual([anna.id]));
      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeVisible();
      // Only a successful read may say there is nothing to remove (§5.6), and
      // this one said exactly that.
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
      // The initials are what the circle draws instead.
      expect(screen.getAllByLabelText("Anna Ivanova")[0].textContent).toBe("AI");
    });

    it("states the enforced ceiling and the accepted types before a file is chosen", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      // 2 MB — the number auth-service enforces, not the 5 MB its own schema
      // declares. Offering the declared one would offer a file the product
      // refuses a layer deeper, after the bytes had already gone.
      expect(screen.getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
      expect(document.querySelector(".avatar-input")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    });

    it("runs the three legs and replaces the initials with what came back", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      // The confirm answers with the link, so nothing re-reads to find it.
      expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl);
      expect(screen.getByRole("button", { name: "Replace photo" })).toBeVisible();
    });

    it("refuses a type outside the allowlist without spending a request", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      // A GIF passes the picker on some systems — `accept` filters by the
      // operating system's idea of a type and `File.type` is the browser's.
      pick(imageFile("wave.gif", 32, "image/gif"));

      await waitFor(() =>
        expect(
          screen.getByText("wave.gif is not a type this product accepts. Choose a JPEG, PNG or WebP image."),
        ).toBeVisible(),
      );
      // The person is owed the file's name, not `"Content type not allowed: …"`
      // — that sentence is the API layer's, for parity between mock and rest.
      expect(screen.queryByText(/Content type not allowed/)).not.toBeInTheDocument();
    });

    it("refuses a photo over the ceiling with its size, not with the server's sentence", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile("huge.png", 3 * 1024 * 1024));

      await waitFor(() =>
        expect(screen.getByText("huge.png is 3 MB. The largest photo this product accepts is 2 MB.")).toBeVisible(),
      );
    });

    it("removes the photo at once and puts it back if the server refuses", async () => {
      state.avatarUrl = "https://store.example/face.png?sig=1";
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeVisible());

      // Held open, because the frame being asserted is the one *between* the
      // press and the answer: without this the refusal lands in the same batch
      // as the optimistic patch and a passing test would prove nothing.
      state.holdDelete = true;
      state.failWith = Object.assign(new Error("Something went wrong"), { code: "INTERNAL_SERVER_ERROR", status: 500 });
      fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

      // Optimistic: the picture goes before the answer does.
      await waitFor(() => expect(trigger.querySelector("img")).toBeNull());
      release();
      // And comes back, with the reason — a rollback nobody is told about is
      // what §5.6 calls out.
      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      expect(screen.getByText(/Your photo was not removed\. Something went wrong/)).toBeVisible();
      expect(state.deletes).toBe(1);
    });

    it("says the routes are not on this gateway yet rather than printing the 404", async () => {
      // All four avatar routes answer Spring's static-resource 404 today
      // (probed 2026-09-12), which is the first arm of `isUndeployedRoute`.
      state.failWith = Object.assign(
        new Error("No static resource api/v1/users/me/avatar/upload-url for request '…'."),
        { code: "NOT_FOUND", status: 404 },
      );
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Upload a photo" })).toBeVisible());

      pick(imageFile());

      await waitFor(() =>
        expect(screen.getByText("Profile photos are not on this gateway yet, so nothing was saved.")).toBeVisible(),
      );
      expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
    });

    it("asks nothing at all when the profile itself could not be loaded", async () => {
      // No user, no id, and therefore no `GET /users/{userId}/avatar` to make:
      // the popover keeps Log out and says only what it knows.
      renderMenu({ loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile" }));

      expect(state.reads).toEqual([]);
      expect(screen.queryByRole("button", { name: "Upload a photo" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
    });
  });
});
