import { QueryClient, QueryClientProvider, focusManager, onlineManager, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { UserProfileMenu } from "../../components/UserProfileMenu";
import type { ProjectMember, User } from "../../domain/types";
import { keepSignedAvatarLink, ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { SettingsProfileSection } from "./SettingsProfileSection";

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

/**
 * Settings → My profile (TAS-380). The photo controls moved here from the
 * profile menu, and so did their cases (TAS-220): what is pinned is that the
 * face comes from the profile; that a write rewrites the profile and the
 * member rows already in the cache instead of reading every list again; that
 * a refusal happens *before* any request is spent; that a profile carrying no
 * avatar draws initials — quietly for "none", with one unannounced line for a
 * profile read the gateway could not make (`avatarUnavailable`); and, new with
 * the page, the in-flight recipe and the page's own loading and failure.
 *
 * The fake stands in for the four avatar calls and `getCurrentUser` — plus
 * `listMembers`, which a write must *never* cause to be called, and which is
 * here so that a case can prove it. Hoisted because `vi.mock` is.
 */
const { fakeApi, state, reset, release } = vi.hoisted(() => {
  const state: {
    avatarUrl: string | null;
    /**
     * Backend PR #193's flag on the profile: `true` when the gateway's profile
     * read failed, so `avatarUrl: null` means unknown. A write that succeeds
     * puts it back to `false`, as replacing or removing the row does.
     */
    avatarUnavailable: boolean;
    /** A gateway older than TAS-223: the profile with no avatar fields at all. */
    legacyProfile: boolean;
    /** Profile reads, one `"me"` each. */
    reads: string[];
    deletes: number;
    /** Object keys `createAvatarUploadUrl` minted, in order. */
    minted: string[];
    /** Object keys `confirmAvatarUpload` was sent, in order. */
    confirmed: string[];
    /** Member-list reads: what an avatar write that fanned out would spend. */
    memberReads: number;
    ticketFailure?: Error;
    /** Fails the next confirm only, so the retry after it can be watched. */
    confirmFailure?: Error;
    /**
     * The confirm succeeds and the object is gone right after — storage losing
     * it — so every later profile read is a failed one.
     */
    lostAfterConfirm: boolean;
    deleteFailure?: Error;
    confirmedUrl: string;
    /** `false` answers the confirm without its `downloadUrl`. */
    confirmCarriesLink: boolean;
    /** Holds the delete open so the optimistic frame can actually be observed. */
    holdDelete: boolean;
    /** Holds the confirm open so the in-flight frame of an upload can be observed. */
    holdConfirm: boolean;
    /** What `GET /meta` lists as account statuses (TAS-173); `null` for none. */
    userStatuses: { code: string; name: string }[] | null;
    /** `GET /users/me` itself refused. */
    profileFailure?: Error;
    /** Holds the profile read open, so the page's loading state can be watched. */
    holdProfile: boolean;
  } = {
    avatarUrl: null,
    avatarUnavailable: false,
    legacyProfile: false,
    reads: [],
    deletes: 0,
    minted: [],
    confirmed: [],
    memberReads: 0,
    confirmedUrl: "https://store.example/new-face.png?sig=2",
    confirmCarriesLink: true,
    lostAfterConfirm: false,
    holdDelete: false,
    holdConfirm: false,
    userStatuses: null,
    holdProfile: false,
  };

  let releaseHeld: (() => void) | null = null;
  const hold = () => new Promise<void>((resolve) => (releaseHeld = resolve));
  /** Lets a held call finish — and only then does it succeed or fail. */
  const release = () => {
    releaseHeld?.();
    releaseHeld = null;
  };

  const fakeApi = {
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
    getMeta: async () => ({
      issueTypes: null,
      priorities: null,
      linkTypes: null,
      notificationTypes: null,
      userStatuses: state.userStatuses,
    }),
    getCurrentUser: async () => {
      state.reads.push("me");
      if (state.holdProfile) await hold();
      if (state.profileFailure) throw state.profileFailure;
      if (state.legacyProfile) return { ...anna };
      // The avatar's id stays the same while the picture does, as on the
      // server: only the link is signed afresh on every read. A failed profile
      // read carries no avatar at all, whatever the row holds.
      if (state.avatarUnavailable) return { ...anna, avatarUrl: null, avatarId: null, avatarUnavailable: true };
      return {
        ...anna,
        avatarUrl: state.avatarUrl,
        avatarId: state.avatarUrl ? "avatar-1" : null,
        avatarUnavailable: false,
      };
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
      state.avatarUnavailable = state.lostAfterConfirm;
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
      state.avatarUnavailable = false;
    },
    listMembers: async () => {
      state.memberReads += 1;
      return [];
    },
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0, unreadCount: 0 }),
  } as unknown as TaskaApi;

  const reset = () => {
    state.avatarUrl = null;
    state.avatarUnavailable = false;
    state.legacyProfile = false;
    state.reads = [];
    state.deletes = 0;
    state.minted = [];
    state.confirmed = [];
    state.memberReads = 0;
    state.ticketFailure = undefined;
    state.confirmFailure = undefined;
    state.deleteFailure = undefined;
    state.confirmedUrl = "https://store.example/new-face.png?sig=2";
    state.confirmCarriesLink = true;
    state.lostAfterConfirm = false;
    state.holdDelete = false;
    state.holdConfirm = false;
    state.userStatuses = null;
    state.profileFailure = undefined;
    state.holdProfile = false;
    releaseHeld = null;
  };

  return { fakeApi, state, reset, release };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A client with the `["me"]` rule `main.tsx` sets, so the link-keeping is the app's. */
const appClient = () => {
  const client = freshClient();
  client.setQueryDefaults(ME_QUERY_KEY, { structuralSharing: keepSignedAvatarLink });
  return client;
};

/** The menu's trigger fed by the `["me"]` query, as the top bar feeds it: the same face, drawn twice. */
function MenuOnProfile() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => fakeApi.getCurrentUser() });
  return <UserProfileMenu loading={me.isPending} onLogout={() => {}} user={me.data} />;
}

