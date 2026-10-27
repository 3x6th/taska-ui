/**
 * The four states an account can be in — `UserStatusDto` in the contract
 * (docs/contract/openapi.yml), and `USER_STATUS_LOCKED = 4` in `common.proto`.
 *
 * `LOCKED` was widened into this union by TAS-188 a build *before* the backend
 * could produce it, deliberately: at `ref=develop` on 2026-09-05 the entity
 * enum stopped at `INVITED`, the proto enum at `USER_STATUS_BLOCKED = 3`, and
 * `handleFailedAttempt(Credential)` wrote no status at all. All four of those —
 * plus `resetFailedAttempts` restoring `ACTIVE` — shipped in backend PR #146,
 * which merged on 2026-09-07 and is deployed, so the value is live now and the
 * bet came off.
 *
 * What earns it a value of its own: `LOCKED` is **not** an
 * administrative state, and no write this client makes reaches it. An account
 * locks itself after `maxFailedAttempts` failed sign-ins and the next
 * successful one releases it, which is why `block` and `unblock` are both
 * refused from it and `resetCredentialLockout` (src/api/TaskaApi.ts) is the
 * only write that leaves it.
 *
 * A value outside this union can still arrive, and adding to the union is not
 * what stops it. `GET /users/me` answers the gateway's own `GatewayUserStatus`,
 * which since backend TAS-197 (`04546f1`, deployed) has a `LOCKED` member — so a
 * locked account whose token was issued before the lock now reads `LOCKED`, and
 * that token keeps working while TAS-198 (backend PR #174) is open. And
 * `UNSPECIFIED` is still a member of that enum: since backend PR #200 the
 * contract types `status` as `UserStatusDto`, whose fifth value it is, and the
 * API layer reads it as no status at all (`toUserStatus` in RestTaskaApi). A
 * value the contract does not list can still arrive from a backend newer than
 * this build, so every reader prints an unrecognised status verbatim rather
 * than trusting the type (`userStatusLabel` in src/screens/admin/users.ts). A
 * status the gateway's mapper does not know at all no longer arrives as
 * anything: `AuthMapper.toGatewayUserStatus` throws a plain `DomainException`,
 * which `GatewayErrorHandler` turns into a 500 on every authenticated request
 * (read at `60d62ee`).
 */
export type UserStatus = "INVITED" | "ACTIVE" | "BLOCKED" | "LOCKED";
/**
 * The account-wide role from `GET /users/me`, not a project role — `ProjectRole`
 * below is the per-project one and the two never substitute for each other.
 *
 * The contract's third value, `UNSPECIFIED`, is deliberately not modelled: it is
 * a proto-style zero value meaning "not stated", so it is normalised away in the
 * API layer and reaches the domain as a missing `globalRole`, exactly like a
 * gateway that does not send the field at all.
 */
export type GlobalRole = "USER" | "GLOBAL_ADMIN";
export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH";
export type IssueStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type IssueLinkType = "BLOCKS" | "RELATES_TO" | "DUPLICATES";

/**
 * The fields that carry one of these values *off the wire* (TAS-173). The
 * unions above stay the contract's members — the values this build has words
 * and colours for — while a field the server fills accepts any string, the way
 * `Notification.notificationType` already did: a backend release can add a
 * type, a priority or a status before this frontend ships, and the type must
 * not claim that case cannot happen. A named member keeps its autocompletion.
 *
 * Every lookup of a label or a colour therefore goes through the helpers in
 * `src/lib/format.ts`, which answer for a code they do not know instead of
 * indexing a table with it — the index that threw is what blanked a screen.
 */
/**
 * An issue type is a key of the project's own registry since backend #226
 * (TAS-386; `IssueTypeDto` is `^[A-Z][A-Z0-9_]{1,31}$`), not a member of a
 * closed set: there is no union of types this build knows (TAS-417). Its name,
 * colour and icon come from `ProjectContext.issueTypes`.
 */
export type IssueTypeCode = string;
export type IssuePriorityCode = IssuePriority | (string & {});
export type IssueStatusKey = IssueStatus | (string & {});
export type IssueLinkTypeCode = IssueLinkType | (string & {});
export type UserStatusCode = UserStatus | (string & {});

/** One `code`/`name` pair of a `GET /meta` dictionary (`MetaResponseDto`, backend TAS-217). */
export interface DictionaryEntry {
  code: string;
  /**
   * What the server calls the value — in English since backend #201 (TAS-264,
   * develop `e8a8d316b326`). Still printed only through `isEnglishName`
   * (src/lib/enumLabel.ts), whose Cyrillic check stays for good (DESIGN.md §6).
   */
  name: string;
  /**
   * Whether a picker may offer it (backend #201). The server sends `false` for
   * its placeholders — `UNKNOWN`, `UNSPECIFIED`, `ISSUE_LINK_VIEW_TYPE_UNSPECIFIED`
   * and `UNRECOGNIZED` — and the contract's default is `true`, so anything but
   * an explicit `false` reads as `true`. A rule about pickers, not about how a
   * value is read: an `UNSPECIFIED` status is still read as no status.
   */
  selectable: boolean;
}

/**
 * `GET /meta` — the enum dictionaries, read once per session (TAS-173). The
 * priorities and the link types it lists are what the pickers offer, so a value
 * the backend adds becomes selectable without a frontend release; the names
 * label a code this build has no word for. `null` is a dictionary the answer
 * did not carry, and every reader falls back to the build's own set. There are
 * no statuses here: they come from each project's workflows.
 */
export interface EnumDictionaries {
  issueTypes: DictionaryEntry[] | null;
  priorities: DictionaryEntry[] | null;
  /** The relations a *request* may ask for — what the link picker offers. */
  linkTypes: DictionaryEntry[] | null;
  /**
   * The relations a link *row* can show, inverses included (backend #201). Keyed
   * by the stripped code `IssueLink.viewLinkType` carries (`BLOCKS`,
   * `IS_BLOCKED_BY`), not by the wire's prefixed one: the rest leg strips the
   * prefix from both and drops the two placeholders, so stripped meets
   * stripped. Not in the contract's `required`, so `null` is a real answer.
   */
  linkViewTypes: DictionaryEntry[] | null;
  notificationTypes: DictionaryEntry[] | null;
  userStatuses: DictionaryEntry[] | null;
}
/**
 * The notification kinds the gateway can emit — exactly the contract's
 * `NotificationTypeDto`, which lists all twenty-four since backend PR #159
 * added `PROJECT_ARCHIVED` (develop `562d84de`) and is what
 * `NotificationResponseDto.notificationType` refers to. `UNKNOWN` is the gateway's own fallback for a kind it does
 * not recognise, and `/meta` lists it as an ordinary entry.
 *
 * Two of these are named without being live: `ISSUE_COMMENT_UPDATED` and
 * `ISSUE_COMMENT_DELETED` have no case in notification-service's
 * `NotificationFactory` (read at `398285cde074`) and are never produced today.
 * They stay in the union because the contract lists them, and the day
 * `NotificationFactory` grows a case for either, the type already has a name
 * ready rather than being the thing that lags it.
 *
 * This is a list of names to build and compare against — the mock seeds from
 * it, and a comparison written against it cannot misspell one. It is **not**
 * the type of `Notification.notificationType`, which accepts any string: a
 * gateway newer than this build can list a kind this union has not learnt yet.
 */
export type NotificationType =
  | "ISSUE_ASSIGNED"
  | "ISSUE_TRANSITIONED"
  | "ISSUE_CREATED"
  | "ISSUE_UPDATED"
  | "ISSUE_DELETED"
  | "ISSUE_LINK_CREATED"
  | "ISSUE_LINK_DELETED"
  | "ISSUE_COMMENT_CREATED"
  | "ISSUE_COMMENT_UPDATED"
  | "ISSUE_COMMENT_DELETED"
  | "ISSUE_ATTACHMENT_ADDED"
  | "ISSUE_ATTACHMENT_DELETED"
  | "LABEL_ADDED"
  | "LABEL_REMOVED"
  | "USER_INVITED"
  | "USER_ACTIVATED"
  | "USER_BLOCKED"
  | "USER_UNBLOCKED"
  | "PROJECT_CREATED"
  | "PROJECT_ARCHIVED"
  | "MEMBER_ADDED"
  | "MEMBER_UPDATED"
  | "MEMBER_REMOVED"
  | "PERSONAL_ACCESS_TOKEN_CREATED"
  | "PERSONAL_ACCESS_TOKEN_REVOKED"
  | "UNKNOWN";

