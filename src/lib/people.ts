import type { User } from "../domain/types";
import { DELETED_USER } from "./deletedUser";

/**
 * What `Avatar` and every name on the board read for a person.
 *
 * `deleted` is set only by `deletedPerson` — a person the server marked
 * deleted (TAS-529). Such a person is drawn from the mark alone: the UI's own
 * «Deleted user» as `displayName`, no colour, no picture, and `Avatar` draws
 * the neutral circle whatever else it is handed.
 */
export type Person = Pick<User, "id" | "displayName" | "color" | "avatarUrl"> & { deleted?: true };

/** The fields a server-side summary of somebody carries — `UserSummary`, or a watcher row. */
export interface NamedBy {
  displayName: string | null;
  avatarUrl: string | null;
  /** The server's mark for a deleted account (TAS-529); only `true` is one. */
  deleted?: boolean;
}

/**
 * The person a deleted account is drawn as (TAS-529): its id — which is what
 * keeps two such rows apart as React keys and request targets — and nothing
 * the account used to carry. No `color`, so no caller can hand `Avatar` the
 * former fill; `avatarUrl` `null`, so no former picture.
 */
export function deletedPerson(id: string): Person {
  return { id, displayName: DELETED_USER, avatarUrl: null, deleted: true };
}

/**
 * Who `id` is, for drawing: the server's own summary first, then the project's
 * member list, then nobody — and nobody is what the caller prints as
 * "Unknown", exactly as it did before the server named anyone.
 *
 * **A deleted account first, and from the mark alone** (TAS-529,
 * api-contract-guard B2): a summary marked deleted is answered before the
 * member list is so much as looked at, and a member row marked deleted is
 * answered before anything is borrowed from it. The mark is final — an
 * account's id is never reused — so it wins over a name either read carries:
 * no join, fallback or cached row may put a former name, picture or colour on
 * a person the server said is gone. A blank name is never the mark: `""` and
 * `null` stay "not named" below.
 *
 * The server's summary wins because it came with the read being drawn
 * (backend TAS-214). It loses only when it names nobody, and that includes a
 * blank name: the gateway answers `200` with `displayName: ""` when auth-service
 * is down, which is not a name to print. The member list is the fallback rather
 * than a second source because it is a read the board makes anyway, for the
 * assignee chips and the watcher picker, and it is what this UI showed for
 * these people until the server started naming them.
 *
 * The member row still lends its `color` when the summary wins: the summary has
 * none, and a person's circle should not change colour depending on which read
 * named them.
 */
export function personFor(
  id: string | null | undefined,
  named: NamedBy | null | undefined,
  userById: ReadonlyMap<string, Person>,
): Person | undefined {
  if (!id) return undefined;
  if (named?.deleted === true) return deletedPerson(id);
  const member = userById.get(id);
  if (member?.deleted) return deletedPerson(id);
  const displayName = named?.displayName?.trim() ? named.displayName : null;
  if (displayName) {
    return {
      id,
      displayName,
      color: member?.color,
      avatarUrl: named?.avatarUrl ?? member?.avatarUrl ?? null,
    };
  }
  return member;
}
