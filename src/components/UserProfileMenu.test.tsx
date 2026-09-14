import { QueryClient, QueryClientProvider, focusManager, onlineManager, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { ProjectMember, User } from "../domain/types";
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
 * and records what it was asked — plus `listMembers`, which the menu must
 * *never* cause to be called, and which is here so that a case can prove it.
 * Hoisted because `vi.mock` is.
 */
const { fakeApi, state, reset, release } = vi.hoisted(() => {
  const state: {
    avatarUrl: string | null;
    reads: string[];
    deletes: number;
    /** Object keys `createAvatarUploadUrl` minted, in order. */
    minted: string[];
    /** Object keys `confirmAvatarUpload` was sent, in order. */
    confirmed: string[];
    /** Member-list reads: what an avatar write that fanned out would spend. */
    memberReads: number;
    readFailure?: Error;
    ticketFailure?: Error;
    /** Fails the next confirm only, so the retry after it can be watched. */
    confirmFailure?: Error;
    deleteFailure?: Error;
    confirmedUrl: string;
    /** `false` answers the confirm without its `downloadUrl`. */
    confirmCarriesLink: boolean;
    /** Holds the delete open so the optimistic frame can actually be observed. */
    holdDelete: boolean;
    /** Holds the confirm open so the in-flight frame of an upload can be observed. */
    holdConfirm: boolean;
  } = {
    avatarUrl: null,
    reads: [],
    deletes: 0,
    minted: [],
    confirmed: [],
    memberReads: 0,
    confirmedUrl: "https://store.example/new-face.png?sig=2",
    confirmCarriesLink: true,
    holdDelete: false,
    holdConfirm: false,
  };

  let releaseHeld: (() => void) | null = null;
  const hold = () => new Promise<void>((resolve) => (releaseHeld = resolve));
  /** Lets a held call finish — and only then does it succeed or fail. */
  const release = () => {
    releaseHeld?.();
    releaseHeld = null;
  };

  const fakeApi = {
    getUserAvatarUrl: async (userId: string) => {
      state.reads.push(userId);
      if (state.readFailure) throw state.readFailure;
      return state.avatarUrl;
    },
    createAvatarUploadUrl: async () => {
      if (state.ticketFailure) throw state.ticketFailure;
      const objectKey = `obj-${state.minted.length + 1}`;
      state.minted.push(objectKey);
      return { uploadUrl: `https://store.example/upload/${objectKey}?sig=1`, objectKey, expiresIn: 900 };
    },
    putAvatarBytes: async () => undefined,
    confirmAvatarUpload: async ({ objectKey }: { objectKey: string }) => {
      state.confirmed.push(objectKey);
      if (state.holdConfirm) await hold();
      const failure = state.confirmFailure;
      if (failure) {
        state.confirmFailure = undefined;
        throw failure;
      }
      state.avatarUrl = state.confirmedUrl;
      return {
        id: "avatar-1",
        userId: anna.id,
        objectKey,
        fileName: "face.png",
        contentType: "image/png",
        sizeBytes: 32,
        createdAt: "2026-09-14T11:14:00Z",
        downloadUrl: state.confirmCarriesLink ? state.confirmedUrl : null,
      };
    },
    deleteMyAvatar: async () => {
      state.deletes += 1;
      if (state.holdDelete) await hold();
      if (state.deleteFailure) throw state.deleteFailure;
      state.avatarUrl = null;
    },
    listMembers: async () => {
      state.memberReads += 1;
      return [];
    },
  } as unknown as TaskaApi;

  const reset = () => {
    state.avatarUrl = null;
    state.reads = [];
    state.deletes = 0;
    state.minted = [];
    state.confirmed = [];
    state.memberReads = 0;
    state.readFailure = undefined;
    state.ticketFailure = undefined;
    state.confirmFailure = undefined;
    state.deleteFailure = undefined;
    state.confirmedUrl = "https://store.example/new-face.png?sig=2";
    state.confirmCarriesLink = true;
    state.holdDelete = false;
    state.holdConfirm = false;
    releaseHeld = null;
  };

  return { fakeApi, state, reset, release };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

// The menu can hold a router <Link> (the Administration entry), so every case
// renders inside a router — including the ones where the entry is absent, so a
// missing router can never be what makes them pass. The query client is per
// render unless a case brings its own, so one case's avatar never answers the
// next one's read.
const renderMenu = (
  props: ComponentProps<typeof UserProfileMenu>,
  { client = freshClient(), children }: { client?: QueryClient; children?: ReactNode } = {},
) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UserProfileMenu {...props} />
        {children}
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

/**
 * One macrotask, inside `act`. A refetch that an invalidation starts is queued
 * behind the write that caused it, so "nothing was read again" is only worth
 * asserting once the queue behind that write has actually run.
 */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

const REQUEST_ID = "7f0e6d5c-1b2a-4c3d-9e8f-0a1b2c3d4e5f";

/** The static-resource 404 all four avatar routes answer on the stand today. */
const undeployed = (path: string) =>
  Object.assign(new Error(`No static resource api/v1/users/${path} for request '…'.`), {
    code: "NOT_FOUND",
    status: 404,
  });

/**
 * The two caches that draw member faces, as their screens hold them: the
 * board's `["members", projectId]` is the list itself, and the project cards'
 * `["project-summaries", projectId]` is `ProjectsScreen`'s summary — `count`,
 * `members`, and `members: null` with a `failure` when that half of the card
 * did not load.
 */
const PROJECT = "project-tas";
const OTHER_PROJECT = "project-web";
const TOM_FACE = "https://store.example/tom.png?sig=1";

const memberRows = (annaFace: string | null): ProjectMember[] => [
  {
    userId: anna.id,
    role: "ADMIN",
    user: { displayName: anna.displayName, email: anna.email, avatarUrl: annaFace },
  },
  {
    userId: "user-tom",
    role: "MEMBER",
    user: { displayName: "Tom Berg", email: "tom@example.com", avatarUrl: TOM_FACE },
  },
];

const seededClient = (annaFace: string | null) => {
  const client = freshClient();
  client.setQueryData(["members", PROJECT], memberRows(annaFace));
  client.setQueryData(["project-summaries", PROJECT], { count: 9, members: memberRows(annaFace), failure: null });
  client.setQueryData(["project-summaries", OTHER_PROJECT], {
    count: 2,
    members: null,
    failure: new Error("Members unavailable"),
  });
  return client;
};

/** One person's face as each holder currently draws it. */
const faceIn = (client: QueryClient, userId: string) => ({
  members: client.getQueryData<ProjectMember[]>(["members", PROJECT])?.find((row) => row.userId === userId)?.user
    ?.avatarUrl,
  summary: client
    .getQueryData<{ members: ProjectMember[] | null }>(["project-summaries", PROJECT])
    ?.members?.find((row) => row.userId === userId)?.user?.avatarUrl,
});

/**
 * Both holders, mounted the way their screens mount them, and never stale — so
 * the only thing that can make either read again is an invalidation, which is
 * exactly what an avatar write must not cause. A query with no observer is
 * never refetched by one, so without this a "no refetch" assertion would pass
 * against code that invalidated everything.
 */
function MemberFaceHolders() {
  useQuery({ queryKey: ["members", PROJECT], queryFn: () => fakeApi.listMembers(PROJECT), staleTime: Infinity });
  useQuery({
    queryKey: ["project-summaries", PROJECT],
    queryFn: async () => ({ count: 9, members: await fakeApi.listMembers(PROJECT), failure: null }),
    staleTime: Infinity,
  });
  useQuery({
    queryKey: ["project-summaries", OTHER_PROJECT],
    queryFn: async () => ({ count: 2, members: await fakeApi.listMembers(OTHER_PROJECT), failure: null }),
    staleTime: Infinity,
  });
  return null;
}

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
   * The avatar controls (TAS-220). What is pinned: that the reader's own face
   * costs one read and is not asked for again on a second open, on a focus, or
   * after a write whose answer already carried the link; that a write rewrites
   * the member rows already in the cache instead of reading every list again;
   * that a refusal happens *before* any request is spent; and that the
   * undeployed gateway is reported as undeployed rather than as a raw failure —
   * which is the answer every reader gets until backend PR #150 deploys.
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

    it("re-reads its own avatar on a mount after ten minutes, and never on a window focus", async () => {
      // Every answer is a freshly signed link — a new URL for the same picture —
      // so a refetch is not a cheap confirmation: the browser downloads the image
      // again. Ten minutes stays under the fifteen a link lives.
      const realNow = Date.now.bind(Date);
      let elapsed = 0;
      vi.spyOn(Date, "now").mockImplementation(() => realNow() + elapsed);
      state.avatarUrl = "https://store.example/face.png?sig=1";
      const client = freshClient();
      const menus = (copies: number) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            {Array.from({ length: copies }, (_, index) => (
              <UserProfileMenu key={index} loading={false} onLogout={vi.fn()} user={anna} />
            ))}
          </MemoryRouter>
        </QueryClientProvider>
      );
      const { rerender } = render(menus(1));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      // Nine minutes on, a second copy mounting — the board's beside the top
      // bar's, or the next screen's — draws the link it already has.
      elapsed = 9 * 60 * 1000;
      rerender(menus(2));
      await settle();
      expect(state.reads).toEqual([anna.id]);

      // Eleven minutes on the link is stale, and coming back to the window
      // still asks nothing: a focus is not a navigation.
      elapsed = 11 * 60 * 1000;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await settle();
      expect(state.reads).toEqual([anna.id]);

      // A mount past ten minutes does read, so the next screen draws a link with
      // its lifetime ahead of it.
      rerender(menus(3));
      await waitFor(() => expect(state.reads).toEqual([anna.id, anna.id]));
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

    it("runs the three legs and replaces the initials with what came back, without reading it again", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl);
      await waitFor(() => expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled());
      // The confirm answered with the link, so nothing re-reads to find it.
      await settle();
      expect(state.reads).toEqual([anna.id]);
    });

    it("keeps the button's own label while an upload is in flight, and says so on the hint line", async () => {
      state.holdConfirm = true;
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));
      const button = screen.getByRole("button", { name: "Upload a photo" });

      pick(imageFile());

      // One word for all three legs, on the line under the controls. The label
      // the reader pressed stays as it was, so neither button changes width and
      // "Remove photo" beside it never moves.
      await waitFor(() => expect(screen.getByText("Uploading…")).toBeVisible());
      expect(screen.getByText("Uploading…")).toHaveClass("user-profile-photo-hint");
      expect(button).toHaveTextContent("Upload a photo");
      expect(button).toBeDisabled();
      expect(screen.queryByText("Up to 2 MB. JPEG, PNG or WebP.")).not.toBeInTheDocument();

      release();

      await waitFor(() => expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled());
      expect(screen.getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
    });

    it("writes the new face into every cached member row, without reading a member list again", async () => {
      const client = seededClient(null);
      const failedSummary = client.getQueryData(["project-summaries", OTHER_PROJECT]);
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client, children: <MemberFaceHolders /> });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: state.confirmedUrl, summary: state.confirmedUrl }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled());
      await settle();

      // The link the confirm answered with, written where the board and the
      // project card read faces from — and not one member list read to get it.
      // Invalidating the summaries instead re-runs `listIssues` and `listMembers`
      // for every card on `/projects`, to change one face.
      expect(state.memberReads).toBe(0);
      expect(state.reads).toEqual([anna.id]);
      // Only the reader's row moved: a neighbour keeps their face, a summary keeps
      // its count, and a card whose member half had failed is left exactly as it
      // was rather than given a list.
      expect(faceIn(client, "user-tom")).toEqual({ members: TOM_FACE, summary: TOM_FACE });
      expect(client.getQueryData(["project-summaries", PROJECT])).toMatchObject({ count: 9, failure: null });
      expect(client.getQueryData(["project-summaries", OTHER_PROJECT])).toBe(failedSummary);
    });

    it("re-reads the reader's own avatar only when the confirm answered without a link", async () => {
      state.confirmCarriesLink = false;
      const client = seededClient(null);
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client, children: <MemberFaceHolders /> });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      // The one case that costs a read, and it is a read of this one avatar: the
      // answer did not say where the picture is, so nothing else can.
      await waitFor(() => expect(state.reads).toEqual([anna.id, anna.id]));
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl));
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: state.confirmedUrl, summary: state.confirmedUrl }));
      await settle();
      expect(state.memberReads).toBe(0);
    });

    it("takes the face off every cached member row at once on Remove, without reading anything again", async () => {
      const face = "https://store.example/face.png?sig=1";
      state.avatarUrl = face;
      const client = seededClient(face);
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client, children: <MemberFaceHolders /> });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeVisible());

      // Held open, because the frame being asserted is the one *between* the
      // press and the answer: without this the answer lands in the same batch
      // as the optimistic patch and a passing test would prove nothing.
      state.holdDelete = true;
      fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: null, summary: null }));
      expect(trigger.querySelector("img")).toBeNull();

      release();

      await waitFor(() => expect(state.deletes).toBe(1));
      await waitFor(() => expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled());
      await settle();
      expect(faceIn(client, anna.id)).toEqual({ members: null, summary: null });
      expect(faceIn(client, "user-tom")).toEqual({ members: TOM_FACE, summary: TOM_FACE });
      expect(state.memberReads).toBe(0);
      expect(state.reads).toEqual([anna.id]);
    });

    it("puts the face back on the menu and on every cached member row when the server refuses the removal", async () => {
      const face = "https://store.example/face.png?sig=1";
      state.avatarUrl = face;
      const client = seededClient(face);
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client, children: <MemberFaceHolders /> });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeVisible());

      state.holdDelete = true;
      state.deleteFailure = Object.assign(new Error("Something went wrong"), {
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
      });
      fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

      // Optimistic: the picture goes, here and on the member rows, before the
      // answer does.
      await waitFor(() => expect(trigger.querySelector("img")).toBeNull());
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: null, summary: null }));

      release();

      // And comes back everywhere it went, with the reason — a rollback nobody is
      // told about is what §5.6 calls out.
      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: face, summary: face }));
      expect(screen.getByText(/Your photo was not removed\. Something went wrong/)).toBeVisible();
      await settle();
      expect(state.deletes).toBe(1);
      expect(state.memberReads).toBe(0);
      expect(state.reads).toEqual([anna.id]);
    });

    it("never confirms one object key twice: choosing the photo again after a failed confirm starts a new ticket", async () => {
      // The server does not check that a key was minted for the caller, and a
      // second confirm of the key the saved row already holds deletes that very
      // object. So the retry is the person choosing the file again — never this
      // menu sending the old key.
      state.confirmFailure = Object.assign(new Error("The avatar could not be recorded. Please try again."), {
        code: "UNAVAILABLE",
        status: 503,
      });
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
      fireEvent.click(trigger);
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());
      await waitFor(() =>
        expect(screen.getByText("Your photo was not saved. The avatar could not be recorded. Please try again.")).toBeVisible(),
      );

      pick(imageFile());
      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());

      expect(state.minted).toEqual(["obj-1", "obj-2"]);
      expect(state.confirmed).toEqual(["obj-1", "obj-2"]);
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
      expect(state.minted).toEqual([]);
    });

    it("refuses a photo over the ceiling with its size, not with the server's sentence", async () => {
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile("huge.png", 3 * 1024 * 1024));

      await waitFor(() =>
        expect(screen.getByText("huge.png is 3 MB. The largest photo this product accepts is 2 MB.")).toBeVisible(),
      );
      expect(state.minted).toEqual([]);
    });

    it("carries a refused write's request id on its own line, outside the announcement", async () => {
      state.ticketFailure = Object.assign(new Error("Storage service unavailable"), {
        code: "UNAVAILABLE",
        status: 503,
        requestId: REQUEST_ID,
      });
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      const sentence = await screen.findByText("Your photo was not saved. Storage service unavailable");
      const detail = sentence.parentElement!.querySelector(".user-profile-photo-note-detail");
      expect(detail).not.toBeNull();
      // Copyable, which is the only reason it is on screen (§5.6): it goes to a
      // gateway log or a ticket, never back into this UI.
      expect(within(detail as HTMLElement).getByRole("button", { name: `Copy request id ${REQUEST_ID}` })).toBeVisible();
      // The sentence is the live region and no ancestor of the id is one, so a
      // screen reader hears the refusal and is never made to spell out a uuid.
      expect(sentence).toHaveAttribute("aria-live", "polite");
      expect(detail!.closest("[aria-live]")).toBeNull();
      // The gateway's words are in the sentence already; the line adds the id and
      // nothing else.
      expect(detail).not.toHaveTextContent("Storage service unavailable");
    });

    it("offers no photo controls at all when its own read already met the undeployed route", async () => {
      // The avatar routes answer Spring's static-resource 404 on the stand —
      // all four when probed on 2026-09-12, and still on 2026-09-14 after PR
      // #150 merged — and so the read this menu makes on mount has already
      // answered the question every control would ask. Offering "Upload a
      // photo" and refusing only after the file picker is an interaction built
      // to fail.
      state.readFailure = undeployed(`${anna.id}/avatar`);
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

      const hint = await screen.findByText("Profile photos are not on this gateway yet.");
      expect(hint).toHaveClass("user-profile-photo-hint");
      // The band keeps its place and its divider, and holds nothing else: no
      // button, no picker, no limits for a feature that is not there…
      expect(hint.parentElement).toHaveClass("user-profile-photo");
      expect(hint.parentElement!.children).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Upload a photo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
      expect(document.querySelector(".avatar-input")).toBeNull();
      expect(screen.queryByText("Up to 2 MB. JPEG, PNG or WebP.")).not.toBeInTheDocument();
      // …and no alarm: a route that is not deployed is not a failure of anything
      // the reader did.
      expect(document.querySelector(".user-profile-photo .is-error")).toBeNull();
      expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
      // Not retried either: the answer is final until the backend deploys.
      expect(state.reads).toEqual([anna.id]);
    });

    it("makes no request on a second mount once its read has met the undeployed route", async () => {
      // A failed query with no data is run again on every mount, whatever its
      // stale time says — which on a stand without the routes was one 404 per
      // navigation, from every reader, for as long as the stand lacks them.
      state.readFailure = undeployed(`${anna.id}/avatar`);
      const client = freshClient();
      const avatarState = () => client.getQueryState(["avatar", anna.id]);
      const first = renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client });
      // Settled, not merely asked: a second mount while the first read is still
      // in flight would share it and prove nothing.
      await waitFor(() => expect(avatarState()?.status).toBe("error"));
      expect(state.reads).toEqual([anna.id]);
      first.unmount();

      // The next screen's copy of the menu: no request, and the same band.
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client });
      await settle();
      expect(state.reads).toEqual([anna.id]);
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      expect(screen.getByText("Profile photos are not on this gateway yet.")).toHaveClass("user-profile-photo-hint");

      // Nor does anything else that runs a failed query again: an invalidation,
      // or the network coming back.
      await act(() => client.invalidateQueries({ queryKey: ["avatar"] }));
      act(() => {
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });
      await settle();
      expect(state.reads).toEqual([anna.id]);
      expect(screen.getByText("Profile photos are not on this gateway yet.")).toBeVisible();
    });

    it("remembers the undeployed route past a cleared cache, so only a new page asks again", async () => {
      state.readFailure = undeployed(`${anna.id}/avatar`);
      const client = freshClient();
      const first = renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client });
      await waitFor(() => expect(client.getQueryState(["avatar", anna.id])?.status).toBe("error"));
      first.unmount();

      // App.tsx clears the whole cache on a sign-out and on an expired session,
      // and the page goes on. The next person to sign in on it — somebody else,
      // here, so the key is new too — is asked nothing, and gets the same band.
      act(() => client.clear());
      const tom: User = { ...anna, id: "user-tom", login: "tom", displayName: "Tom Berg" };
      const second = renderMenu({ user: tom, loading: false, onLogout: vi.fn() }, { client });
      await settle();
      expect(state.reads).toEqual([anna.id]);
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Tom Berg" }));
      expect(screen.getByText("Profile photos are not on this gateway yet.")).toHaveClass("user-profile-photo-hint");
      expect(screen.queryByRole("button", { name: "Upload a photo" })).not.toBeInTheDocument();
      second.unmount();

      // A reload is a new page with a new query client, and that does ask.
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client: freshClient() });
      await waitFor(() => expect(state.reads).toEqual([anna.id, anna.id]));
    });

    it("asks again on a second mount after an ordinary failure, and draws what it gets", async () => {
      // Any failure but the undeployed route recovers the way it always has: the
      // next mount asks again.
      state.readFailure = Object.assign(new Error("Not Found"), {
        code: "NOT_FOUND",
        status: 404,
        requestId: REQUEST_ID,
      });
      const client = freshClient();
      const first = renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client });
      await waitFor(() => expect(client.getQueryState(["avatar", anna.id])?.status).toBe("error"));
      expect(state.reads).toEqual([anna.id]);
      first.unmount();

      state.readFailure = undefined;
      state.avatarUrl = "https://store.example/face.png?sig=1";
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() }, { client });
      const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });

      await waitFor(() => expect(state.reads).toEqual([anna.id, anna.id]));
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", "https://store.example/face.png?sig=1"));
    });

    it("still says so after the fact when only a write meets the undeployed route", async () => {
      // The fallback for a read that did not see the signature — still in flight
      // when the file was chosen, or a gateway that deploys the read before the
      // writes.
      state.ticketFailure = undeployed("me/avatar/upload-url");
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));
      await waitFor(() => expect(state.reads).toEqual([anna.id]));

      pick(imageFile());

      await waitFor(() =>
        expect(screen.getByText("Profile photos are not on this gateway yet, so nothing was saved.")).toBeVisible(),
      );
      expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
    });

    it("says the photo could not be loaded, with its request id, and offers no Remove, when the read fails otherwise", async () => {
      // A deployed route's own 404, which is what a row pointing at a deleted
      // object answers: the download presign HEADs the object first. The message
      // is not the static-resource one, so this is a failure and not a missing
      // deployment — and a 404 is final, so it is not retried either.
      state.readFailure = Object.assign(new Error("Not Found"), {
        code: "NOT_FOUND",
        status: 404,
        requestId: REQUEST_ID,
      });
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

      const sentence = await screen.findByText("Your photo could not be loaded. Not Found");
      expect(sentence.parentElement).toHaveClass("user-profile-photo-note", "is-error");
      expect(
        within(sentence.parentElement!).getByRole("button", { name: `Copy request id ${REQUEST_ID}` }),
      ).toBeVisible();
      // Only a successful read may say there is a photo to remove (§5.6)…
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
      // …while an upload, which replaces whatever row is there, stays on offer
      // with its limits.
      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled();
      expect(screen.getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
    });

    it("shows only the write refusal, not a second box, when a write is refused after the read already failed", async () => {
      // Both boxes carry the same class and sit one after the other in the
      // band. Before this fix a failed read followed by a refused write drew
      // both at once — two red boxes for one line of text each (art-director,
      // 2026-09-14, 390 dark).
      state.readFailure = Object.assign(new Error("Not Found"), {
        code: "NOT_FOUND",
        status: 404,
        requestId: REQUEST_ID,
      });
      renderMenu({ user: anna, loading: false, onLogout: vi.fn() });
      fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

      await screen.findByText("Your photo could not be loaded. Not Found");
      expect(document.querySelectorAll(".user-profile-photo-note")).toHaveLength(1);

      // A GIF passes the picker on some systems, and this refusal is decided
      // without a request (see "refuses a type outside the allowlist" above).
      pick(imageFile("wave.gif", 32, "image/gif"));

      await waitFor(() =>
        expect(
          screen.getByText("wave.gif is not a type this product accepts. Choose a JPEG, PNG or WebP image."),
        ).toBeVisible(),
      );
      // The newer answer wins: the read failure's box is gone rather than
      // stacked under the write refusal's, so exactly one remains.
      expect(screen.queryByText("Your photo could not be loaded. Not Found")).not.toBeInTheDocument();
      expect(document.querySelectorAll(".user-profile-photo-note")).toHaveLength(1);
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
