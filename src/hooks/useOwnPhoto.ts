import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";
import { taskaApi } from "../api/client";
import { AVATAR_ACCEPTED_SUMMARY, AVATAR_MAX_SIZE_BYTES, avatarRefusalKind, type AvatarRefusalKind } from "../api/avatars";
import { apiErrorFacts, isUndeployedRoute } from "../api/errors";
import { objectStoreUploadFailure } from "../api/objectStore";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../api/TaskaApi";
import type { Board, BoardIssue, ProjectContext, ProjectMember, ProjectStats, User } from "../domain/types";
import { PROJECT_STATS_KEY } from "../lib/boardQuery";
import { formatFileSize } from "../lib/format";
import { ME_QUERY_KEY } from "../lib/ownAvatarLink";

/**
 * What the photo controls say about a write. Every sentence is a refusal: an
 * upload that lands is reported by the face it draws, and a removal by the
 * initials coming back (the contract calls the delete idempotent, so "your
 * photo was removed" is a sentence this client cannot stand behind).
 */
export interface PhotoNotice {
  text: string;
  /**
   * The failure behind the sentence, kept for its request id (§5.6). The
   * sentence already quotes whatever the server said, so the id is the one
   * thing the error still has to add.
   */
  error?: unknown;
}

/**
 * One cached shape that draws the reader's face from a row the server sent: how
 * to find the face the reader's row carries in it, and how to write a new one
 * over every such row. Each family is read and written by its own pair, because
 * the four hold people in four different places.
 */
interface FaceFamily<T> {
  queryKey: QueryKey;
  /** The face on the reader's first named row in `data`, or `NO_ROW` when no row there is theirs. */
  faceIn: (data: T, userId: string) => string | null | undefined | typeof NO_ROW;
  /**
   * `data` with every named row of the reader's showing `avatarUrl` — or
   * `undefined` when nothing would change, which `setQueryData` reads as
   * "leave this query alone". A list the reader is not on and a row that
   * already shows this face are therefore not touched at all, rather than
   * rewritten with themselves and marked fresh.
   */
  withFace: (data: T, userId: string, avatarUrl: string | null | undefined) => T | undefined;
}

const NO_ROW = Symbol("no row of the reader's");

/** The reader's named row in a member list, rewritten; the same array when nothing changed. */
function membersWithFace(members: ProjectMember[], userId: string, avatarUrl: string | null | undefined) {
  let changed = false;
  const next = members.map((member) => {
    if (member.userId !== userId || !member.user || member.user.avatarUrl === avatarUrl) return member;
    changed = true;
    return { ...member, user: { ...member.user, avatarUrl } };
  });
  return changed ? next : members;
}

function memberFaceIn(members: ProjectMember[], userId: string) {
  const row = members.find((member) => member.userId === userId && member.user);
  return row?.user ? row.user.avatarUrl : NO_ROW;
}

/** The members dialog's `["members", projectId]`: the list itself. */
const membersFamily: FaceFamily<ProjectMember[]> = {
  queryKey: ["members"],
  faceIn: memberFaceIn,
  withFace: (members, userId, avatarUrl) => {
    const next = membersWithFace(members, userId, avatarUrl);
    return next === members ? undefined : next;
  },
};

/** The board's `["project-context", projectId]` (TAS-251): the list under `members`. */
const contextFamily: FaceFamily<ProjectContext> = {
  queryKey: ["project-context"],
  faceIn: (context, userId) => memberFaceIn(context.members, userId),
  withFace: (context, userId, avatarUrl) => {
    const members = membersWithFace(context.members, userId, avatarUrl);
    return members === context.members ? undefined : { ...context, members };
  },
};

/** The project cards' `["project-stats"]` (TAS-202): a five-person preview under every entry. */
const statsFamily: FaceFamily<ProjectStats[]> = {
  queryKey: PROJECT_STATS_KEY,
  faceIn: (entries, userId) => {
    for (const entry of entries) {
      const face = memberFaceIn(entry.members, userId);
      if (face !== NO_ROW) return face;
    }
    return NO_ROW;
  },
  withFace: (entries, userId, avatarUrl) => {
    let changed = false;
    const next = entries.map((entry) => {
      const members = membersWithFace(entry.members, userId, avatarUrl);
      if (members === entry.members) return entry;
      changed = true;
      return { ...entry, members };
    });
    return changed ? next : undefined;
  },
};

/**
 * The board's `["board", projectId]` (TAS-202): the assignee the server joined
 * into every card. Only an assignee the server named — a card whose
 * `displayName` is `null` draws nobody's face, and gets none here.
 */
