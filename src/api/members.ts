import type { ProjectRole } from "../domain/types";

/**
 * The three project member writes (TAS-158) — `POST /projects/{projectId}/members`,
 * `PATCH` and `DELETE /projects/{projectId}/members/{userId}` — and the one rule
 * every implementation applies to them before a request leaves.
 *
 * Kept out of `TaskaApi.ts` for the reason `attachments.ts` and `avatars.ts`
 * are: the guard is shared by `MockTaskaApi` and `RestTaskaApi` and read by the
 * members panel, and a constant living in one implementation would make the
 * other one import it from a sibling it has no business knowing about.
 */

/**
 * The roles a member write may state, in the contract's own order —
 * `enum: [ADMIN, MEMBER, VIEWER]` on both `AddProjectMemberRequestDto.role` and
 * `ChangeProjectMemberRoleRequestDto.role`.
 *
 * Closed, and closed on the wire too: the gateway decodes `role` into its
 * generated `RoleEnum` under `@Valid`/`@NotNull`, so any other value, or none,
 * is `400 INVALID_ARGUMENT` "Invalid request parameters" from
 * `GatewayValidationExceptionHandler` before project-service is asked (read at
 * backend `develop` `1cfe4d79f074`, not measured).
 */
export const PROJECT_ROLES: readonly ProjectRole[] = ["ADMIN", "MEMBER", "VIEWER"];

/**
 * A user id in the spelling the gateway hands them out in: 32 hexadecimal
 * digits in groups of 8-4-4-4-12. Case-insensitive, because an upper-case id
 * names the same person — the server parses it into the same UUID and stores
 * the lower-case form.
 *
 * **Stricter than the server, on purpose.** project-service parses the id with
 * Java's `UUID.fromString` (`GrpcRequestValidators.parseUuidOrInvalidArgument`,
 * read at backend `develop` `1cfe4d79f074`), which rejects a padded or a
 * braced id but accepts short groups: `1-1-1-1-1` parses as
 * `00000001-0001-0001-0001-000000000001` (measured with a local JDK 25; the
 * backend builds for 21). Nobody holds an id in that spelling — every id this
 * product has ever been shown came out of the server in the canonical form — so
 * accepting it would only let a typo reach the wire and be stored as a member
 * whose id matches nothing anyone typed.
 */
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

/**
 * The id as the server will store it: trimmed, because a pasted id arrives with
 * whitespace around it far more often than without, and lower-cased, because
 * that is the form every member row comes back in. Comparing a typed id with the
 * member list is only meaningful after this.
 *
 * The UI calls it; the implementations do not. An API layer that quietly
 * repaired its input would make a padded id succeed through `TaskaApi` while the
 * same id sent by any other client is a 400 — the refusal below is the honest
 * shape for a caller that did not normalise.
 */
export function normalizeUserId(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * What every implementation says when a member write names an id that is not
 * one — before the request, identically, so a caller cannot tell mock from
 * rest by the refusal.
 *
 * **This build's wording, not the gateway's.** The server has a sentence of its
 * own — `body.addedMemberId must be a valid UUID`, with `changedMemberId` and
 * `deletedMemberId` on the other two routes — but it is only ever said about an
 * id the pattern above has already refused, so reproducing it here would put
 * the server's words on a refusal the server did not make.
 */
export const MEMBER_USER_ID_REFUSAL_MESSAGE = "A user ID is 32 hexadecimal digits in groups of 8-4-4-4-12";
