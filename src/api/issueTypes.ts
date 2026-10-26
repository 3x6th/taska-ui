import type { IssueTypeColor, IssueTypeIcon, ProjectIssueType } from "../domain/types";

/**
 * A project's issue-type registry as every implementation of `TaskaApi` has to
 * treat it (backend #212 TAS-385, #226 TAS-386; contract at develop
 * `af41c322`): the closed colour and icon sets, the key's pattern, the server's
 * sentences, and how an answer is read.
 *
 * Written once for the reason src/api/issuePatch.ts gives: the mock and the
 * REST adapter both state these refusals, and two copies drift until the mock
 * stops proving anything. Every sentence is a **code read** of
 * `ProjectIssueTypeService`, `ProjectIssueTypes`, the gateway's `IssueMapper`
 * and issue-service's `GrpcWorkflowServiceClient` at `af41c322`, not a
 * measurement.
 */

/** `ProjectIssueTypeColorDto`, in the contract's order — also the order of the swatches (DESIGN.md §4.30). */
export const ISSUE_TYPE_COLORS: readonly IssueTypeColor[] = ["blue", "red", "green", "amber", "purple", "teal", "slate"];

/** `ProjectIssueTypeIconDto`, in the contract's order — also the order of the icon picker (DESIGN.md §4.30). */
export const ISSUE_TYPE_ICONS: readonly IssueTypeIcon[] = [
  "check-square",
  "bug",
  "book-open",
  "headset",
  "megaphone",
  "file-text",
  "flag",
  "layers",
];

/** `IssueTypeDto` and the registry's `code`: a capital letter, then 1–31 capitals, digits or underscores. */
export const ISSUE_TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
export const ISSUE_TYPE_CODE_MAX_LENGTH = 32;
/** `name` is `minLength: 1, maxLength: 50`; the server measures it before it strips it. */
export const ISSUE_TYPE_NAME_MAX_LENGTH = 50;
/** The server's `sortOrder` default when a create leaves it out (`ProjectIssueTypeService.create`). */
export const ISSUE_TYPE_DEFAULT_SORT_ORDER = 100;

export const isIssueTypeColor = (value: unknown): value is IssueTypeColor =>
  typeof value === "string" && (ISSUE_TYPE_COLORS as readonly string[]).includes(value);
export const isIssueTypeIcon = (value: unknown): value is IssueTypeIcon =>
  typeof value === "string" && (ISSUE_TYPE_ICONS as readonly string[]).includes(value);
export const isIssueTypeCode = (value: unknown): value is string =>
  typeof value === "string" && ISSUE_TYPE_CODE_PATTERN.test(value);

/* --- The server's sentences ------------------------------------------------ */

/** Bean validation of a registry body at the gateway: 400 `INVALID_ARGUMENT`. */
export const INVALID_REQUEST_PARAMETERS_MESSAGE = "Invalid request parameters";
/** `PATCH …/issue-types/{code}` with `{}` — checked by the service before the role (400 `INVALID_ARGUMENT`). */
export const ISSUE_TYPE_EMPTY_PATCH_MESSAGE = "At least one field is required";
/** A non-member and a MEMBER or VIEWER alike (403 `PERMISSION_DENIED`). */
export const ISSUE_TYPE_ADMIN_REQUIRED_MESSAGE = "Project ADMIN role is required";
/** PATCH or DELETE of a code the project does not hold (404 `NOT_FOUND`). */
export const ISSUE_TYPE_NOT_FOUND_MESSAGE = "Issue type not found in this project";
/** A PATCH value the hand-written DTO let through and the service refused (400 `INVALID_ARGUMENT`). */
export const ISSUE_TYPE_INVALID_FIELDS_MESSAGE = "Invalid issue type name, color, icon or sortOrder";
/** DELETE of the only type left (400 `FAILED_PRECONDITION`, **no `details`**). */
export const LAST_ISSUE_TYPE_MESSAGE = "Cannot delete the last issue type";
/** A create whose code the project already holds (409 `ALREADY_EXISTS`). */
export const issueTypeExistsMessage = (code: string) => `Issue type ${code} already exists in this project`;
/** DELETE of a type issues still carry — deleted ones counted (400 `FAILED_PRECONDITION`, `details.issueCount`). */
export const issueTypeInUseMessage = (code: string, count: number) => `Issue type ${code} has ${count} issues`;
/** An issue write naming a well-formed key the registry does not hold (400 `INVALID_ARGUMENT`). */
export const issueTypeNotDefinedMessage = (key: string) => `Issue type ${key} is not defined in this project`;
/** A malformed key on an issue write — the gateway's `ResponseStatusException` (400 `BAD_REQUEST`). */
export const INVALID_ISSUE_TYPE_KEY_MESSAGE = "Invalid issue type key";
/** `issueType: null` on `PATCH /issues/{issueId}` — the gateway's `requireNotCleared` (400 `BAD_REQUEST`). */
export const ISSUE_TYPE_NOT_CLEARABLE_MESSAGE = "issueType cannot be cleared";
/** A type change whose target workflow lacks the issue's status (400 `FAILED_PRECONDITION`, no `details`). */
export const STATUS_NOT_IN_TARGET_TYPE_MESSAGE = "Current status is not available for the target issue type";