const boardFamily: FaceFamily<Board> = {
  queryKey: ["board"],
  faceIn: (board, userId) => {
    const cards = [...board.columns.flatMap((column) => column.issues), ...board.unplacedIssues];
    const card = cards.find((issue) => issue.assignee?.id === userId && issue.assignee.displayName !== null);
    return card?.assignee ? card.assignee.avatarUrl : NO_ROW;
  },
  withFace: (board, userId, avatarUrl) => {
    let changed = false;
    const withCard = (issue: BoardIssue): BoardIssue => {
      const assignee = issue.assignee;
      if (!assignee || assignee.id !== userId || assignee.displayName === null) return issue;
      if (assignee.avatarUrl === (avatarUrl ?? null)) return issue;
      changed = true;
      return { ...issue, assignee: { ...assignee, avatarUrl: avatarUrl ?? null } };
    };
    const next: Board = {
      ...board,
      columns: board.columns.map((column) => ({ ...column, issues: column.issues.map(withCard) })),
      unplacedIssues: board.unplacedIssues.map(withCard),
    };
    return changed ? next : undefined;
  },
};

const FACE_FAMILIES = [membersFamily, contextFamily, statsFamily, boardFamily] as readonly FaceFamily<unknown>[];

/** One cache the reader's rows were rewritten in, the family that reads it, and the face it carried before. */
interface OwnFaceWrite {
  queryKey: QueryKey;
  family: FaceFamily<unknown>;
  avatarUrl: string | null | undefined;
}

/**
 * The reader's own photo, written (TAS-220): the three-leg upload and the
 * optimistic remove. Moved out of the profile menu with TAS-380, when the
 * controls moved to Settings → My profile; the logic, the cache writes and
 * every sentence are unchanged.
 *
 * Your own face, so no role decides any of this: a VIEWER of every project in
 * the product still owns it. The server is still the authority — all four
 * routes are authenticated — but there is no permission here to mirror.
 *
 * `user` is the profile the controls are drawn for; the member rows the cache
 * holds for that id are rewritten along with `["me"]`.
 */