export interface User {
  id: string;
  email: string;
  displayName: string;
  /**
   * `null` when the response stated no status: not a string — `AuthMapper` can
   * write `null`, and the schema marks nothing required — or `UNSPECIFIED`, the
   * placeholder `UserStatusDto` lists since backend PR #200 (TAS-173).
   * Printed through `userStatusLabel`, never indexed.
   */
  status: UserStatusCode | null;
  // Not in the contract at all — `color` there belongs to a label and to
  // nothing else — so today this arrives only from the mock. It is load-bearing
  // anyway: a value here beats the colour `avatarColor` computes from the id,
  // which is the hook a chosen colour would arrive through (TAS-148).
  color?: string;
  // Optional because the deployed gateway may not carry the field yet, and
  // because UNSPECIFIED collapses to the same absence. Never inferred from the
  // JWT, and it grants nothing on its own — the server stays authoritative.
  globalRole?: GlobalRole;
  /**
   * A presigned link to this person's avatar, good for fifteen minutes on
   * auth-service's default link lifetime, or `null` when there is none to draw.
   *
   * Two reads fill it, and neither costs a request of its own. **`GET
   * /users/me`** carries the reader's own as `avatar` since backend PR #193
   * (TAS-223) — an explicit `null` both when they have none *and* when the
   * gateway's profile read behind it failed. The server tells those two apart
   * with `avatarUnavailable` (below), not with this field: here `null` only
   * says "no picture to draw", and either way the face falls to initials. A
   * caller that needs to know *why* reads the flag. A *member row*
   * declares the avatar inline (`ProjectMemberDetailsDto.avatar.downloadUrl`,
   * backend TAS-137), and fills it since TAS-225: auth-service's
   * `UserRepository.findUsersWithAvatars` selects the avatar row with its id,
   * and a presign that fails leaves only that member's row without one (read at
   * backend develop `398285cde074`). `null` there is "no picture to draw" in the
   * same sense as above.
   *
   * Every read of `/users/me` re-signs the link — the same picture under a new
   * query string, which the browser's cache never recognises — so the `["me"]`
   * query keeps the link it already holds while `avatarId` is unchanged and the
   * link is younger than ten minutes (`keepSignedAvatarLink`,
   * src/lib/ownAvatarLink.ts). That is cache handling, not a compensation.
   *
   * `undefined` and `null` are not the same answer and the distinction is the
   * reason this is not simply `string | null`: absent means nobody has asked —
   * or a gateway older than TAS-223 answered without the field — and `null`
   * means the server was asked and gave no picture. Nothing draws a difference
   * between them today — both fall to initials — but collapsing them now would
   * make the difference unreachable.
   */
  avatarUrl?: string | null;
  /**
   * `avatar.id` from `GET /users/me` (TAS-223) — set only on the reader's own
   * profile, `null` when the answer carried no avatar. Not drawn: it is what
   * tells a re-signed link to the same picture from a new picture, so the
   * `["me"]` query can keep the link it holds (see `avatarUrl`).
   */
  avatarId?: string | null;
  /**
   * `avatarUnavailable` from `GET /users/me` — the only read that sets it, and
   * required there since backend PR #193 (TAS-223, head `3bd33cac`; gateway
   * `UserServiceImpl.getMyInfo`).
   *
   * - `true`: the gateway's `GetUserProfile` read failed, so `avatarUrl: null`
   *   means *unknown*, not *none*. The gateway sets it on any gRPC error. One
   *   of those is permanent rather than transient: a row whose object storage
   *   has lost fails the presign every time, until an upload replaces
   *   the row or `DELETE /users/me/avatar` removes it. Since backend PR #198
   *   (TAS-221) no confirm can leave a row so.
   * - `false`: the profile was read — the avatar came with it, or there is none.
   * - absent: a gateway older than that merge answered, or the `User` came from
   *   anywhere else. Member rows never carry it. Absent is not coerced to
   *   `false`: it is "the server did not say", which is a third answer.
   */
  avatarUnavailable?: boolean;
}

/**
 * `AvatarResponseDto` — what `POST /users/me/avatar/confirm` answers with once
 * the bytes are in the bucket (backend PR #150, TAS-129, in
 * `docs/contract/openapi.yml` since it merged at `develop` `368ae77355bd`).
 *
 * Only `downloadUrl` is drawn. The rest is modelled because the response
 * declares it and because a client that throws away what the server said cannot
 * later notice it changed — not because anything reads it.
 */
export interface UserAvatar {
  id: string;
  userId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /**
   * **Filled** by the server: `UserAvatar.createdAt` is an audited
   * `@CreatedDate`, `ProfileMapper.toAvatarDto` copies it and the gateway's
   * `UserProfileMapper` maps it onto the response (read at `develop`
   * `368ae77355bd`). Still `string | null` rather than `string`, because the
   * schema declares no `required` block and that mapper writes `null` for an
   * all-zero timestamp — so an answer without it is a shape to survive, not one
   * this side may rule out. Not to be confused with the sibling `AvatarDto` on a
   * member row (backend TAS-137), which declares the field and never populates
   * it.
   */
  createdAt: string | null;
  /**
   * `null` rather than `""` for an answer that carried no link. An empty string
   * in an `<img src>` re-requests the current document, which is a real request
   * to a real server for a picture that is not there.
   */
  downloadUrl: string | null;
}

/**
 * What `POST /admin/users/{userId}/block`, `.../unblock` and
 * `.../reset-lockout` answer with — `UserStatusResponseDto`. The server states
 * the transition it performed, both ends of it, so the caller never has to
 * infer what happened from what it asked for.
 *
 * `previousStatus` and `currentStatus` are the domain's own `UserStatus`
 * because the contract declares them as that enum, exactly as it declares the
 * status on `User` — this is not the open-string case of
 * `IssueLink.viewLinkType`, where the contract types the field as a bare
 * string.
 *
 * `changedAt` — **not** `updatedAt`, which is what this field was called until
 * TAS-188. The gateway's `AdminUserManagementMapper.toRestUserStatusResponse`
 * calls `setChangedAt`, and `UserStatusResponseDto` lists `changedAt` among its
 * required properties, so the old name read `undefined` out of every successful
 * response while the type still promised a `string`.
 *
 * It is modelled because the contract declares it, and it **is not drawn
 * anywhere**. The reason it is not drawn is no longer that it is a second
 * clock: auth-service builds the response as
 * `.changedAt(savedUser.getUpdatedAt())` on an entity carrying
 * `@LastModifiedDate`, so this *is* the `updated_at` of the `auth.users` row it
 * changed, to the same instant. What it is not is the row itself. The list this
 * value would decorate is refetched immediately after the write, and the
 * refetched row carries its own `updated_at` — so the section reads one source
 * for the whole table rather than patching one row's timestamp from a response
 * and the rest from a list.
 */
export interface UserStatusChange {
  userId: string;
  previousStatus: UserStatus;
  currentStatus: UserStatus;
  changedAt: string;
}

/**
 * One person as the people directory names them — `DirectoryUserDto`, the row
 * of `GET /users` (backend #204, TAS-204). Not a `User`: there is no status
 * and no role on the wire, by the route's own description ("Поиск не
 * предоставляет доступа к проектам, ролям, токенам и credentials").
 *
 * `avatarUrl` is a presigned link, or `null` both when there is no avatar and
 * when auth-service could not sign one within its 250 ms budget — the route
 * says the two apart nowhere, so neither does this.
 */
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * One page of the directory — `UserDirectoryResponseDto`. Deliberately not a
 * `Page<T>`: the server sends no total and no page echo, only whether another
 * page exists (it reads one row past the page to know), so a total here would
 * be invented.
 */
export interface DirectoryPage {
  items: DirectoryUser[];
  hasMore: boolean;
}

/**
 * What `POST /auth/invitations` answers — `InvitationResponseDto` plus the one
 * fact the body does not carry: whether the account was made by this call,
 * which the gateway states only as the HTTP status (201 new, 200 already
 * invited).
 *
 * `deliveryQueued` is a durable queue write, not a delivery — the contract says
 * so ("а не подтверждение доставки SMTP") — and `false` means nothing was
 * queued because the current link is still valid. `expiresAt` is that link's
 * deadline; the token itself never leaves the server. `status` is hard-coded
 * `INVITED` by the gateway's client, read through the same rule as every other
 * status.
 */
export interface InvitationResult {
  userId: string;
  status: UserStatusCode | null;
  deliveryQueued: boolean;
  expiresAt: string;
  created: boolean;
}

/**
 * `UserSummaryDto` — who somebody is, as the server names them inline on a
 * read that is about something else (backend TAS-214, develop `60d62ee`): the
 * issue's assignee and reporter, an attachment's uploader, a comment's author.
 *
 * `displayName` is `null` when the server did not name the person, and that
 * includes the empty string. The gateway answers `200` with
 * `displayName: ""` when auth-service is down rather than failing the read
 * (`IssueDetailsServiceImpl.getProfiles` falls back to an empty profile map),
 * so `""` is not a name somebody chose — it is the same "not named" as an
 * absent key, and every reader resolves it the way the UI already resolves a
 * person it cannot name (`personFor` in src/lib/people.ts).
 */