/* --- Reading the wire ------------------------------------------------------ */

/**
 * `ProjectIssueTypeDto[]` as it arrives — the context's `issueTypes` and the
 * list route's `items` alike — into the registry the screens draw:
 *
 * - **in the order sent**, never re-sorted (DESIGN.md §6): the server orders by
 *   `sortOrder`, then `code` by its database's collation, which a client
 *   comparison would not reproduce;
 * - an entry with no usable `code` (missing, blank, not a string) is dropped,
 *   and a repeated code keeps its first entry;
 * - a blank `name` reads as the code — a type is never drawn nameless;
 * - a colour or an icon outside the contract's sets is `null`, which the chip
 *   draws neutral (DESIGN.md §4.6) rather than as the nearest known value;
 * - a `sortOrder` that is not a whole number reads as `0`.
 *
 * Not an array at all is an empty registry: `issueTypes` is `required`, and
 * what a malformed answer means is not this layer's to guess.
 */
export function toProjectIssueTypes(value: unknown): ProjectIssueType[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const registry: ProjectIssueType[] = [];
  for (const raw of value) {
    const entry = toProjectIssueType(raw);
    if (!entry || seen.has(entry.code)) continue;
    seen.add(entry.code);
    registry.push(entry);
  }
  return registry;
}

/** One `ProjectIssueTypeDto`, or `null` when it carries no usable code. See `toProjectIssueTypes`. */
export function toProjectIssueType(value: unknown): ProjectIssueType | null {
  if (typeof value !== "object" || value === null) return null;
  const wire = value as Record<string, unknown>;
  if (typeof wire.code !== "string" || wire.code.trim() === "") return null;
  const name = typeof wire.name === "string" && wire.name.trim() !== "" ? wire.name : wire.code;
  return {
    code: wire.code,
    name,
    color: isIssueTypeColor(wire.color) ? wire.color : null,
    icon: isIssueTypeIcon(wire.icon) ? wire.icon : null,
    sortOrder: typeof wire.sortOrder === "number" && Number.isInteger(wire.sortOrder) ? wire.sortOrder : 0,
  };
}

/** The four keys `PatchProjectIssueTypeRequestDto` declares. `code` is not one of them: it never changes. */
export const ISSUE_TYPE_PATCH_KEYS = ["name", "color", "icon", "sortOrder"] as const;

/**
 * The PATCH body: each declared key whose value is neither `undefined` nor
 * `null` — the DTO refuses an explicit `null`, and "leave it" is spelled by
 * leaving it out. Copied by name, so a wider object (a form state, a registry
 * entry with its `code`) cannot put an undeclared key on the wire.
 */
export function projectIssueTypePatchBody(input: Partial<Record<(typeof ISSUE_TYPE_PATCH_KEYS)[number], unknown>>) {
  const body: Partial<Record<(typeof ISSUE_TYPE_PATCH_KEYS)[number], unknown>> = {};
  for (const key of ISSUE_TYPE_PATCH_KEYS) {
    const value = input[key];
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}