export function useOwnPhoto(user: User | undefined) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<PhotoNotice | null>(null);

  /**
   * Optimistic with rollback, unlike the upload below it, and the asymmetry is
   * the same one the attachments panel draws: a delete is a single call whose
   * outcome the client can predict, so the circle goes back to initials at
   * once — here and on every member row the cache holds for this person. An
   * upload is three legs, one of them to a server that is not Taska, and its
   * outcome is genuinely unknown until it lands.
   *
   * Nothing is read again afterwards, on either outcome. Success leaves exactly
   * what was written, and a refusal puts back exactly what was there.
   */
  const remove = useMutation({
    mutationFn: () => taskaApi.deleteMyAvatar(),
    onMutate: async () => {
      setNotice(null);
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<User>(ME_QUERY_KEY);
      // `avatarUnavailable: false` is the answer the next read gives once the
      // row is gone: the profile reads, and says "none". Written only over a
      // flag the gateway actually sent — a gateway older than backend PR #193
      // sends none, and absent is not coerced into `false` (TaskaApi).
      queryClient.setQueryData<User>(ME_QUERY_KEY, (me) =>
        me
          ? {
              ...me,
              avatarUrl: null,
              avatarId: null,
              ...(me.avatarUnavailable === undefined ? {} : { avatarUnavailable: false }),
            }
          : me,
      );
      const faces = user ? await writeOwnFace(queryClient, user.id, null) : [];
      return { previous, faces };
    },
    onError: (error, _variables, context) => {
      // Back to the profile as it was — but only onto the same account, so a
      // refusal that lands after a sign-out cannot write the old face back.
      if (context?.previous) {
        const previous = context.previous;
        queryClient.setQueryData<User>(ME_QUERY_KEY, (me) => (me?.id === previous.id ? previous : me));
      }
      if (user && context) restoreOwnFaces(queryClient, user.id, context.faces);
      setNotice({ text: writeFailureText(error, "removed"), error });
    },
  });

  /**
   * The whole upload, written out rather than wrapped in a mutation, because
   * each leg fails differently and the sentence has to name the leg: the
   * gateway would not sign it, the *store* would not take the bytes, or the
   * gateway would not record it.
   *
   * Deliberately **not** optimistic, which is the one place this feature steps
   * away from the repository's default. There is no local state to roll back to
   * or from — the picture is a file the browser has, not a field — and the
   * middle leg goes to a server this app does not control, so a face shown
   * before the confirm would be a claim about a bucket nobody has written to
   * yet. The attachments panel makes the same call for the same choreography.
   * What the reader gets instead is one word of progress on the line under the
   * controls, while the button they pressed keeps its own label.
   */
  const upload = async (file: File) => {
    setNotice(null);
    const candidate = { fileName: file.name, contentType: file.type, sizeBytes: file.size };

    // The picker's `accept` filters by the operating system's idea of a type
    // and `File.type` is the browser's, so this is not a duplicate of it — and
    // both refusals here are decidable without a request, which is why neither
    // ever becomes one.
    const refusal = avatarRefusalKind(candidate);
    if (refusal) {
      setNotice({ text: refusalText(refusal, file) });
      return;
    }

    setUploading(true);
    let ticket;
    try {
      // Leg 1, and the moment the fifteen-minute clock starts — which is why it
      // is asked for when the file is chosen rather than when the page opens.
      ticket = await taskaApi.createAvatarUploadUrl(candidate);
    } catch (error) {
      setUploading(false);
      setNotice({ text: writeFailureText(error, "saved"), error });
      return;
    }

    try {
      // Leg 2. `candidate.contentType` and not `file.type` re-read — the same
      // value today, but this is the one place where sending something even
      // slightly different from what was signed is a 403 nobody can diagnose.
      await taskaApi.putAvatarBytes(ticket.uploadUrl, file, candidate.contentType);
    } catch (error) {
      setUploading(false);
      setNotice({ text: uploadFailureText(error), error });
      return;
    }

    let saved;
    try {
      // Leg 3, sent once per ticket. Since backend PR #198 a repeat of the key
      // the saved row holds is harmless — the server hands that row back
      // unchanged (see `confirmAvatarUpload` on TaskaApi) — but nothing retries
      // here all the same: the person choosing the file again is the retry,
      // and that mints a new ticket and a new key.
      saved = await taskaApi.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: candidate.contentType,
      });
    } catch (error) {
      setUploading(false);
      setNotice({ text: writeFailureText(error, "saved"), error });
      return;
    }

    if (saved.downloadUrl) {
      // The confirm answers with the link and the avatar's id, so the new face
      // goes on screen without a follow-up read — on the profile, and on every
      // member row the cache already holds for this person. The upload
      // replaced the row, so a failed read the profile reported before is
      // over: the presign that just succeeded is the one that was failing.
      // The flag is cleared only where the gateway sent one; absent stays
      // absent, as on the remove path.
      const link = saved.downloadUrl;
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      queryClient.setQueryData<User>(ME_QUERY_KEY, (me) =>
        me
          ? {
              ...me,
              avatarUrl: link,
              avatarId: saved.id,
              ...(me.avatarUnavailable === undefined ? {} : { avatarUnavailable: false }),
            }
          : me,
      );
      if (user) await writeOwnFace(queryClient, user.id, link);
    } else {
      // An answer that carried no link is the one case that costs a read: the
      // profile again, which states the avatar since TAS-223. Whatever it says
      // is then written to the member rows the same way a link from the confirm
      // would have been. A re-read that fails leaves them as they were, and so
      // does one that answers `avatarUnavailable: true`: its `null` is
      // "unknown", and writing it onto the rows would state "no photo".
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const reread = queryClient.getQueryState<User>(ME_QUERY_KEY);
      if (
        user &&
        reread?.status === "success" &&
        reread.data?.avatarUrl !== undefined &&
        reread.data.avatarUnavailable !== true
      ) {
        await writeOwnFace(queryClient, user.id, reread.data.avatarUrl);
      }
    }
    setUploading(false);
  };

  return {
    /** One of the three legs is out. */
    uploading,
    /** Either write is out: the §4.1 in-flight window of both buttons. */
    writing: uploading || remove.isPending,
    /** The refusal to show, or `null`. */
    notice,
    upload,
    remove: () => remove.mutate(),
  };
}

/**
 * Writes `avatarUrl` onto the reader's own rows in every cached list that draws
 * them — the member lists, the board's context, the project cards' stats and
 * the board's cards — and answers with what each of those caches carried
 * before, so a refusal can put it back.
 *
 * **A cache write and not an invalidation**, and the cost is the reason.
 * Invalidating `["project-stats"]` on `/projects` and `["board", …]` behind a
 * board re-reads whole screens to change one face on a write the reader made
 * themselves. Everything the rows need is already in hand: the confirm's
 * `downloadUrl` for an upload, `null` for a removal.
 *
 * Reads already in flight for these lists are cancelled first, so one that left
 * before the write cannot land after it and draw the old face — but only for a
 * list that already holds data. Cancelling a *first* read reverts it to nothing
 * and leaves it idle, which would strand a board still loading its members; a
 * list with no data has no row to rewrite anyway, and its own answer is the one
 * it should draw.
 */
