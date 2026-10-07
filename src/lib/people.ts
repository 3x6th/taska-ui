import type { User } from "../domain/types";

/** What `Avatar` and every name on the board read for a person. */
export type Person = Pick<User, "id" | "displayName" | "color" | "avatarUrl">;

/** The two fields a server-side summary of somebody carries — `UserSummary`, or a watcher row. */
export interface NamedBy {
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Who `id` is, for drawing: the server's own summary first, then the project's
 * member list, then nobody — and nobody is what the caller prints as
 * "Unknown", exactly as it did before the server named anyone.
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
  const member = userById.get(id);
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