export interface UserSummary {
  id: string;
  displayName: string | null;
  /** A presigned link, or `null`. Not yet observed on the stand. */
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  projectKey: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When the project was archived, or `null` — set by `DELETE /projects/{id}`
   * (backend PR #159, TAS-146, merged and deployed 2026-10-23). Stated on the
   * reads of one project (`GET /projects/{id}`, the context's `project`) and on
   * the archive's own answer; `null` on every row of `GET /projects`, which
   * leaves archived projects out altogether, and on the answers of `POST` and
   * `PATCH`, which an archived project never reaches.
   *
   * An archived project stays readable — board, issues, comments, work log,
   * attachments — and refuses every write with `PROJECT_ARCHIVED`
   * (`isProjectArchived`). The board reads this field off its context and
   * offers no write at all (DESIGN.md §5.7, «Архивный проект»); it is the one
   * signal, and a refusal is never read as one.
   */
  archivedAt: string | null;
  /**
   * The reader's own role in this project — `currentUserRole` on
   * `ProjectResponseDto`, added by backend PR #152 (TAS-137), merged and
   * deployed.
   *
   * Optional **and** nullable, and both for real reasons on the wire rather
   * than a style choice — corrected here from an earlier version of this
   * comment, which called it "optional rather than nullable" and was wrong.
   * Nullable because the api-gateway configures no Jackson inclusion override
   * anywhere — no `spring.jackson` block in its `application.yml`, no
   * `ObjectMapper` or codec customizer bean — so Jackson's default `ALWAYS`
   * inclusion applies, and a response built without a role still carries the
   * key, as an explicit `"currentUserRole": null` — exactly like `archivedAt`
   * above. **Only one answer is built that way: `POST /projects`**, through the
   * mapper overload that sets no role. `PATCH` and `DELETE /projects/{id}`
   * (backend PRs #155 and #159, merged) answer `"ADMIN"` — the only role either
   * route lets through — and a caller still keeps the role it already holds
   * rather than taking one from a write answer. A read never
   * carries the `null`: `GET /projects/{id}` refuses a non-member with 403 —
   * a `GLOBAL_ADMIN` included — so every 200 has a membership row whose role is
   * NOT NULL, and `GET /projects` inner-joins the reader's own membership, so
   * every item carries one (read at `develop` `1cfe4d79f074`). Optional because
   * a gateway that predates PR #152 does not carry the key at all — the stand's
   * own answer until it deployed. The client reads both the same way, because
   * the contract commits to neither.
   *
   * Typed as the closed set because it is one. The gateway's
   * `ProjectMapper.toRestProjectRole` maps exactly ADMIN, MEMBER and VIEWER and
   * returns `null` for anything else (read at `develop` `1cfe4d79f074`), and the
   * column's CHECK constraint keeps anything else out in the first place — so
   * an unrecognised role could only ever arrive as `null`, never as a string.
   * `ProjectMember.role` below is the other case and is *not* a closed set.
   *
   * **Absent on the stand until TAS-137 deployed** (measured deployed on
   * 2026-09-16), so until then every `GET /projects/{id}` there answered without
   * this field and its readers took their floor. Since the deploy every read
   * states a role name.
   */
  currentUserRole?: ProjectRole | null;
  /**
   * Both of the next two are on `ProjectResponseDto` since backend PR #155
   * (TAS-145), merged and deployed, and both are `nullable: true`.
   *
   * Optional *and* nullable for the same reason `currentUserRole` above is: a
   * gateway that predates the PR omits the key, and one that has it sends an
   * explicit `null` for a project that stated no value, because the api-gateway
   * configures no Jackson inclusion override. Readers must treat the two alike.
   *
   * A description is non-blank or `null` on the server: create and update both
   * store a blank or whitespace-only one as `null` (PR #155 as merged), so `""`
   * never comes back from the gateway. The card's placeholder still covers a
   * blank as well as an absent one — `??` alone would not — because that costs
   * nothing and a row from an older mock seed could carry one.
   */
  description?: string | null;
  /**
   * The colour an admin chose, which wins over the one `keyBadgeStyle` computes
   * from the project key. `""` is *not* a third state here, in deliberate
   * contrast with `description` above: the schema's `^#[0-9A-Fa-f]{6}$` rejects
   * it. `null` is "no colour chosen", and an explicit `null` on the PATCH
   * (backend PR #155) puts a project back there, so the badge is computed from
   * the key again (TAS-171).
   */
  color?: string | null;
  memberIds?: string[];
}

export interface ProjectMembership {
  /**
   * The reader's role in this project, or `null` when the server answered and
   * stated no role this build can act on — the same meaning `ProjectMember.role`
   * gives its `null` below. In `rest` that is a project read whose
   * `currentUserRole` is absent, an explicit `null`, or a value `toProjectRole`
   * does not recognise; no 200 from the deployed gateway carries one (see
   * `Project.currentUserRole`). The mock never answers it.
   *
   * **Not a VIEWER, and never floored to one** (TAS-226, which removed that
   * floor). VIEWER is a permission the server stated; `null` is the absence of
   * any statement, and the board draws the two apart — a VIEWER's board is
   * quietly read-only, an unstated role's board is read-only *and says why*,
   * the way a failed read does.
   */
  role: ProjectRole | null;
  isMember: boolean;
  projectExists: boolean;
}

/**
 * One row of `GET /projects/{projectId}/members` — `ProjectMemberDetailsDto`
 * (backend TAS-137, in `docs/contract/openapi.yml`), which is where
 * `displayName` and `email` come from. Read from the gateway in `rest`. Until
 * TAS-224 the `hybrid` mode (removed in TAS-209) synthesised a single row on
 * the stand — the reader — rather than reading one.
 */
export interface ProjectMember {
  userId: string;
  /**
   * `null` means the server did not state a role this build can act on —
   * corrected here from an earlier version of this comment, which named
   * `ANY_UNMAPPED → UNSPECIFIED` as the mechanism and was wrong: that mapping
   * is the *inbound write* path, not what fills this field. The read path is
   * MapStruct's built-in enum-to-string conversion (`.name()`), off a column a
   * CHECK constraint confines to ADMIN, MEMBER and VIEWER
   * (`ck_project_members_role`, project-service `0000-init.sql`) — so
   * "UNSPECIFIED" is not actually on the wire today. What this narrowing
   * guards against is a role the enum grows later, returned verbatim (say
   * "OWNER") before this build has a name for it. `Project.currentUserRole`
   * above cannot carry even that: a different mapper, which returns `null`
   * rather than ever emit a role it does not recognise.
   *
   * The issue panel's assignee chips read it (TAS-226): issue-service takes
   * only an ADMIN or a MEMBER as an assignee, so only those rows are offered,
   * and a `null` is not — "the server did not state a role we can act on" is
   * never read as a role of its own, and an assignability nobody stated is not
   * the client's to offer.
   *
   * The members panel (TAS-158) reads it too, with the same `null` semantics:
   * such a row says in words that its role is unknown, is offered no role
   * select — which would have to guess the current value — and does not count
   * as an admin.
   */
  role: ProjectRole | null;
  /**
   * Both optional. `addedAt` joins `ProjectMemberDetailsDto` with backend
   * PR #169 (TAS-212, merged at develop `fa90b51`), and `rest` reads it where the row
   * carries it; `addedBy` is on no read. The mock fills both, as seed data and
   * on the rows its own adds create — the `hybrid` mode, removed in TAS-209,
   * also invented them from the project's own `createdAt`/`createdBy` until
   * TAS-224 — and nothing
   * outside the tests reads them.
   */
  addedAt?: string;
  addedBy?: string;
  /**
   * Absent when the row named nobody. Callers key off its presence to choose
   * between drawing a person and falling to their own unknown-person path
   * (`toUserMap` in BoardScreen filters on exactly this), so a `user` carrying
   * a blank `displayName` would be worse than no `user` at all.
   *
   * `avatarUrl` rides along because `ProjectMemberDetailsDto` declares the
   * avatar **inline**, with its own `downloadUrl` (backend TAS-137). That is
   * what makes a board of faces one read rather than one request per person,
   * and it is why nothing in this product ever calls
   * `GET /users/{userId}/avatar` in a loop. The server fills it since TAS-225
   * (see `User.avatarUrl`); a named row reads `null` for a member with no
   * picture, or one whose picture could not be signed.
   */
  user?: Pick<User, "displayName" | "email" | "color" | "avatarUrl">;
}

/**
 * What `POST /projects/{projectId}/members` and
 * `PATCH /projects/{projectId}/members/{userId}` answer with —
 * `ProjectMemberResponseDto` (docs/contract/openapi.yml): the membership as the
 * server now holds it, and **nothing about the person**. No `displayName`, no
 * `email`, no avatar, so a caller that wants to draw the new row reads the member
 * list again rather than building a person out of this.
 *
 * `role` is `ProjectRole | null` for `Project.currentUserRole`'s reason rather
 * than `ProjectMember.role`'s: both writes map it through the gateway's
 * `ProjectMapper.toRestProjectRole`, which returns `null` rather than emit a role
 * it does not recognise (read at backend `develop` `1cfe4d79f074`).
 *
 * The three fields declare no `required` block, so an absent one is legal on the
 * wire; the rest mapper fills `projectId` and `userId` from the request it made,
 * which names both, rather than from nothing.
 */
export interface ProjectMemberWriteResult {
  projectId: string;
  userId: string;
  role: ProjectRole | null;
}

/**
 * `statusKey` and `category` are open since TAS-173, for the reason
 * `BoardColumn` gives below: a workflow is project configuration, and a key
 * this build has never seen is a column to draw rather than a case to deny.
 */
export interface WorkflowStatus {
  id: string;
  statusKey: IssueStatusKey;
  name: string;
  category: IssueStatusKey;
  sortOrder: number;
}

export interface WorkflowTransition {
  id: string;
  fromStatusId: string;
  toStatusId: string;
  name: string;
  sortOrder: number;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

/**
 * A workflow as the project context carries it. The workflow itself does carry
 * `createdAt` and `updatedAt` on the wire; its statuses and transitions are
 * built without timestamps (the assembler in backend PR #169, merged at `a1bfe19`;
 * the Java wins over the yml, docs/ai/API-DIVERGENCE.md, TAS-251). Nothing on
 * the board reads the workflow's own timestamps, so the type leaves them out
 * and the mapper does not copy them.
 */
export type ProjectWorkflow = Omit<Workflow, "createdAt" | "updatedAt">;

/**
 * A transition as `GET /projects/{projectId}/workflows` sends it (backend PR
 * #208, TAS-381): every one, hidden ones included and marked. Kept apart from
 * `WorkflowTransition` because the project context never carries a hidden
 * transition, so nothing on the board may branch on a flag it is never sent.
 */
export interface WorkflowDefinitionTransition extends WorkflowTransition {
  hidden: boolean;
}

/** A workflow as the workflow routes of backend PR #208 send it: the whole thing, hidden transitions included. */
export interface WorkflowDefinition extends Omit<Workflow, "transitions"> {
  transitions: WorkflowDefinitionTransition[];
}

/**
 * `ProjectWorkflowDto` (backend PR #208): one workflow the project runs on, the
 * project's issue types that run on it, and whether it is the shared default.
 * `issueTypes` as sent. The list route filters them through the project's
 * registry (backend #226, `ProjectWorkflowListService`); the TAS-416 write
 * answers list the workflow's bindings, which may still name a type deleted
 * from the registry (backend ask A4, TAS-418), and no reader intersects them
 * with the context. `shared` is `true` for anything but an explicit `false`,
 * so a value nobody stated is read-only.
 */
export interface ProjectWorkflowEntry {
  workflow: WorkflowDefinition;
  issueTypes: IssueTypeCode[];
  shared: boolean;
}

/** `ProjectIssueTypeColorDto` — closed in the contract (backend #212). */
export type IssueTypeColor = "blue" | "red" | "green" | "amber" | "purple" | "teal" | "slate";
/**
 * `ProjectIssueTypeShapeDto` — closed in the contract (backend TAS-432, PR
 * #256): the figure a type without an icon is drawn as (DESIGN.md §4.6).
 */
export type IssueTypeShape = "square" | "circle" | "diamond";
/** `ProjectIssueTypeIconDto` — closed in the contract (backend #212). */
export type IssueTypeIcon =
  | "check-square"
  | "bug"
  | "book-open"
  | "headset"
  | "megaphone"
  | "file-text"
  | "flag"
  | "layers";

/**
 * One entry of a project's issue-type registry — `ProjectIssueTypeDto`
 * (backend #212, TAS-385; the look since TAS-432): a colour, a shape and an
 * optional icon. Each is `null` when the server sent a value outside the sets
 * this build can draw (TAS-173's precedent), and the chip then falls back as
 * DESIGN.md §4.6 says rather than guessing: a colour to `--fg-3`, a shape — or
 * one that is missing — to the square, an icon to the shape.
 *
 * `icon: null` is also the ordinary answer: since TAS-432 a type has no icon
 * unless one was chosen, and the chip draws its shape.
 */
export interface ProjectIssueType {
  code: IssueTypeCode;
  name: string;
  color: IssueTypeColor | null;
  shape: IssueTypeShape | null;
  icon: IssueTypeIcon | null;
  sortOrder: number;
}

/**
 * `GET /projects/{projectId}/context` — `ProjectContextResponseDto`, backend
 * PR #169 (TAS-212), in `docs/contract/openapi.yml` (develop `fa90b51`): the
 * board's whole frame in one read, where it used to take seven (the project,
 * the project again for the role, the members, a workflow per issue type and
 * the labels).
 *
 * All or nothing: a part that fails on the server fails the whole response, so
 * there is no partial context. A non-member is refused with 403 — a
 * `GLOBAL_ADMIN` included — and a missing project is 404.
 * At head `a1bfe19` the code intends 200 with empty members and labels (its
 * TODO says so), but the labels leg's denial arrives from issue-service as a
 * gRPC `StatusRuntimeException`, which `ProjectServiceImpl.isPermissionDenied`
 * (it matches only `DomainException`) does not catch, so the whole context
 * fails `PERMISSION_DENIED` and answers 403. Removal: when the labels call
 * carries the global role, or `isPermissionDenied` also matches a gRPC denial,
 * the context answers 200 with empty parts and the mock must follow.
 */
export interface ProjectContext {
  project: Project;
  /**
   * `project.currentUserRole`, narrowed the way `ProjectMembership.role` is:
   * one of the three, or `null` for a role this build cannot act on. Never
   * floored to VIEWER (TAS-226).
   */
  role: ProjectRole | null;
  /** Ordered by `compareMembers` in `rest`; a row nobody could name has no `user`. */
  members: ProjectMember[];
  /**
   * `id`, `name` and `color` and nothing else — the context's labels carry no
   * `projectId`, `createdBy`, `createdAt` or `deletedAt`, and none is invented
   * here. Unordered on the wire.
   */
  labels: Label[];
  /**
   * The project's issue-type registry (backend #212, TAS-385), **in the
   * server's order** — `sortOrder`, then `code` byte-wise (backend TAS-418) —
   * which is the order every picker, filter and list draws; the first is the
   * type a new issue starts as. Never re-sorted here (DESIGN.md §6). Empty is
   * a real answer: a project nobody can create an issue in.
   */
  issueTypes: ProjectIssueType[];
  /**
   * Keyed by issue type: one entry per type of the registry (backend #226),
   * its own binding or the shared default. A type that is not here is not a
   * failure; it is a type this project does not offer. Keyed by the code as
   * sent, a type this build
   * has no name for included (TAS-173); only an entry with no type at all (the
   * wire's `null`) is dropped by the API layer. Read through `workflowFor`
   * (src/lib/projectContext.ts), never by indexing — a code is a string the
   * server chose, and `"constructor"` is one.
   */
  workflows: Partial<Record<string, ProjectWorkflow>>;
}

/**
 * A label as an *issue* carries it — the contract's `IssueLabelResponseDto`,
 * and the same three fields `IssueResponseDto.labels[]` holds. Deliberately not
 * an alias for `ProjectLabel` below: three fields is everything the issue side
 * of the contract is ever told, and typing it as the project record would put
 * `createdBy` and `deletedAt` in scope for code that has never been sent them.
 */
export interface Label {
  id: string;
  name: string;
  color: string;
}

/**
 * A label as the *project* owns it (`ProjectLabelResponseDto`). `deletedAt` is
 * the contract's soft delete: a removed label keeps its row and stops being
 * returned by the list. Whether it also comes off the issues already carrying
 * it is *this repository's* reading of TAS-119, not something the contract
 * states or the gateway has been observed doing — the mock implements it that
 * way, and nothing here depends on the gateway agreeing. Nothing in this app
 * asks for deleted labels, so in practice this is `null` wherever it is read —
 * it is modelled because the field is in the response, not because a screen
 * branches on it.
 */
export interface ProjectLabel extends Label {
  projectId: string;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
}

/**
 * A calendar date with no time and no zone — `YYYY-MM-DD`, the contract's
 * `format: date`, a `LocalDate` on the gateway and a `date` column in
 * `taska.issues`.
 *
 * **It is a `string` and it must never become a `Date`.** `new Date("2026-09-01")`
 * is parsed by the spec as UTC midnight, and every formatter this app owns
 * prints in the viewer's zone — so anyone west of UTC reads *2026-08-31* for a
 * due date the server, the database and the person who typed it all call the
 * 1st. There is no formatting option that repairs it after the fact, because by
 * then the value is an instant and the day has already been chosen. That is the
 * trap this alias exists to close: keep the wire's three fields as text, split
 * them when they need to be drawn, and never hand one to the `Date`
 * constructor.
 *
 * Two more things follow from it being text, and both are worth having:
 * ISO-8601 dates sort and compare correctly as strings (`"2026-01-02" <
 * "2026-03-01"`), so every comparison in the API layer is a string comparison;
 * and equality is exact, with no instant to round.
 *
 * The alias is not branded. A brand would make every literal need a cast for a
 * guarantee TypeScript cannot keep anyway — the value arrives from the network
 * — so the guarantee is `isDateOnly` below, applied where a value enters.
 */
export type DateOnly = string;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Whether a string is a date the wire would accept: four-digit year, two-digit
 * month, two-digit day, and a day that exists.
 *
 * The shape check alone is not enough, which is the whole reason this is a
 * function rather than a regular expression at each call site. `2026-13-01`
 * and `2026-02-30` both match `\d{4}-\d{2}-\d{2}` and both are refused by
 * `LocalDate.parse` on the gateway with a `400` — so they are refused here
 * too, before a request is spent on them.
 *
 * Written as arithmetic rather than through `Date`, deliberately. Checking a
 * date by constructing one and reading the parts back is the same UTC-midnight
 * trap the alias above is about, and it also silently accepts overflow in some
 * engines. A leap-year rule is four lines and cannot drift with a zone.
 *
 * This is the one runtime export in this file. It lives here because it is the
 * type's own definition of validity, and a caller that has a `DateOnly` in hand
 * should not have to know which module remembers what one is.
 */
export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= lastDay;
}

export interface Issue {
  id: string;
  projectId: string;
  issueNumber: number;
  issueKey: string;
  issueType: IssueTypeCode;
  summary: string;
  description: string;
  status: IssueStatusKey;
  priority: IssuePriorityCode;
  assigneeId: string | null;
  reporterId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  /**
   * `IssueResponseDto.labels`. Always an array by the time it is read — the API
   * layer defaults an absent one to `[]` — so a card never has to ask whether
   * the gateway sent the field. The list endpoint answers with that same DTO
   * since TAS-195 and carries the labels itself (measured on the deployed
   * gateway 2026-09-08), which is where the board's chips come from; before
   * that `listIssues` hydrated every row from the detail endpoint to get them.
   */
  labels: Label[];
  /**
   * The five planning fields — `IssueResponseDto`'s `storyPoints`, `startDate`,
   * `dueDate`, `originalEstimateMinutes` and `remainingEstimateMinutes`, added
   * by TAS-116 (merged PR #148) and now part of the contract proper:
   * docs/contract/openapi.yml, backend develop `21a0d9d177a1`. The deployed
   * gateway's own `/v3/api-docs` declares all five on `IssueResponseDto`
   * (measured 2026-09-11, docs/ai/API-DIVERGENCE.md) — but a declaration is not
   * a response, and no body carrying one of the five has been read.
   *
   * **`null` is the only "not set", for all five.** The wire cannot tell an
   * absent key from a JSON `null` and the server never means the difference:
   * the gateway's mapper writes a field only when the proto optional is
   * present, and an unset optional resolves to a Java `null`. Making them
   * `number | null` rather than optional is what stops a reader from having to
   * ask which of two spellings of nothing arrived.
   *
   * `storyPoints` is `format: double`, so **0.5 is a legal value** and this is
   * never an integer. The column is `numeric(5,2)` (`0007-issue-planing-fields.sql`),
   * which is where the 0…999.99 bound in src/api/planningFields.ts comes from.
   * `0` is legal too, and is a count rather than an absence — the one
   * distinction an `||` anywhere near this field would erase.
   *
   * The two estimates are `int32` minutes, whole numbers, `>= 0`.
   */
  storyPoints: number | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  originalEstimateMinutes: number | null;
  remainingEstimateMinutes: number | null;
}

/**
 * One result of `GET /issues/search` — the contract's `IssueShortResponseDto`,
 * and **not** an `Issue`.
 *
 * Ten fields is everything the search route is told: the seven it always had
 * (`storyPoints` from merged PR #148) and, since backend TAS-218 (in
 * docs/contract/openapi.yml at develop `485fea5`, deployed 2026-10-09), the
 * issue's `projectId`, `projectKey` and `statusKey`. There is still no
 * `description`, no `labels`, no `updatedAt` and no `version`, which is why
 * this is its own type rather than a `Partial<Issue>`: a hit typed as an issue
 * would let a card or an edit read fields the server never sent.
 *
 * A hit carrying `projectId` opens straight to its project's board and panel
 * (`/projects/{projectId}/issues/{id}`), with no lookup. One without — a
 * gateway that predates TAS-218 — still opens through its key,
 * `/browse/{issueKey}`, resolved by `getIssueByKey` when it is chosen (TAS-246),
 * never guessed from the key's prefix. Deliberately not hydrated through
 * `getIssue` — the owner settled the general question on 2026-08-23
 * (docs/ai/API-DIVERGENCE.md, TAS-178): fix the backend, do not hydrate on the
 * frontend.
 */
export interface IssueSearchHit {
  id: string;
  issueKey: string;
  issueType: IssueTypeCode;
  /**
   * The type's look as the hit's own project registry holds it now (backend
   * TAS-418, TAS-432, `IssueShortResponseDto.issueTypeName/Color/Shape/Icon`):
   * what global search draws the type with, so it never reads a project
   * context per hit (DESIGN.md §4.6, §4.20). Each `null` when absent — all four
   * for a type deleted from the registry since, the icon alone for a type
   * without one (the wire's `null`; a key left out reads the same) — and the
   * colour, the shape and the icon `null` too for a
   * value outside the contract's sets, which the chip draws by §4.6's
   * fallbacks.
   */
  issueTypeName: string | null;
  issueTypeColor: IssueTypeColor | null;
  issueTypeShape: IssueTypeShape | null;
  issueTypeIcon: IssueTypeIcon | null;
  summary: string;
  priority: IssuePriorityCode;
  /** `""` on the wire for an unassigned issue; normalised to `null` like `Issue.assigneeId`. */
  assigneeId: string | null;
  /** The issue's project (TAS-218). Optional in the contract, so `null` when absent or blank. */
  projectId: string | null;
  /** The project's key (TAS-218), optional in the contract; `null` when absent or blank. */
  projectKey: string | null;
  /**
   * The issue's status key (TAS-218) — `required` in the contract, and typed as
   * a bare string there, so a key this build has no name for is printed
   * verbatim rather than trusted to be an `IssueStatus` (TAS-173). `null` only
   * for a gateway that predates TAS-218 and sends none.
   */
  statusKey: string | null;
  /**
   * The **one** planning field the search DTO carries: `IssueShortResponseDto`
   * in docs/contract/openapi.yml states `storyPoints` and nothing else of the
   * five — no dates, no estimates.
   *
   * Do not widen this type past it. The narrowness is the point — a hit that
   * grew a `dueDate` the server never sent would be drawn as an empty date on
   * every search result, which reads as "no due date" rather than as "not
   * asked for".
   */
  storyPoints: number | null;
}

/**
 * Who a board card is assigned to — `BoardUserDto`: an id, and the name and the
 * face the gateway joins in from auth-service since backend #205 (TAS-213).
 * Not a `User` and not a `ProjectMember`: the board route states these three
 * and nothing else, so typing it as a person would put an email, a status and
 * a colour in scope for a card that was never sent them.
 *
 * `displayName` is `string | null` and `null` is a real answer: the gateway's
 * `BoardServiceImpl` leaves it unset when the profile read fails or does not
 * know the id (it logs a warning and keeps the board), so a card draws such an
 * assignee as unknown rather than looking the id up anywhere else. The same
 * for `avatarUrl`, which is also `null` for somebody with no picture.
 */
export interface BoardAssignee {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * One card on the board — `BoardIssueDto` since backend #205 (TAS-213), and
 * still deliberately not an `Issue`: no `projectId`, no reporter, no watchers
 * and no planning fields beyond what a card draws. `storyPoints`, `dueDate`,
 * `commentCount` and `attachmentCount` are on the wire and are left out here
 * until a screen draws them — a field nobody reads is a field nobody checks.
 *
 * `issueType`, `priority` and `statusKey` stay open codes (TAS-173): the
 * board draws what it was sent, and a code this build has no word for is a
 * value to print, not a case to deny.
 */
export interface BoardIssue {
  id: string;
  issueKey: string;
  summary: string;
  issueType: IssueTypeCode;
  priority: IssuePriorityCode;
  statusKey: IssueStatusKey;
  /** Nullable on the wire; the rest leg keeps `null` rather than inventing `""`. */
  description: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  assignee: BoardAssignee | null;
  /**
   * `IssueLabelResponseDto` rows — `id`, `name`, `color` — in the order the
   * gateway lists them. A label the gateway could not resolve is left out by
   * the server; when its whole label read fails the server sends `[]` and says
   * nothing (backend A2, docs/ai/API-DIVERGENCE.md).
   */
  labels: Label[];
}

/**
 * One column — `BoardColumnDto`: a workflow status, plus the issues sitting in
 * it.
 *
 * **`statusKey` and `category` are plain strings and must stay that way.**
 * `WorkflowStatus` narrowed both to `IssueStatus` until TAS-173 opened it,
 * because this build had only ever been shown three; the board's columns come straight out of whatever
 * workflow the project has, and a value outside that union is a project
 * configuration rather than a bug. Narrowing them is how TAS-173 and TAS-199
 * blanked screens — the type would say the case cannot happen and the renderer
 * would then not draw it.
 */
export interface BoardColumn {
  statusKey: string;
  name: string;
  category: string;
  sortOrder: number;
  /** The first page of the column: at most `pageSizePerColumn` issues (backend TAS-392). */
  issues: BoardIssue[];
  /**
   * Every issue of the column that matches the read's filters, before the page
   * was cut — the count pill's number (DESIGN.md §4.9). `null` when the answer
   * did not state it as a whole number: then the pill says `Unknown`, never the
   * length of `issues`.
   */
  totalCount: number | null;
  /**
   * Whether issues of the column lie past `issues`. Stated by the server; when
   * it is not a boolean, `totalCount > issues.length` if the count is known, and
   * `null` — no foot, no claim — if it is not.
   */
  hasMore: boolean | null;
}

/**
 * `GET /projects/{projectId}/board` — `BoardResponseDto` since backend #205
 * (TAS-213), the board screen's one issue read (TAS-202).
 *
 * Without `issueType` the gateway reads the workflows of the project's
 * issue-type registry in its order (backend #226, TAS-393) — skipping a type
 * whose workflow is not found — and merges their statuses into `columns` by
 * key, the first type to state a key winning, then stably by `sortOrder`. It
 * reads the issues of those types only: an issue of a type the registry does
 * not hold is on no column and not in `unplacedIssues`.
 *
 * `unplacedIssues` holds every issue read whose status is not in **its own
 * type's** workflow — a status that stands as a column only because another
 * type's workflow has it included, a status no workflow has, and every issue
 * of a type whose workflow was not found. The board draws it as the group
 * «Outside their workflow» (DESIGN.md §4.9) and never recomputes it.
 *
 * **Capped since backend TAS-392**: each column, and `unplacedIssues` as one
 * bucket, carries at most `pageSizePerColumn` issues (the board screen asks for
 * 200, the most it may), with the true count and whether more lie past the
 * page. Nothing continues a column in its own order yet (backend A1, TAS-430),
 * so the board says how many it shows of how many and the filters — which the
 * server applies before the cap — find the rest (DESIGN.md §4.9, §5.4).
 */
export interface Board {
  projectId: string;
  columns: BoardColumn[];
  unplacedIssues: BoardIssue[];
  /** As a column's `totalCount`, for «Outside their workflow». */
  unplacedTotalCount: number | null;
  /** As a column's `hasMore`, for «Outside their workflow». */
  unplacedHasMore: boolean | null;
}

/**
 * One project's entry in `GET /project-stats` — `ProjectStatsDto`, backend
 * TAS-211: the counts and the first faces a project card draws, for every
 * project the reader lists, in one read (TAS-202).
 *
 * `issueCount` is every live issue of any type and status; `memberCount` every
 * member. Both are `null` only when the wire did not carry a number — the
 * schema requires both, so that is a malformed answer rather than a state the
 * server means, and a card says `Unknown` for it rather than `0`.
 *
 * `members` is the first five by `addedAt`, then `userId` — a preview, never
 * the whole list, and kept in the server's order.
 */
export interface ProjectStats {
  projectId: string;
  issueCount: number | null;
  memberCount: number | null;
  members: ProjectMember[];
}

export type IssueEventType =
  | "CREATED"
  | "TRANSITIONED"
  | "ASSIGNED"
  | "PRIORITY"
  | "UPDATED"
  | "DELETED"
  | "COMMENT_CREATED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED"
  /**
   * The two the attachment routes write, both already on backend `develop`:
   * `AttachmentTransactionExecutor` saves an `ATTACHMENT_UPLOADED` history row
   * inside the same transaction as the insert, and an `ATTACHMENT_DELETED` one
   * inside the soft delete (read at PR #147's head `f53dca38`, where
   * `issue-service/.../domain/IssueEventType.java` lists fourteen members).
   *
   * Added because the union being closed is not what protects the activity
   * feed — `historyText` ends in a catch-all `return "updated this issue"`, so
   * before this every upload rendered as *"Anna updated this issue"*, a
   * sentence about the wrong event with nothing on screen to contradict it.
   * Widening the type is only half the fix; the branch in `historyText` is the
   * other half, and neither works alone.
   *
   * The gateway does **not** constrain this field — `IssueHistoryResponseDto`
   * types `eventType` as a bare `type: string` with no enum — so this union is
   * a statement about the values this build can *name*, never a guarantee about
   * what arrives. Four more the backend already emits (`LINK_CREATED`,
   * `LINK_DELETED`, `LABEL_ADDED`, `LABEL_REMOVED`) are still missing from it
   * and still land in the catch-all; they are out of this story's scope and are
   * recorded rather than quietly added here.
   */
  | "ATTACHMENT_UPLOADED"
  | "ATTACHMENT_DELETED"
  /**
   * The three the worklog routes write (backend PR #178, `WorklogExecutor`,
   * merged at 405b5fe), each inside the same transaction as the write. The added
   * and updated payloads carry `worklogSpentMinutes`; the deleted one does not.
   */
  | "WORKLOG_ADDED"
  | "WORKLOG_UPDATED"
  | "WORKLOG_DELETED";

/**
 * How a change reached Taska when it did not come from the UI (TAS-411, epic
 * TAS-399): through the MCP server, or straight to the gateway with a personal
 * access token. Neither is on the wire yet — see `ActionVia`.
 */
export type ActionChannel = "API_TOKEN" | "MCP";

/**
 * The channel mark on a history event or a comment (TAS-412, for TAS-411).
 * **Not in the contract and not served**: backend develop `92a00dbc` sends no
 * such field, `RestTaskaApi` therefore states none (`via: null`), and only the
 * mock seeds it, so the mark can be seen and tested before the backend says
 * what it is called and what it holds (docs/ai/API-DIVERGENCE.md, "TAS-412").
 *
 * Absent or `null` is a change made in the UI, and it renders exactly as it
 * did before this field existed. `tokenName` is the token's name when the
 * server names it, `null` when it does not.
 */
export interface ActionVia {
  channel: ActionChannel;
  tokenName: string | null;
}

export interface IssueHistoryEvent {
  id: string;
  issueId: string;
  eventType: IssueEventType;
  actorUserId: string;
  /**
   * Who did it, as the server names them (backend TAS-398): the profile behind
   * `actorUserId` — a former member of the project included — or `null` when no
   * profile was found. Only the details read carries it; the transition
   * answer's history never does, and absent reads as `null`. A blank name is
   * `null` (§4.21), so the Activity row falls through to the member list and
   * then to "Unknown" (`personFor`, DESIGN.md §4.26).
   */
  actor?: UserSummary | null;
  occurredAt: string;
  /** The channel mark (`ActionVia`): mock only until TAS-411. */
  via?: ActionVia | null;
  payload: {
    from?: IssueStatusKey;
    to?: IssueStatusKey | IssuePriorityCode | null;
    field?: string;
    fromStatus?: IssueStatusKey;
    toStatus?: IssueStatusKey;
    assigneeId?: string | null;
    previousAssigneeId?: string | null;
    oldPriority?: IssuePriorityCode;
    newPriority?: IssuePriorityCode;
    /**
     * `PayloadSerializer.createAttachmentUploadedPayload` and
     * `createAttachmentDeletedPayload` both put the file name here, and it is
     * the only field of either payload the activity feed prints. The rest —
     * `attachmentId`, `uploadedBy`, `deletedBy`, `contentType`, `sizeBytes` —
     * arrive too and are reachable through the index signature; they are not
     * declared because nothing draws them, and a declared field nobody reads is
     * a promise about a payload this app has never seen.
     */
    fileName?: string;
    [key: string]: unknown;
  };
}

/**
 * One file attached to an issue — `IssueAttachmentDto` (backend PR #147, in
 * `docs/contract/openapi.yml` since it merged), field for field.
 *
 * `sizeBytes` is `format: int64` on the wire and a `number` here, and that is
 * safe rather than convenient: the server refuses anything above
 * `ATTACHMENT_MAX_SIZE_BYTES` (2097152) at leg 1 *and* re-measures the stored
 * object at leg 3, so no row this type describes can hold a value within eleven
 * orders of magnitude of `Number.MAX_SAFE_INTEGER`. A `bigint` would buy
 * nothing and would cost every caller an arithmetic conversion to divide by
 * 1024.
 *
 * `objectKey` is deliberately absent: the gateway's mapper
 * (`IssueAttachmentMapper.toIssueAttachmentDto`) never sets it, so no client
 * has ever seen one on a listed attachment. It exists only inside one upload,
 * as the value leg 1 hands to leg 3, and that is where it stays.
 *
 * A presigned download URL is absent for the same reason and it is worth
 * stating, because the service one layer down *does* mint one per row:
 * `AttachmentServiceImpl.listAttachments` builds a presigned GET for every
 * attachment and the gateway's mapper drops it. So `GET .../download-url` is
 * not a redundant second call — it is the only way this contract offers a link.
 */
export interface IssueAttachment {
  id: string;
  issueId: string;
  fileName: string;
  /** Exactly as it was signed. Never normalised, never recomputed from the extension. */
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  /**
   * The uploader, named by the server (`IssueAttachmentDto.uploadedByUser`,
   * backend TAS-214). `null` when the response did not carry it — every gateway
   * before `60d62ee` — and then the row is named the way it was before.
   */
  uploadedByUser: UserSummary | null;
  /**
   * The object's ETag with its quotes stripped, which for a single-part PUT is
   * the MD5 of the bytes. `nullable: true` in the contract and blank-to-`null`
   * in the gateway's mapper, though the column itself is `NOT NULL` — so a
   * `null` here means "the gateway sent an empty string", not "the row has no
   * checksum".
   */
  checksum: string | null;
  createdAt: string;
}

/** What leg 1 hands back: where to PUT the bytes, and what to call the object at leg 3. */
export interface AttachmentUploadTicket {
  /**
   * A presigned S3 URL on `storage.public-url`, **not on the gateway**. The
   * signature is in the query string, it covers the `Content-Type` header, and
   * it is honoured for `ATTACHMENT_PRESIGNED_TTL_MS` from the moment this
   * ticket was minted.
   */
  uploadUrl: string;
  /** Opaque; a bare UUID today. The only thing leg 3 identifies the object by. */
  objectKey: string;
}

/**
 * What leg 1 of an **avatar** upload hands back — `CreateAvatarUploadUrlResponseDto`
 * (backend PR #150, merged at `develop` `368ae77355bd`). Same shape as the
 * attachment ticket above plus the one field that DTO adds, and deliberately a
 * separate type: the two are minted by two services against two buckets, and a
 * ticket for one is not a ticket for the other.
 */
export interface AvatarUploadTicket {
  /**
   * A presigned S3 URL on auth-service's `storage.public-url` — a loopback
   * address unless the deployment overrides it — and **not on the gateway**.
   * The signature is in the query string, it covers the `Content-Type` header,
   * and it is honoured for auth-service's `storage.presigned-url-ttl` from the
   * moment this ticket was minted: 15 minutes by default, and an environment
   * may set it otherwise.
   */
  uploadUrl: string;
  /**
   * Opaque — a bare UUID at `368ae77355bd`. The only thing the confirm
   * identifies the object by, and it must be confirmed **once**: see
   * `confirmAvatarUpload` on TaskaApi for what a second confirm of the same key
   * does.
   */
  objectKey: string;
  /**
   * The link's own lifetime in seconds, as the server states it — 900 under
   * auth-service's default `MINIO_PRESIGNED_URL_TTL` of 15m, and whatever an
   * environment that overrides it says otherwise. Kept because the response
   * declares it and because it is the server's number rather than this
   * client's. `AVATAR_PRESIGNED_TTL_MS` records the same default, but the two
   * are not wired together: the profile menu's "15 minutes" wording is a
   * literal, written separately.
   */
  expiresIn: number | null;
}

/** `GetAttachmentDownloadUrlResponseDto` — a presigned GET, and the checksum again. */
export interface AttachmentDownloadUrl {
  downloadUrl: string;
  checksum: string | null;
}

/**
 * The issue panel's one read — `GET /issues/{issueId}` answering
 * `IssueDetailsResponseDto` (backend TAS-214, develop `60d62ee`). Everything a
 * panel draws except the comments, which stay a paged read of their own.
 *
 * **The four parts are `null` when the server did not send them — and on this
 * gateway a part that failed is sent anyway, as `[]`.** issue-service loads
 * labels, watchers, links and attachments side by side and a part whose source
 * fails is left unset rather than failing the read
 * (`IssueDetailsServiceImpl.fetchWithFallback`); the gateway then copies only
 * the parts that are set (`IssueMapper.toRestIssueDetailsWithHistoryResponseDto`)
 * — into a DTO that openapi-generator 7.23 (`openApiNullable=false`) has
 * already initialised with `new ArrayList<>()`. So an unset part reaches the
 * wire as `[]`, indistinguishable from a part that really is empty. That is read
 * from the backend's code and its own test — `IssueMapperTest
 * .shouldMapIssueWithoutOptionalFields`, which asserts the empty lists for parts
 * never set, at develop `60d62ee` — and not measured on the wire, since no
 * authenticated details read has been observed. Recorded in
 * docs/ai/API-DIVERGENCE.md as "GET /issues/{issueId}: a failed part arrives as
 * [] and an unnamed person as a blank or absent displayName".
 *
 * `null` stays in the type for an absent key or a JSON `null`, which is what a
 * mapper that marked the parts `nullable` would send, and the panel says "could
 * not be loaded" for it. Against today's gateway that branch is reached in one
 * way only: the watchers section treats `isWatching: true` beside a list
 * without the reader in it as a part that did not load.
 *
 * `labels` is overridden from `Issue` for that reason: on a list row it is
 * always an array, on this read it can be missing.
 *
 * Not a widening of `Issue` for the board's cards: the list route still answers
 * `IssueResponseDto`, and none of these fields exist there.
 */
export interface IssueDetails extends Omit<Issue, "labels"> {
  labels: Label[] | null;
  /**
   * The two people the issue names, with their names. `assigneeId` and
   * `reporterId` stay beside them and stay the identity: a summary is `null`
   * when the response did not carry one, and the id is still who it is.
   */
  assignee: UserSummary | null;
  reporter: UserSummary | null;
  /**
   * The subscriptions, each now carrying the subscriber's name. Shaped as the
   * list read's `IssueWatchers` so the panel's watcher section reads one type
   * whichever route filled it. The details DTO states no count, so
   * `totalCount` is always `null` on this read — not the list's length, which
   * would be a number the server never stated, and a wrong one whenever the
   * part failed and arrived as `[]`. The panel draws no count until this read
   * carries one (backend ask A3).
   */
  watchers: IssueWatchers | null;
  /** Whether the reader is subscribed, by the server's own reckoning. `null` when not sent. */
  isWatching: boolean | null;
  links: IssueLink[] | null;
  attachments: IssueAttachment[] | null;
  /** Live comments on the issue. `null` when not sent. */
  commentCount: number | null;
}

export interface IssueDetailsWithHistory {
  issue: IssueDetails;
  history: IssueHistoryEvent[];
}

/*
 * `IssueLinkType` — the link type a *request* may ask for, the contract's
 * `IssueLinkTypeDto` — is declared with the other enums at the top of this
 * file. Deliberately not reused for the response: see `IssueLink`.
 */

export interface IssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  /**
   * Open on purpose. The contract asks for `linkType` (the closed enum above)
   * and answers with `viewLinkType`, an enum of its own — `IssueLinkViewTypeDto`
   * since backend PR #200 — and the asymmetry is the contract's, not a typo to
   * be corrected here. "View" means the relation *as seen from the issue that
   * was asked about*, so the response carries the inverse of a request value
   * (`IS_BLOCKED_BY` for a `BLOCKS` link) which the request enum has no name
   * for. Narrowing this to `IssueLinkType` would therefore drop exactly the
   * values that make the field worth having.
   *
   * Presentation narrows it instead (`issueLinkTypeLabel`): a known value gets
   * a written label, anything else is humanised verbatim. The contract spells
   * every value with the proto enum's prefix (`ISSUE_LINK_VIEW_TYPE_BLOCKS`) and
   * lists `ISSUE_LINK_VIEW_TYPE_UNSPECIFIED` and `UNRECOGNIZED` beside them, so
   * `RestTaskaApi` strips that prefix and reads those two as no relation (`""`)
   * before the value gets here. Since that PR the prefix is the contract's own
   * reading rather than a divergence from it (docs/ai/API-DIVERGENCE.md).
   */
  viewLinkType: string;
  createdBy: string;
  createdAt: string;
  /**
   * The issue at the other end of the link, as the server resolved it
   * (`IssueLinkResponseDto.target`, backend TAS-214) — so a row can print a
   * key and a summary, and open an issue in another project, without the
   * client reading that project. `null` when the response did not carry it.
   */
  target: LinkedIssue | null;
}

/**
 * `TargetIssueDto`. `statusKey` is a plain string for the reason
 * `BoardColumn.statusKey` is: a workflow may name statuses this build has never
 * seen.
 */
export interface LinkedIssue {
  id: string;
  issueKey: string;
  summary: string;
  projectId: string;
  statusKey: string;
}

/**
 * One subscription row — `IssueWatcherResponseDto`.
 *
 * Since backend TAS-214 the row names its subscriber (`displayName`,
 * `avatarUrl`). When it does not — an older gateway, or auth-service down and
 * the name blank — the person is resolved the way every person on the panel is
 * when the server did not name them: through the `userById` map the board
 * builds from `GET /projects/{id}/members`, and then "Unknown" (`personFor`,
 * src/lib/people.ts).
 *
 * `createdBy` is not `userId`: a project ADMIN may subscribe somebody else
 * through `POST .../watchers`, and then the two differ.
 */
export interface IssueWatcher {
  /** The subscription's own id. Never the user's. */
  id: string;
  issueId: string;
  projectId: string;
  /** The subscribed person. */
  userId: string;
  createdAt: string;
  createdBy: string;
  /**
   * The subscriber's name and picture, carried on the row since backend
   * TAS-214. `null` when the response did not carry them, and a blank name is
   * `null` too — see `UserSummary.displayName` for why `""` is not a name.
   */
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * `ListIssueWatchersResponseDto` — and the two fields are kept apart on purpose.
 *
 * `totalCount` is the server's own answer to "how many", stated beside the
 * array rather than derived from it, and it is what the UI prints. The array is
 * what the UI lists. Reading the count off `watchers.length` would be this
 * side deciding a number the server already sent, and the route takes no paging
 * parameter, so if the two ever disagree there is nothing the client could ask
 * to reconcile them — printing the field the contract calls the total is the
 * only reading that cannot be wrong on purpose.
 *
 * `null` means the server did not send it. No field of this DTO is `required`,
 * so an answer with only `watchers` is legal, and "the server did not say" must
 * not arrive at a screen looking like the number zero.
 */
export interface IssueWatchers {
  watchers: IssueWatcher[];
  totalCount: number | null;
}

/** `WatchIssueResponseDto` — the row that now exists, and the count after it. */
export interface WatchIssueResult {
  /**
   * `null` when the response omitted it. Nothing in the UI needs the row — the
   * caller knows who was subscribed, because it asked — so this is carried for
   * completeness rather than read.
   */
  watcher: IssueWatcher | null;
  /** The count after the write, `null` when the server did not state one. */
  watchersCount: number | null;
}

/**
 * `UnwatchIssueResponseDto`, and `removed` is the field this whole type exists
 * for.
 *
 * `removed: false` is a **successful** response saying that nothing was
 * deleted, because there was no subscription to delete. The end state is the
 * one that was asked for either way, so this is not a failure and must not be
 * shown as one — but it is also not the change the reader thinks they just
 * made, and flattening the two is how a UI comes to report events that did not
 * happen (the same distinction TAS-194 drew for the outbox retry).
 */
export interface UnwatchIssueResult {
  issueId: string;
  /** Whether a subscription was actually deleted, as opposed to never existing. */
  removed: boolean;
  /** The count after the write, `null` when the server did not state one. */
  watchersCount: number | null;
}

/**
 * `IssueWorklogResponseDto` (backend PR #178, TAS-118 — merged at 405b5fe, see
 * docs/contract/openapi.yml). Time somebody spent on an issue.
 *
 * It names its author by id only: no route carries the author's name, so the
 * panel joins it with the project context's members (`personFor`), and an id
 * the members cannot name is drawn as the panel's unknown person.
 */
export interface IssueWorklog {
  id: string;
  issueId: string;
  projectId: string;
  authorUserId: string;
  /** Whole minutes, at least 1. The server sets no upper bound. */
  spentMinutes: number;
  /** The day the time is booked against, `yyyy-MM-dd` — a calendar day, not an instant. */
  workDate: DateOnly;
  /** `null` when there is none; the server stores a blank comment as `null`. */
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  /**
   * Who logged it, as the list names them (backend TAS-421): the profile behind
   * `authorUserId` — a former member included — or `null` when no profile was
   * found. **Absent** — the key not there — on a write's answer, which does not
   * name the author: a row that already knew its author keeps it.
   */
  author?: UserSummary | null;
}

/**
 * One page of an issue's work log (`ListIssueWorklogsResponseDto`, backend
 * TAS-421): newest first — `workDate`, `createdAt`, `id`, all descending.
 * `totalCount` (every live entry of the issue) and `hasMore` are `null` when
 * the answer did not state them as a number and a boolean: an unstated count is
 * never the length of the page, and an unstated `hasMore` never means the list
 * is complete.
 */
export interface IssueWorklogPage {
  items: IssueWorklog[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
}

export interface IssueComment {
  id: string;
  issueId: string;
  projectId: string;
  authorUserId: string;
  /** The author, named by the server since backend TAS-214; `null` when not carried. */
  author: UserSummary | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  version: number;
  /** The channel mark (`ActionVia`): mock only until TAS-411. */
  via?: ActionVia | null;
}

export interface Notification {
  id: string;
  /**
   * Any string the wire carries. A named kind keeps its autocompletion; an
   * unlisted one is representable instead of being a value the type claims
   * cannot exist (see `NotificationType`).
   */
  notificationType: NotificationType | (string & {});
  title: string;
  body: string;
  /**
   * The issue the notification is about, and the project that issue is in.
   * All three are `null` on a notification that is not about an issue —
   * `MEMBER_*`, `PROJECT_CREATED`, `USER_*` — and on every notification written
   * before the gateway started storing them: the migration that added the
   * columns did not backfill them, so an issue notification that old carries
   * none of the three.
   *
   * A third case sends `issueId` alone: an `ISSUE_ATTACHMENT_ADDED` or
   * `ISSUE_ATTACHMENT_DELETED` written before backend PR #191 (TAS-245), when
   * issue-service's `PayloadSerializer` did not call `putIssueFields` for
   * them. New attachment notifications carry all three; the old rows were not
   * backfilled. `notificationRoute` (src/domain/notifications.ts) needs both
   * `issueId` and `projectId` to open an issue, so such an old row opens
   * nothing.
   *
   * A fourth sends `projectId` alone: `PROJECT_ARCHIVED` (backend PR #159,
   * TAS-146) names the project and no issue, and opens that project's board,
   * which an archived project still serves read-only (TAS-149).
   */
  issueId: string | null;
  issueKey: string | null;
  projectId: string | null;
  createdAt: string;
  readAt: string | null;
  sourceEventId: string;
}

/**
 * One page of the inbox, plus the reader's unread total across *all* of their
 * notifications — the server counts it independently of `pageSize`, `offset`
 * and `unreadOnly`, so it is never a count of `items`.
 */
export type NotificationPage = Page<Notification> & { unreadCount: number };

export interface Page<T> {
  items: T[];
  page?: number;
  pageSize: number;
  totalCount?: number;
  offset?: number;
}

/* ==================== Read-only admin console (TAS-155) ====================
 *
 * `/api/v1/readonly/*` is a generic window onto the services' own tables, so
 * unlike the rest of this file these types describe *shapes the server
 * declares at runtime* rather than a schema known at build time. A row is
 * therefore `unknown` per column, not `string` — the console renders whatever
 * it is handed and never assumes a type it was not told about.
 */

export interface AdminColumn {
  name: string;
  type: string;
  /**
   * Column the catalog marks as holding secrets. The server masks it before it
   * leaves admin-service, three different ways, so this flag says the column is
   * masked — not that nothing of it is drawn. A partial mask is a value and is
   * printed; see `isWithheld` for which of the three arrived.
   *
   * The contract does not require the field. `RestTaskaApi` defaults a missing
   * one to `true`, so this is a boolean by the time anything reads it.
   */
  sensitive: boolean;
}

export interface AdminTable {
  name: string;
  columns: AdminColumn[];
  primaryKey: string;
}

export interface AdminService {
  name: string;
  databaseAlias: string;
  tables: AdminTable[];
}

export interface AdminCatalog {
  services: AdminService[];
}

/**
 * The contract spells filters as query keys `column.operator`, with the
 * operator always present: `column.equals`, `column.contains`, `column.from`,
 * `column.to`. Kept structured here so the UI never hand-builds a key, and so
 * the API layer is the only place that knows the wire spelling.
 *
 * The gateway also decides which operator a column may take from that column's
 * type and answers 400 for the rest, which is why the catalog's `type` is not
 * decoration — see `src/screens/admin/columns.ts`.
 */
export type AdminFilterOperator = "equals" | "contains" | "from" | "to";

export interface AdminFilter {
  column: string;
  operator: AdminFilterOperator;
  value: string;
}

export type AdminSortOrder = "asc" | "desc";

export interface AdminRowsQuery {
  service: string;
  table: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: AdminSortOrder;
  filters?: AdminFilter[];
}

export interface AdminPagination {
  currentPage: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * What the server says about the table it just returned. `columns` is the
 * authority on which columns exist and in what order — the rows themselves are
 * bags of keys and cannot be trusted to agree with each other, least of all
 * when a value is null.
 */
export interface AdminRowsMeta {
  service: string;
  table: string;
  columns: string[];
  sortableColumns: string[];
  filterableColumns: string[];
}

/** One record of a service table: a bag of columns whose types are runtime news. */
export type AdminRow = Record<string, unknown>;

export interface AdminRows {
  rows: AdminRow[];
  pagination: AdminPagination;
  meta: AdminRowsMeta;
}

/**
 * `GET /readonly/audit-entries` (backend PR #197, TAS-160) — what the Audit
 * section asks. `page` is **1-based** here, like every other admin page in the
 * domain; the rest leg converts it to the wire's 0-based one.
 *
 * Every filter is an exact match and an absent one is no filter. The two dates
 * are `yyyy-MM-dd`, read by the server as whole UTC days with both ends
 * inclusive; nothing else is accepted for them, and a `from` after `to` is a
 * 400. `actorUserId` must be a UUID (`format: uuid`): anything else is the
 * gateway's own 400, which the section never spends — it checks the value
 * before asking.
 */
export interface AuditEntriesQuery {
  page?: number;
  pageSize?: number;
  actorUserId?: string;
  action?: string;
  targetService?: string;
  targetTable?: string;
  targetId?: string;
  requestId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}

/**
 * One row of the admin audit log (`AuditEntryDto`).
 *
 * Every field is nullable here although the table behind it declares nine of
 * them `NOT NULL` (the id, the actor's id and name, action, the three target
 * fields, reason and the time): the schema has no `required` block, so the
 * wire promises nothing and the mapping takes nothing on trust. `requestId`,
 * `oldValue`, `newValue` and `actorEmail` are nullable in the database as well.
 *
 * `actorDisplayName` and `actorEmail` are a snapshot of who acted, taken when
 * the row was written (backend PR #219, TAS-388). The name column used to hold
 * the actor's login and was renamed rather than refilled, so on a historical
 * row it still carries that old designation (`mark`) and the email is empty.
 * The same `actorUserId` can therefore appear under two names; nothing here
 * reconciles them, and the actor is never looked up by id on the client.
 *
 * `id` is the row's primary key (`format: uuid`, backend PR #197) and what the
 * section keys a row by. It is still `string | null` for the reason above, and
 * a row without one falls back to being named by what it says
 * (`auditEntryKeys` in src/screens/admin/audit.ts).
 *
 * `oldValue` and `newValue` are JSON documents **as text**, with sensitive
 * values already masked by the server (`"***"`). They are carried exactly as
 * they arrived; parsing them is the screen's job, and it falls back to the raw
 * text when they do not parse.
 */
export interface AuditEntry {
  id: string | null;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorEmail: string | null;
  action: string | null;
  targetService: string | null;
  targetTable: string | null;
  targetId: string | null;
  reason: string | null;
  requestId: string | null;
  createdAt: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface AuditEntries {
  entries: AuditEntry[];
  pagination: AdminPagination;
}

/**
 * One row by its primary key (`GET /readonly/{service}/{table}/{id}`).
 *
 * `id` is a string here because a primary key is whatever the table says it is,
 * but the gateway types the path parameter as a `UUID` — a table keyed by
 * anything else cannot be addressed at all, which is why §5.8 only makes a row
 * clickable when the catalog says its key column is `uuid`.
 */
export interface AdminRowQuery {
  service: string;
  table: string;
  id: string;
}

/**
 * One problematic transactional-outbox event, as
 * `GET /readonly/outbox/problematic-summary` reports it (the Events section,
 * DESIGN.md §5.8).
 *
 * This is a row of `outbox_events` with two fields added by the summary —
 * `serviceKey`, because the endpoint answers for every service at once, and
 * `reason`. Unlike the generic admin reads above, the shape *is* known at build
 * time here: the endpoint declares it.
 *
 * `status` stays an open `string` rather than a union. It is raw table data,
 * the contract types it as a bare string with no enum, and the three values a
 * problematic row can carry today (`FAILED`, `PROCESSING`, `NEW`) are a fact
 * about the backend's query, not a promise. The UI derives the category from it
 * and prints anything else verbatim.
 *
 * `reason` is a human-readable English sentence the backend writes, not a code.
 * Nothing may parse or switch on it — the category comes from `status` — and it
 * is rendered on the summary list's category cell, in `title` and in that
 * cell's accessible name: the visible word is the derived category, the
 * server's whole sentence is one hover or one screen reader away. Not a column
 * of its own and not on the event card, which draws the table's catalog
 * columns — `reason` is a field of the summary, and a row opened by its own
 * address does not have one (§5.8).
 */
export interface ProblematicOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  attempts: number;
  lastErrorMessage: string | null;
  processingStartedAt: string | null;
  requestId: string | null;
  serviceKey: string;
  reason: string;
  /**
   * Whether admin-service would retry this event as of the read — backend
   * PR #195 (TAS-200), required on the wire: `FAILED`, or `PROCESSING` whose
   * `processingStartedAt` is earlier than now minus the retry stuck threshold
   * (`ADMIN_OUTBOX_RETRY_STUCK_THRESHOLD`, 10 minutes by default). `false` for
   * `NEW` and `PUBLISHED`, and for a `PROCESSING` row listed as stuck by the
   * shorter processing timeout but not yet past the retry threshold. A
   * snapshot: the retry command checks again and may refuse.
   */
  retryable: boolean;
}

/**
 * How many problematic events one service has, by category. The counts cover
 * every outbox service and every problematic row, including the ones the
 * summary's own list was cut short of — which is what makes the matrix the
 * answer to "what is broken and where" rather than a caption for the list.
 */
export interface ProblematicOutboxCounts {
  serviceKey: string;
  overdueNewCount: number;
  stuckProcessingCount: number;
  failedCount: number;
}

/**
 * The whole summary. `events` arrives oldest first and is capped by the
 * server's own limit; `notAllShown` says the cap was reached, which is a
 * statement about this response rather than an error.
 */
export interface ProblematicOutboxSummary {
  events: ProblematicOutboxEvent[];
  counts: ProblematicOutboxCounts[];
  notAllShown: boolean;
}

/**
 * What `POST /admin/outbox/{service}/{eventId}/retry` says the event is now
 * (`RetryOutboxEventResponseDto`) — the state read back out of the row *after*
 * the update, not an echo of what was asked for.
 *
 * `status` is an open `string`, like every other outbox status in this file and
 * for the same reason: the contract types it as a bare string with no enum. On
 * the backend as it stands the answer is always `NEW` — the UPDATE sets it —
 * but the client reports what it was told rather than what it expected, so a
 * backend that grows a `REQUEUED` state prints that instead of lying.
 *
 * `attempts` is `null` when the response omitted it: the schema marks it
 * `nullable`, and the field is the row's own count, which the retry does **not**
 * reset — `attempts` is absent from the UPDATE (`OutboxRetryRepositoryImpl`,
 * backend `develop`). So the number that comes back is the number that was
 * already there, and nothing in the UI may present it as a fresh start.
 */
export interface OutboxRetryResult {
  eventId: string;
  status: string;
  attempts: number | null;
}

/** Where the reader's Telegram binding stands, as `NotificationPreferencesDto` lists it (TAS-387). */
export type TelegramStatus = "NOT_CONNECTED" | "PENDING" | "AWAITING_CONFIRMATION" | "CONNECTED" | "UNAVAILABLE";

/** Current-user delivery channels (TAS-387). The in-app inbox is independent. */
export interface NotificationPreferences {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  email: string;
  telegramAvailable: boolean;
  /**
   * `null`: the server stated a status this build does not know (TAS-173);
   * only Disconnect is offered.
   */
  telegramStatus: TelegramStatus | null;
  telegramUsername: string | null;
  telegramName: string | null;
  telegramLinkId: string | null;
  telegramLinkExpiresAt: string | null;
  telegramError: string | null;
}

export interface NotificationPreferencesPatch {
  emailEnabled?: boolean;
  telegramEnabled?: boolean;
}

/** A short-lived bearer link: keep it in memory, never in browser storage. */
export interface TelegramLink {
  linkId: string;
  url: string;
  expiresAt: string;
  /**
   * The reader's settings as the server holds them after it issued this link,
   * in the same transaction (`TelegramLinkDto.preferences`, required since
   * backend TAS-387). The section draws from it; there is no separate read.
   */
  preferences: NotificationPreferences;
}

/**
 * One of the reader's personal access tokens (TAS-412; `PersonalAccessTokenDto`
 * of backend TAS-402) — what the list shows and the create answer describes.
 * **Never the secret**: the token's value is shown once, in
 * `IssuedAccessToken`, and nothing that holds this type holds it.
 * `tokenPrefix` is the token's first characters (`tsk_pat_3fA9`), which is all
 * the reader is shown of it afterwards.
 *
 * `scopes` is an open list, like every other value set the server names
 * (TAS-173): `["read"]` and `["read", "write"]` are the two this build asks
 * for and names; anything else is printed as it came.
 */
export interface AccessToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  /** `null`: the token has never been used. */
  lastUsedAt: string | null;
}

/**
 * `PersonalTokenPolicyDto`: the longest lifetime a new token may have, in
 * days, and how many unexpired tokens an account may hold at once. The list
 * read carries it; the create form offers lifetimes up to the first.
 */
export interface AccessTokenPolicy {
  maxLifetimeDays: number;
  maxActiveTokens: number;
}

/**
 * `GET /users/me/access-tokens`: the reader's tokens that are not revoked —
 * expired ones included — in the server's order (`createdAt`, then `id`, both
 * newest first), and the policy; `null` when the answer carried none this
 * build can read.
 */
export interface AccessTokenList {
  tokens: AccessToken[];
  policy: AccessTokenPolicy | null;
}

/**
 * What creating a token answers with: the token, and its value — **once**.
 * The secret lives only in the creating dialog's own state and leaves with
 * it: never a query or mutation cache, browser storage, the address or a log
 * (TAS-412's acceptance).
 */
export interface IssuedAccessToken {
  token: AccessToken;
  secret: string;
}