async function writeOwnFace(
  queryClient: QueryClient,
  userId: string,
  avatarUrl: string | null,
): Promise<OwnFaceWrite[]> {
  const before: OwnFaceWrite[] = [];
  for (const family of FACE_FAMILIES) {
    await queryClient.cancelQueries({ queryKey: family.queryKey, predicate: (query) => query.state.data !== undefined });
    for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: family.queryKey })) {
      if (data === undefined) continue;
      const face = family.faceIn(data, userId);
      if (face !== NO_ROW && face !== avatarUrl) before.push({ queryKey, family, avatarUrl: face });
    }
    queryClient.setQueriesData({ queryKey: family.queryKey }, (data: unknown) =>
      data === undefined ? undefined : family.withFace(data, userId, avatarUrl),
    );
  }
  return before;
}

/**
 * Puts back what `writeOwnFace` replaced: the reader's face in each cache it
 * changed, and nothing else — so a cache that has been refreshed since keeps
 * everything its newer answer brought.
 */
function restoreOwnFaces(queryClient: QueryClient, userId: string, before: OwnFaceWrite[]) {
  for (const { queryKey, family, avatarUrl } of before) {
    queryClient.setQueryData(queryKey, (data: unknown) =>
      data === undefined ? undefined : family.withFace(data, userId, avatarUrl),
    );
  }
}

/**
 * Why this file cannot be a photo, in the reader's terms rather than the
 * server's. The API layer throws `S3StorageClient.validateFileParams`'s own
 * sentence so a mock refusal and a gateway refusal read alike; neither of these
 * two arms ever travels over the wire, and a person holding an image is owed
 * its name and a size they can compare with the limit stated just above.
 */
function refusalText(kind: AvatarRefusalKind, file: File) {
  if (kind === "type") {
    return `${file.name} is not a type this product accepts. Choose a ${AVATAR_ACCEPTED_SUMMARY} image.`;
  }
  if (kind === "empty") {
    return `${file.name} is empty, so there is nothing to upload.`;
  }
  const size = formatFileSize(file.size);
  const ceiling = formatFileSize(AVATAR_MAX_SIZE_BYTES);
  return size === ceiling
    ? `${file.name} is just over ${ceiling}, which is the largest photo this product accepts.`
    : `${file.name} is ${size}. The largest photo this product accepts is ${ceiling}.`;
}

/**
 * What to say when the **gateway** refused — leg 1, leg 3, or the delete.
 *
 * The undeployed arm is for a gateway without the avatar write routes, which
 * answers Spring's static-resource 404: without it the page would print "No
 * static resource /api/v1/users/me/avatar/upload-url" at somebody who did
 * nothing wrong. `EditProjectModal` reads the same predicate for the same
 * reason (TAS-148).
 */
function writeFailureText(error: unknown, verb: "saved" | "removed") {
  if (isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)) {
    return `Profile photos are not on this gateway yet, so nothing was ${verb}.`;
  }
  const message = apiErrorFacts(error).message;
  return verb === "saved"
    ? `Your photo was not saved. ${message ?? "The gateway refused it."}`
    : `Your photo was not removed. ${message ?? "The gateway refused it."}`;
}

/**
 * What to say when the **middle** leg failed — the PUT that goes straight to
 * the object store and never reaches Taska. Four genuinely different problems,
 * the same four the attachments panel names, and reading them as one "upload
 * failed" is what this exists to prevent.
 */
function uploadFailureText(error: unknown) {
  const failure = objectStoreUploadFailure(error);
  if (!failure) {
    return `Your photo was not uploaded. ${apiErrorFacts(error).message ?? "The upload failed."}`;
  }
  if (failure.kind === "unusable") {
    return "Your photo was not uploaded: the upload link that came back was unusable, so nothing was sent. Choose the photo again to retry.";
  }
  if (failure.kind === "blocked") {
    return "Your photo was not uploaded: the browser could not reach the file store. This upload goes straight to storage rather than through Taska, so a network problem or the storage server's cross-origin rules can stop it before it starts.";
  }
  if (failure.kind === "expired") {
    return "Your photo was not uploaded: the file store would not accept the upload link. A link lasts 15 minutes from the moment the photo is chosen — choose it again to retry.";
  }
  return `Your photo was not uploaded: the file store answered ${failure.storeStatus}.`;
}