const renderOnProfile = ({ client = appClient(), children }: { client?: QueryClient; children?: ReactNode } = {}) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings/profile"]}>
        <MenuOnProfile />
        <SettingsProfileSection />
        {children}
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Waits for the profile and its controls; answers the menu's trigger, whose circle shows the same face. */
const openOnProfile = async () => {
  const trigger = await screen.findByRole("button", { name: "Open profile for Anna Ivanova" });
  await waitFor(() => expect(trigger).toBeEnabled());
  await screen.findByRole("button", { name: /^(Upload a photo|Replace photo)$/ });
  return trigger;
};

/** The file input the "Upload a photo" button drives. */
const pick = (file: File) => {
  const input = document.querySelector<HTMLInputElement>(".avatar-input");
  if (!input) throw new Error("no avatar input on the page");
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

/** The static-resource 404 a gateway without these routes answers with — how the four avatar routes answered here before they deployed on 2026-09-14. */
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
  const client = appClient();
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

describe("Settings → My profile", () => {
  describe("the profile photo", () => {
    const FACE = "https://store.example/face.png?sig=1";

    it("offers an upload and no removal when the profile says there is no avatar", async () => {
      renderOnProfile();
      await openOnProfile();

      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeVisible();
      // Only a link may say there is a photo to remove (§5.6).
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
      // The initials are what the circle draws instead.
      expect(screen.getAllByLabelText("Anna Ivanova")[0].textContent).toBe("AI");
    });

    it("draws initials and no note when the profile says there is no photo", async () => {
      // `avatar: null, avatarUnavailable: false`: the profile was read and the
      // answer is "none" (backend PR #193). Nothing to explain.
      renderOnProfile();
      await openOnProfile();

      expect(screen.getAllByLabelText("Anna Ivanova")[0].textContent).toBe("AI");
      expect(document.querySelector(".settings-photo .admin-write-failure")).toBeNull();
      expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled();
    });

    it("says the photo could not be loaded when the server reports a failed profile read, and offers only an upload", async () => {
      // `avatar: null, avatarUnavailable: true`: the gateway's profile read
      // failed, so the null is "unknown", not "none". One quiet line, which
      // describes the menu as it opened rather than answering an action — so
      // not a live region — with no request id (a 200, whose id is only in a
      // header the client reads on failures alone), no
      // retry, and no "Remove photo": the server has not said there is a photo.
      state.avatarUnavailable = true;
      renderOnProfile();
      await openOnProfile();

      const note = await screen.findByText("Your photo could not be loaded.");
      expect(note).toBeVisible();
      expect(note).toHaveClass("settings-photo-unavailable");
      expect(note).not.toHaveClass("admin-write-failure");
      expect(note.closest("[aria-live]")).toBeNull();
      expect(note.closest('[role="status"], [role="alert"]')).toBeNull();
      expect(document.querySelector(".settings-photo .admin-write-failure")).toBeNull();
      expect(document.querySelector(".settings-photo-detail")).toBeNull();
      expect(screen.queryByRole("button", { name: /Copy request id/ })).not.toBeInTheDocument();
      // The live region is still there, mounted and empty, for a write's answer
      // — in its own box, which carries none of the note's classes while it is
      // empty, so the stylesheet can take it out of the band's flow.
      const live = document.querySelector(".settings-photo-sentence");
      expect(live).toHaveTextContent("");
      expect(live).toHaveAttribute("aria-live", "polite");
      expect(live?.parentElement).toHaveClass("settings-photo-live");
      expect(live?.parentElement).not.toHaveClass("admin-write-failure");

      expect(screen.getAllByLabelText("Anna Ivanova")[0].textContent).toBe("AI");
      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
      // The flag rode on the one profile read; nothing reads again to check it.
      await settle();
      expect(state.reads).toEqual(["me"]);
    });

    it("draws no note for a gateway that predates the flag", async () => {
      // No `avatar` and no `avatarUnavailable` at all: the server said nothing
      // about a photo, so this menu says nothing either.
      state.legacyProfile = true;
      renderOnProfile();
      await openOnProfile();

      expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled();
      expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    });

    it("does not write a flag the gateway never sent, on an upload or on a removal", async () => {
      // A profile from a gateway older than backend PR #193 carries no
      // `avatarUnavailable` at all, and absent is not coerced (TaskaApi): the
      // writes clear a flag that is there, and leave a missing one missing.
      state.legacyProfile = true;
      const client = appClient();
      renderOnProfile({ client });
      const trigger = await openOnProfile();
      expect(client.getQueryData<User>(["me"])).not.toHaveProperty("avatarUnavailable");

      pick(imageFile());

      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl));
      expect(client.getQueryData<User>(["me"])).toMatchObject({ avatarUrl: state.confirmedUrl, avatarId: "avatar-1" });
      expect(client.getQueryData<User>(["me"])).not.toHaveProperty("avatarUnavailable");

      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

      await waitFor(() => expect(state.deletes).toBe(1));
      await waitFor(() => expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled());
      expect(client.getQueryData<User>(["me"])).toMatchObject({ avatarUrl: null, avatarId: null });
      expect(client.getQueryData<User>(["me"])).not.toHaveProperty("avatarUnavailable");
      // Neither write read the profile again to find out.
      await settle();
      expect(state.reads).toEqual(["me"]);
    });

    it("lets the note yield to a write's answer", async () => {
      // Two boxes about the photo, one stale and one fresh, would be two
      // answers to one question; the newer one wins (§4.16).
      state.avatarUnavailable = true;
      state.ticketFailure = Object.assign(new Error("Storage service unavailable"), {
        code: "UNAVAILABLE",
        status: 503,
      });
      renderOnProfile();
      await openOnProfile();
      expect(await screen.findByText("Your photo could not be loaded.")).toBeVisible();

      pick(imageFile());

      await waitFor(() => expect(screen.getByText("Your photo was not saved. Storage service unavailable")).toBeVisible());
      expect(screen.queryByText("Your photo could not be loaded.")).not.toBeInTheDocument();
      // The refusal fills the same mounted region, whose box now carries the
      // note's classes and so is laid out in flow.
      const sentence = screen.getByText("Your photo was not saved. Storage service unavailable");
      expect(sentence).toHaveAttribute("aria-live", "polite");
      expect(sentence.parentElement).toHaveClass("settings-photo-live", "admin-write-failure");
    });

    it("hides the note while an upload is in flight, and an upload that lands clears it", async () => {
      state.avatarUnavailable = true;
      state.holdConfirm = true;
      const client = appClient();
      renderOnProfile({ client });
      const trigger = await openOnProfile();
      expect(await screen.findByText("Your photo could not be loaded.")).toBeVisible();

      pick(imageFile());

      await waitFor(() => expect(screen.getByText("Uploading…")).toBeVisible());
      expect(screen.queryByText("Your photo could not be loaded.")).not.toBeInTheDocument();

      release();

      // The upload replaced the row, so the read that was failing is over: the
      // picture is drawn, "Remove photo" is offered, and the note stays gone.
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl));
      expect(client.getQueryData<User>(["me"])).toMatchObject({ avatarUrl: state.confirmedUrl, avatarUnavailable: false });
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeEnabled());
      expect(screen.queryByText("Your photo could not be loaded.")).not.toBeInTheDocument();
      await settle();
      expect(state.reads).toEqual(["me"]);
    });

    it("does not write an unknown face onto the member rows when the re-read reports a failed profile read", async () => {
      // The confirm answered without a link, so the profile is read again — and
      // that read failed (`avatarUnavailable: true`). Its `null` is "unknown":
      // writing it onto the member rows would state "no photo" there.
      state.avatarUrl = FACE;
      state.confirmCarriesLink = false;
      state.lostAfterConfirm = true;
      const client = seededClient(FACE);
      renderOnProfile({ client, children: <MemberFaceHolders /> });
      await openOnProfile();

      pick(imageFile());

      await waitFor(() => expect(state.reads).toEqual(["me", "me"]));
      expect(await screen.findByText("Your photo could not be loaded.")).toBeVisible();
      await settle();
      expect(faceIn(client, anna.id)).toEqual({ members: FACE, summary: FACE });
      expect(state.memberReads).toBe(0);
    });

    it("states the enforced ceiling and the accepted types before a file is chosen", async () => {
      renderOnProfile();
      await openOnProfile();

      // 2 MB — the number the schema declares and auth-service enforces, which
      // agree since backend TAS-222. The schema used to say 5 MB, and offering
      // that would have offered a file the product refused a layer deeper.
      expect(screen.getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
      expect(document.querySelector(".avatar-input")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    });

    it("runs the three legs and replaces the initials with what came back, without reading the profile again", async () => {
      const client = appClient();
      renderOnProfile({ client });
      const trigger = await openOnProfile();

      pick(imageFile());

      await waitFor(() => expect(trigger.querySelector("img")).not.toBeNull());
      expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl);
      // Written onto the profile, with the id that tells a re-signed link from
      // a new picture, and the flag a read of the replaced row would carry.
      expect(client.getQueryData<User>(["me"])).toMatchObject({
        avatarUrl: state.confirmedUrl,
        avatarId: "avatar-1",
        avatarUnavailable: false,
      });
      await waitFor(() => expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled());
      // The confirm answered with the link, so nothing re-reads to find it.
      await settle();
      expect(state.reads).toEqual(["me"]);
    });

    it("keeps the button's own label while an upload is in flight, and says so on the hint line", async () => {
      state.holdConfirm = true;
      renderOnProfile();
      await openOnProfile();
      const button = screen.getByRole("button", { name: "Upload a photo" });

      pick(imageFile());

      // One word for all three legs, on the line under the controls. The label
      // the reader pressed stays as it was, so neither button changes width and
      // "Remove photo" beside it never moves.
      await waitFor(() => expect(screen.getByText("Uploading…")).toBeVisible());
      expect(screen.getByText("Uploading…")).toHaveClass("settings-photo-hint");
      expect(button).toHaveTextContent("Upload a photo");
      // §4.1's in-flight recipe (ruling 4): `aria-disabled`, not `disabled`,
      // so the button keeps focus and a second press is refused by the handler.
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toBeEnabled();
      expect(screen.queryByText("Up to 2 MB. JPEG, PNG or WebP.")).not.toBeInTheDocument();

      release();

      await waitFor(() => expect(screen.getByRole("button", { name: "Replace photo" })).toBeEnabled());
      expect(screen.getByText("Up to 2 MB. JPEG, PNG or WebP.")).toBeVisible();
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
    });

    it("writes the new face into every cached member row, without reading a member list again", async () => {
      const client = seededClient(null);
      const failedSummary = client.getQueryData(["project-summaries", OTHER_PROJECT]);
      renderOnProfile({ client, children: <MemberFaceHolders /> });
      const trigger = await openOnProfile();

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
      expect(state.reads).toEqual(["me"]);
      // Only the reader's row moved: a neighbour keeps their face, a summary keeps
      // its count, and a card whose member half had failed is left exactly as it
      // was rather than given a list.
      expect(faceIn(client, "user-tom")).toEqual({ members: TOM_FACE, summary: TOM_FACE });
      expect(client.getQueryData(["project-summaries", PROJECT])).toMatchObject({ count: 9, failure: null });
      expect(client.getQueryData(["project-summaries", OTHER_PROJECT])).toBe(failedSummary);
    });

    it("re-reads the profile only when the confirm answered without a link", async () => {
      state.confirmCarriesLink = false;
      const client = seededClient(null);
      renderOnProfile({ client, children: <MemberFaceHolders /> });
      const trigger = await openOnProfile();

      pick(imageFile());

      // The one case that costs a read, and it is the profile again, which
      // states the avatar: the answer did not say where the picture is.
      await waitFor(() => expect(state.reads).toEqual(["me", "me"]));
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", state.confirmedUrl));
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: state.confirmedUrl, summary: state.confirmedUrl }));
      await settle();
      expect(state.memberReads).toBe(0);
    });

    it("takes the face off the profile and every cached member row at once on Remove, without reading anything again", async () => {
      state.avatarUrl = FACE;
      const client = seededClient(FACE);
      renderOnProfile({ client, children: <MemberFaceHolders /> });
      const trigger = await openOnProfile();
      await waitFor(() => expect(screen.getByRole("button", { name: "Remove photo" })).toBeVisible());

      // Held open, because the frame being asserted is the one *between* the
      // press and the answer: without this the answer lands in the same batch
      // as the optimistic patch and a passing test would prove nothing.
      state.holdDelete = true;
      fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: null, summary: null }));
      expect(trigger.querySelector("img")).toBeNull();
      expect(client.getQueryData<User>(["me"])).toMatchObject({ avatarUrl: null, avatarId: null, avatarUnavailable: false });

      release();

      await waitFor(() => expect(state.deletes).toBe(1));
      await waitFor(() => expect(screen.getByRole("button", { name: "Upload a photo" })).toBeEnabled());
      await settle();
      expect(faceIn(client, anna.id)).toEqual({ members: null, summary: null });
      expect(faceIn(client, "user-tom")).toEqual({ members: TOM_FACE, summary: TOM_FACE });
      expect(state.memberReads).toBe(0);
      expect(state.reads).toEqual(["me"]);
    });

    it("puts the face back on the menu and on every cached member row when the server refuses the removal", async () => {
      state.avatarUrl = FACE;
      const client = seededClient(FACE);
      renderOnProfile({ client, children: <MemberFaceHolders /> });
      const trigger = await openOnProfile();
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
      await waitFor(() => expect(trigger.querySelector("img")).toHaveAttribute("src", FACE));
      await waitFor(() => expect(faceIn(client, anna.id)).toEqual({ members: FACE, summary: FACE }));
      expect(screen.getByText(/Your photo was not removed\. Something went wrong/)).toBeVisible();
      await settle();
      expect(state.deletes).toBe(1);
      expect(state.memberReads).toBe(0);
      expect(state.reads).toEqual(["me"]);
    });

    it("never confirms one object key twice: choosing the photo again after a failed confirm starts a new ticket", async () => {
      // A repeat is harmless on the server since backend PR #198, and still not
      // this menu's to send: the retry is the person choosing the file again,
      // which mints a new key — there is no retry-confirm control.
      state.confirmFailure = Object.assign(new Error("The avatar could not be recorded. Please try again."), {
        code: "UNAVAILABLE",
        status: 503,
      });
      renderOnProfile();
      const trigger = await openOnProfile();

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
      renderOnProfile();
      await openOnProfile();

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
      renderOnProfile();
      await openOnProfile();

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
      renderOnProfile();
      await openOnProfile();

      pick(imageFile());

      const sentence = await screen.findByText("Your photo was not saved. Storage service unavailable");
      const detail = sentence.parentElement!.querySelector(".settings-photo-detail");
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

    it("says so when a write meets a gateway without the avatar routes", async () => {
      // Spring's static-resource 404, which is how the avatar routes answered
      // before they deployed on 2026-09-14 — read on the write, the only avatar
      // call this menu still makes.
      state.ticketFailure = undeployed("me/avatar/upload-url");
      renderOnProfile();
      await openOnProfile();

      pick(imageFile());

      await waitFor(() =>
        expect(screen.getByText("Profile photos are not on this gateway yet, so nothing was saved.")).toBeVisible(),
      );
      expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
    });

    it("holds both buttons aria-disabled while an upload is out, keeps focus on the one pressed, and refuses a second press", async () => {
      state.avatarUrl = FACE;
      state.holdConfirm = true;
      renderOnProfile();
      await openOnProfile();
      const replace = screen.getByRole("button", { name: "Replace photo" });
      const remove = screen.getByRole("button", { name: "Remove photo" });
      replace.focus();

      pick(imageFile());
      await waitFor(() => expect(replace).toHaveAttribute("aria-disabled", "true"));
      expect(remove).toHaveAttribute("aria-disabled", "true");
      expect(replace).toHaveFocus();
      // Both labels unchanged, and nothing the reader presses now starts anything.
      expect(remove).toHaveTextContent("Remove photo");
      fireEvent.click(remove);
      expect(state.deletes).toBe(0);
      expect(state.minted).toEqual(["obj-1"]);

      release();
      await waitFor(() => expect(replace).not.toHaveAttribute("aria-disabled"));
      expect(replace).toHaveFocus();
    });

    it("moves focus to Upload when Remove takes its own button away", async () => {
      state.avatarUrl = FACE;
      renderOnProfile();
      await openOnProfile();
      const remove = screen.getByRole("button", { name: "Remove photo" });
      remove.focus();

      fireEvent.click(remove);

      await waitFor(() => expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Upload a photo" })).toHaveFocus();
    });

    it("draws the profile's shape while it loads, with no controls and no spinner", async () => {
      state.holdProfile = true;
      renderOnProfile();

      const status = await screen.findByRole("status", { name: "" });
      expect(status).toHaveTextContent("Loading your profile");
      const pending = document.querySelector(".settings-profile.is-skeleton");
      expect(pending).toHaveAttribute("aria-busy", "true");
      expect(pending?.querySelector(".avatar-xl.avatar-loading")).not.toBeNull();
      expect(pending?.querySelectorAll(".value-skeleton")).toHaveLength(5);
      expect(screen.queryByRole("button", { name: /photo/ })).not.toBeInTheDocument();

      release();
      expect(await screen.findByRole("button", { name: "Upload a photo" })).toBeVisible();
      expect(document.querySelector(".is-skeleton")).toBeNull();
    });

    it("says the profile could not be loaded, with the server's words and the id, and offers no controls", async () => {
      state.profileFailure = Object.assign(new Error("Auth service unavailable"), {
        code: "UNAVAILABLE",
        status: 503,
        requestId: REQUEST_ID,
      });
      renderOnProfile();

      const sentence = await screen.findByText("Your profile could not be loaded.");
      // A state found on arrival, not an answer to anything done: not announced.
      expect(sentence.closest("[aria-live], [role='alert'], [role='status']")).toBeNull();
      expect(screen.getByText("Auth service unavailable")).toBeVisible();
      expect(screen.getByRole("button", { name: `Copy request id ${REQUEST_ID}` })).toBeVisible();
      expect(screen.queryByRole("button", { name: /photo/ })).not.toBeInTheDocument();
    });

    it("lists the email, the status and the role read-only, without repeating the name", async () => {
      renderOnProfile();
      await openOnProfile();

      const details = document.querySelector<HTMLElement>(".settings-details")!;
      const pairs = [...details.querySelectorAll("div")].map((row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ]);
      expect(pairs).toEqual([
        ["Email", "anna@example.com"],
        ["Status", "Active"],
      ]);
      expect(details.querySelector("input, textarea, select")).toBeNull();
      expect(within(details).queryByText("Anna Ivanova")).toBeNull();
      expect(screen.getByText("@anna")).toBeVisible();
    });
  });
});
