import type {
  AcceptInvitationInput,
  AuthTokens,
  ConfirmAttachmentUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CreateProjectLabelInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  RetryableOutboxService,
  SearchIssuesParams,
  TaskaApi,
  UpdateIssueInput,
  UpdateProjectLabelInput,
} from "../TaskaApi";
import {
  ADMIN_WRITE_REASON_MAX_LENGTH,
  ADMIN_WRITE_REASON_REQUIRED_MESSAGE,
  ADMIN_WRITE_REASON_TOO_LONG_MESSAGE,
  OUTBOX_RETRY_REASON_MAX_LENGTH,
  OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_QUERY_TOO_SHORT_MESSAGE,
} from "../TaskaApi";
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_PRESIGNED_TTL_MS,
  ATTACHMENT_STORE_ORIGIN,
  ATTACHMENT_STORE_REJECTED_CODE,
  ATTACHMENT_STORE_UNREACHABLE_CODE,
  AttachmentStoreError,
  attachmentRefusal,
  attachmentRefusalKind,
  attachmentSizeRefusalMessage,
  requireUsableUploadUrl,
} from "../attachments";
import type { PlanningFields, PlanningFieldsInput, StoredPlanningDates } from "../planningFields";
import { emptyPlanningFields, planningFieldRefusal, resolvePlanningFields } from "../planningFields";
import type {
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AdminTable,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueHistoryEvent,
  IssueLink,
  IssueLinkType,
  IssuePriority,
  IssueSearchHit,
  IssueStatus,
  IssueType,
  IssueWithHistory,
  Label,
  Notification,
  OutboxRetryResult,
  Page,
  ProblematicOutboxCounts,
  ProblematicOutboxEvent,
  ProblematicOutboxSummary,
  Project,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  User,
  UserStatus,
  UserStatusChange,
  Workflow,
} from "../../domain/types";
import type { AdminColumnClass } from "../../lib/adminColumnTypes";
import { classifyColumnType } from "../../lib/adminColumnTypes";

const ANNA_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK_ID = "e65186a2-b807-42ae-a66f-711be116a93b";
const SOFIA_ID = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const TOM_ID = "1ab80365-0843-460a-b0a1-e6dd3e0f2a0d";
const PRIYA_ID = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
// Added by TAS-186 rather than restyling one of the five above: the Users
// section has to show all account states at once, and moving an existing
// person into INVITED or BLOCKED would have quietly changed what every other
// screen and spec sees on the board.
const LEO_ID = "b0e3d1c4-1f24-4a1a-9a3e-2ad0c9f7b511";
const NINA_ID = "c47a9b21-6d5e-4f0b-8c72-9e13a4f8d602";
// The fourth status, added by TAS-188 on the same rule and for the same reason.
// `LOCKED` is the one state nobody here put an account into: it is where
// auth-service leaves a person who mistyped their password too many times.
const OMAR_ID = "d58f0e73-4b2c-4c9d-8e15-3f6a70b2c9d4";

const TASKA_PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const WEB_PROJECT_ID = "58e93598-ea1a-460d-9d72-f1f201c310e2";
const MOB_PROJECT_ID = "f315c5cf-3333-47d1-8d22-79f07c2ec99b";
const OPS_PROJECT_ID = "64d70a2b-72b0-4866-bdbf-4f71a416f9e4";

// Mirrors how RestTaskaApi keeps its tokens in localStorage, so a reload behaves
// the same in both modes: the id of the signed-in user, nothing secret.
const SESSION_KEY = "taska.mockSession";

const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const TODO_STATUS_ID = "22222222-2222-2222-2222-222222222222";
const IN_PROGRESS_STATUS_ID = "33333333-3333-3333-3333-333333333333";
const DONE_STATUS_ID = "44444444-4444-4444-4444-444444444444";

/**
 * File names that steer this mock down a failure branch, matched
 * case-insensitively as a substring of the name. **A mock-only seam**, and the
 * only one in this file — but the alternative was a feature whose four
 * interesting failures could not be reached by anybody, in the one environment
 * where the feature can be reached at all.
 *
 * Three of the four are unreachable by any other means today. The middle leg of
 * an upload goes to an object store that is not deployed, is not CORS-configured
 * and has no browser-reachable address, so "the store refused it", "the store
 * could not be reached" and "the link expired" cannot be produced by using the
 * product — and the fourth, a confirm that fails after the bytes landed, is the
 * one that orphans an object and states the most important sentence in the
 * panel.
 *
 * Triggering on the file name rather than on a flag keeps the seam out of the
 * production API surface: nothing on `TaskaApi` grows a test parameter, and a
 * reader can exercise a failure by renaming a file on their desktop.
 *
 * Not in this list, because this mock structurally cannot produce it: the
 * undeployed-route signature. That is a **404 with `No static resource` in the
 * message**, and `MockApiError` carries no HTTP status at all — by design, see
 * src/api/errors.ts. It only exists against `rest` and `hybrid`.
 */
export const MOCK_ATTACHMENT_TRIGGERS = {
  /** Leg 2 rejects with no response at all, the way a blocked CORS preflight does. */
  storeUnreachable: "cors-blocked",
  /** Leg 2 answers 500. */
  storeRefused: "store-500",
  /** Leg 1 mints a ticket that is already past its fifteen minutes, so leg 2 answers 403. */
  expiredTicket: "expired-link",
  /** Legs 1 and 2 succeed and leg 3 fails — the case that orphans an object. */
  confirmFails: "confirm-fails",
} as const;

type MockUploadBehaviour = "ok" | "storeUnreachable" | "storeRefused" | "confirmFails";

/** One presigned upload this mock has handed out and is still willing to honour. */
interface MockUploadTicket {
  objectKey: string;
  issueId: string;
  projectId: string;
  /** Exactly the value signed at leg 1. Leg 2 compares byte for byte, as S3 does. */
  contentType: string;
  /** Epoch ms. Past it, leg 2 answers 403 — the store's answer for a stale signature. */
  expiresAt: number;
  behaviour: MockUploadBehaviour;
}

/** An object that has actually been PUT into this mock's stand-in bucket. */
interface MockStoredObject {
  contentType: string;
  sizeBytes: number;
  checksum: string;
}

interface StoredAttachment {
  id: string;
  issueId: string;
  uploadedBy: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
  /** Soft delete, like the server's: the row stays and stops being listed. */
  deletedAt: string | null;
}

/**
 * An ETag-shaped checksum: 32 lowercase hex characters, deterministic in the
 * bytes. **Not MD5** — the server's value is the object's real ETag and this is
 * an FNV-1a variant, because nothing in the product compares one to the other
 * and shipping a hash implementation to make a mock's field look authentic
 * would be code with no reader. What matters is that it is stable for the same
 * bytes and different for different ones, which is what any consumer of a
 * checksum relies on.
 */
const mockChecksum = (bytes: Uint8Array) => {
  let out = "";
  for (let round = 0; round < 4; round += 1) {
    let hash = 0x811c9dc5 ^ (round * 0x01000193);
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, "0");
  }
  return out;
};

/** Which failure this file name asks for, or a plain upload. */
const uploadBehaviourFor = (fileName: string): MockUploadBehaviour => {
  const name = fileName.toLowerCase();
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.storeUnreachable)) return "storeUnreachable";
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.storeRefused)) return "storeRefused";
  if (name.includes(MOCK_ATTACHMENT_TRIGGERS.confirmFails)) return "confirmFails";
  return "ok";
};

class MockApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

const clone = <T>(value: T): T => structuredClone(value);

const wait = async <T>(value: T, ms = 140): Promise<T> =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(value)), ms);
  });

const makeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const byCreatedAt = <T extends { createdAt: string }>(a: T, b: T) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

/**
 * The search query as the gateway would accept it, or `null` for "the caller
 * asked for no text filter at all".
 *
 * Absent and empty are different answers on this route and must stay different
 * here: omitting `query` is a `200` with everything, `query=` is a `400`. So an
 * empty string is a rejected query rather than a quiet "everything" — the trap
 * that catches an implementation which sets the parameter on every keystroke.
 *
 * Measured on the trimmed value, and the trimmed value is what gets searched:
 * the gateway counts raw characters, so `"ab "` is three to it and finds
 * nothing, where refusing it says what actually happened. RestTaskaApi applies
 * exactly the same rule.
 */
const requireSearchQuery = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  const query = raw.trim();
  if (query.length < SEARCH_QUERY_MIN_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", SEARCH_QUERY_TOO_SHORT_MESSAGE);
  }
  return query;
};

/**
 * The reason all three admin user writes require, checked the way the server
 * checks it: blank first, then `@Size(max = 550)`.
 *
 * The blank half is not `@NotBlank` on the backend — the generated DTO gets
 * `@Size(min = 1)` from the contract's `minLength`, which a single space
 * satisfies, and the refusal actually comes from
 * `GrpcRequestValidators.requireNonBlankOrInvalidArgument` a layer deeper. The
 * answer is the same `400 INVALID_ARGUMENT` either way, which is why this
 * measures the trimmed value — and the length is measured on it too, so a
 * reason that is 550 characters of text plus a trailing newline is accepted
 * rather than refused on a character nobody typed on purpose.
 *
 * Nothing in the UI can produce an over-long one (the field carries
 * `maxLength`), so the length half exists for the same reason the mock refuses
 * a non-uuid row id: a hand-made call has to hit the same wall in both modes.
 * `requireAdminWriteReason` in src/api/rest/RestTaskaApi.ts is the other half
 * of that sentence and checks both bounds identically — this used to be the
 * only side that capped, which meant a 600-character reason was refused here
 * and sent there.
 */
const requireAdminWriteReason = (raw: string): string => {
  const reason = raw.trim();
  if (reason === "") {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_REQUIRED_MESSAGE);
  }
  if (reason.length > ADMIN_WRITE_REASON_MAX_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_TOO_LONG_MESSAGE);
  }
  return reason;
};

/**
 * The same guard for the outbox retry, whose contract states a **different**
 * upper bound: `maxLength: 1000` against the user writes' 550.
 *
 * Separate rather than parameterised, exactly as `requireOutboxRetryReason` in
 * src/api/rest/RestTaskaApi.ts is separate and for the same reason: one function
 * taking a limit would read as one rule the backend applies twice, and the
 * backend applies two rules. The blank half is genuinely shared — `minLength: 1`
 * on all four DTOs — so it keeps the shared sentence.
 */
const requireOutboxRetryReason = (raw: string): string => {
  const reason = raw.trim();
  if (reason === "") {
    throw new MockApiError("INVALID_ARGUMENT", ADMIN_WRITE_REASON_REQUIRED_MESSAGE);
  }
  if (reason.length > OUTBOX_RETRY_REASON_MAX_LENGTH) {
    throw new MockApiError("INVALID_ARGUMENT", OUTBOX_RETRY_REASON_TOO_LONG_MESSAGE);
  }
  return reason;
};

/**
 * The planning-field refusals, decided in src/api/planningFields.ts so that this
 * side and `RestTaskaApi` cannot drift, and thrown here as the code the gateway
 * answers with. `stored` is the issue as it stands — `null` on a create —
 * because two of them compare the request against the stored row rather than
 * against itself.
 */
const requirePlanningFields = (input: PlanningFieldsInput, stored: StoredPlanningDates | null): void => {
  const refusal = planningFieldRefusal(input, stored);
  if (refusal) {
    throw new MockApiError(refusal.code, refusal.message);
  }
};

/** Substring, case-insensitive, over `issue_key` OR `summary` OR `description` — the probe's own OR. */
const matchesSearchQuery = (issue: Issue, query: string | null) => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    issue.issueKey.toLowerCase().includes(needle) ||
    issue.summary.toLowerCase().includes(needle) ||
    issue.description.toLowerCase().includes(needle)
  );
};

/** Ordinary text ordering, deterministic and not locale-collated. */
const compareAsText = (left: unknown, right: unknown) => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Compare a table value the way the read-only admin API compares it: the
 * gateway binds a `BigDecimal` for a numeric column and an `OffsetDateTime` for
 * a temporal one, and the database does the rest.
 *
 * `null` when either side cannot be read as the column's type — a filter value
 * the gateway would have answered 400 for, or an absent cell, neither of which
 * matches anything. Callers that need a total order (sorting) fall back to text.
 *
 * The three implementations have to stay behaviourally interchangeable
 * (AGENTS.md), and this mock is what the e2e suite runs against, so comparing
 * as strings here was not a mock detail: `failed_logins.from=10` matched 9 in
 * every test and would not on the wire, and at a timestamp boundary
 * `"…08:00:00Z" <= "…08:00:00.000Z"` is false, so the mock dropped a row the
 * gateway keeps.
 *
 * What this models is how the gateway *orders and matches* values — not how it
 * *validates* them, and it is uniformly the more permissive of the two.
 * `new Date("2026-01-01")` parses here where `OffsetDateTime.parse` is a 400;
 * `Number("Infinity")` and `Number("0x10")` succeed where `new BigDecimal`
 * throws; and `Number` is float64, so a `bigint` past 2^53 that Postgres
 * compares exactly is compared approximately here. None of that is reachable
 * through the filter form, which picks the value control from the column's type
 * — only through a hand-edited URL. Going further would mean re-implementing
 * `ReadOnlyQueryValidator` in TypeScript and keeping two copies of the
 * backend's parsing rules in sync, which is a worse failure than this one: it
 * stops at ordering deliberately, so do not read it as a promise that anything
 * this function accepts the gateway would accept too.
 */
const compareAsColumn = (columnClass: AdminColumnClass, left: unknown, right: unknown): number | null => {
  if (left === null || left === undefined || right === null || right === undefined) return null;
  if (columnClass === "NUMERIC") {
    const a = Number(left);
    const b = Number(right);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (columnClass === "TEMPORAL") {
    const a = new Date(String(left)).getTime();
    const b = new Date(String(right)).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return a - b;
  }
  return compareAsText(left, right);
};

/**
 * The gateway types the row id in `GET /readonly/{service}/{table}/{id}` as a
 * `UUID`, so anything else is refused before admin-service sees it — whatever
 * the table's own key looks like.
 */
/** The contract's own spelling for a label colour: `^#[0-9A-Fa-f]{6}$`. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** `CreateProjectLabelRequestDto.name` — `minLength: 1, maxLength: 50`. */
const LABEL_NAME_MAX = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A link is stored once, the way it was created, and read from both ends. What
 * each end sees is `viewLinkType` — hence the name — so the issue on the
 * receiving side of a `BLOCKS` reads `IS_BLOCKED_BY`, a value the *request*
 * enum has no name for. That is the reading of the contract's asymmetry this
 * repository works to (docs/ai/API-DIVERGENCE.md); seeding it here is what
 * keeps the UI's open-string handling reachable without a gateway. If the
 * deployed gateway turns out to echo the stored type from both ends instead,
 * this map is the one place that changes.
 */
const inverseViewLinkType: Record<IssueLinkType, string> = {
  BLOCKS: "IS_BLOCKED_BY",
  RELATES_TO: "RELATES_TO",
  DUPLICATES: "IS_DUPLICATED_BY",
};

interface StoredIssueLink {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  linkType: IssueLinkType;
  createdBy: string;
  createdAt: string;
}

/** The transactional outbox table, in every service that has one. */
const OUTBOX_TABLE = "outbox_events";

/**
 * The `outbox_events` catalog entry, identical in each service that carries one
 * — auth, project and issue today, and exactly those three, which is what makes
 * the Events section's service selector a real filter over the catalog rather
 * than a hardcoded list (DESIGN.md §5.8).
 *
 * The types are the **live catalog's own spellings**, read from
 * `issue.outbox_events` on the deployed gateway on 2026-08-25 — `text` where
 * the product tables in this seed say `character varying`, and `aggregate_id`
 * a `uuid` rather than text. Both matter: the console picks a column's filter
 * operators and its value control from this string, so a mock that guessed
 * would offer controls the gateway then answers 400 for.
 *
 * No column is sensitive, which mirrors the deployed masking config. `payload`
 * is `jsonb` and therefore OTHER to the classifier: no `contains`, no ranges,
 * and the Events filter list does not offer it at all.
 */
function outboxTable(): AdminTable {
  return {
    name: OUTBOX_TABLE,
    primaryKey: "id",
    columns: [
      { name: "id", type: "uuid", sensitive: false },
      { name: "aggregate_type", type: "text", sensitive: false },
      { name: "aggregate_id", type: "uuid", sensitive: false },
      { name: "event_type", type: "text", sensitive: false },
      { name: "payload", type: "jsonb", sensitive: false },
      { name: "status", type: "text", sensitive: false },
      { name: "created_at", type: "timestamp with time zone", sensitive: false },
      { name: "published_at", type: "timestamp with time zone", sensitive: false },
      { name: "attempts", type: "integer", sensitive: false },
      { name: "last_error_message", type: "text", sensitive: false },
      { name: "processing_started_at", type: "timestamp with time zone", sensitive: false },
      { name: "request_id", type: "text", sensitive: false },
    ],
  };
}

/**
 * How long a row may sit in each state before the backend calls it problematic.
 * These are the *mock's* numbers, not the contract's: the real thresholds are
 * server configuration, and the summary endpoint reports the answer rather than
 * the rule. Minutes rather than the backend's hours so that a seeded row can be
 * both plausibly recent and unambiguously stuck.
 */
const OUTBOX_PROCESSING_TIMEOUT_MINUTES = 5;
const OUTBOX_NEW_OVERDUE_MINUTES = 10;

/**
 * How long a `PROCESSING` row has to have been stuck before the **retry** route
 * will take it — a *third* threshold, and deliberately not equal to the one
 * above it.
 *
 * This is the backend's shape, not a mock convenience. admin-service reads
 * `admin.outbox-retry.stuck-threshold` (default **10m**) to decide eligibility,
 * and reads `admin.outbox.processing-timeouts` (default **5m**, per producing
 * service) to decide what the *summary* calls stuck. So the real gateway has a
 * window in which a row is listed as "Stuck processing" and refused by retry,
 * and this mock has to have one too — otherwise the only implementation a
 * developer clicks through would be the one where the case cannot happen
 * (docs/ai/API-DIVERGENCE.md).
 *
 * The ratio is the backend's; the units are the mock's, like the two above.
 */
const OUTBOX_RETRY_STUCK_MINUTES = 10;

/**
 * How many events the mock's summary will list. The real default is 100; a
 * small number here is legitimate because the limit is server config rather
 * than contract, and it is the only way `notAllShown` — and the line the UI
 * draws for it — is reachable from a seed anyone can read.
 */
const OUTBOX_SUMMARY_LIMIT = 5;

/**
 * The backend's own sentences for why a row is problematic, word for word
 * (backend PR #141, TAS-105, merged 2026-08-27). `reason` is prose, not an enum:
 * the UI derives the category from `status` and never parses these — they are
 * seeded verbatim so that the
 * sentence the summary list carries on its category cell (in `title` and in the
 * cell's accessible name) is in mock mode exactly what the gateway will send.
 */
const OUTBOX_REASONS = {
  FAILED: "Event processing failed",
  PROCESSING: "Event stuck in PROCESSING state (exceeded processing timeout)",
  NEW: "Event stuck in NEW state (not picked up for processing)",
} as const;

/** A stable, uuid-shaped id: a row address has to survive a reload and a copied link. */
const outboxUuid = (kind: string, slot: number, index: number) =>
  `${kind}${slot}${String(index + 1).padStart(4, "0")}-0000-4000-8000-${slot}${String(index + 1).padStart(11, "0")}`;

/** One seeded outbox row, before it is turned into columns. */
interface OutboxSeed {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: "NEW" | "PROCESSING" | "PUBLISHED" | "FAILED";
  /** Age of the row itself. Everything in this table is read by age. */
  minutesAgo: number;
  attempts: number;
  payload: string;
  processingMinutesAgo?: number;
  publishedMinutesAgo?: number;
  lastErrorMessage?: string;
}

/**
 * Whichever of the three categories this row falls into, or `null` when it is
 * healthy. The same reading the backend's query makes: `FAILED` always counts,
 * and the other two only once they have been in that state too long.
 */
function outboxProblem(row: AdminRow, nowMs: number): keyof typeof OUTBOX_REASONS | null {
  const olderThan = (value: unknown, minutes: number) =>
    typeof value === "string" && nowMs - new Date(value).getTime() > minutes * 60_000;
  if (row.status === "FAILED") return "FAILED";
  if (row.status === "PROCESSING" && olderThan(row.processing_started_at, OUTBOX_PROCESSING_TIMEOUT_MINUTES)) {
    return "PROCESSING";
  }
  if (row.status === "NEW" && olderThan(row.created_at, OUTBOX_NEW_OVERDUE_MINUTES)) return "NEW";
  return null;
}

export class MockTaskaStore {
  private users: User[];
  private projects: Project[];
  private membersByProject: Record<string, ProjectMember[]>;
  private issues: Issue[];
  private historyByIssue: Record<string, IssueHistoryEvent[]>;
  private commentsByIssue: Record<string, IssueComment[]>;
  private links: StoredIssueLink[] = [];
  /** Attachment rows, soft-deleted in place exactly as the server's are. */
  private attachments: StoredAttachment[] = [];
  /**
   * The stand-in bucket: object key to what was PUT under it. Separate from
   * `attachments` on purpose — an object with no row is precisely the orphan a
   * failed confirm leaves behind, and one store that held both could not
   * represent it.
   */
  private storeObjects = new Map<string, MockStoredObject>();
  /** Presigned uploads handed out and not yet spent, keyed by the URL itself. */
  private uploadTickets = new Map<string, MockUploadTicket>();
  private projectLabels: ProjectLabel[];
  /**
   * Which labels an issue carries, held as ids against `projectLabels` rather
   * than as copies on the issue. A rename or a recolour then shows everywhere
   * at once, and a soft-deleted label leaves every issue it was on — which is
   * what the gateway does (TAS-119) and what copies would quietly get wrong.
   */
  private labelIdsByIssue: Record<string, string[]> = {};
  private notifications: Notification[];
  private workflow: Workflow;
  /**
   * The outbox rows, seeded once on first read rather than in the constructor.
   * Their timestamps are relative to *now* — a row has to be genuinely three
   * hours old for the summary's thresholds and the list's ages to say anything
   * — and freezing them at first read is what keeps a row's `created_at` the
   * same value in the journal, in the summary and on the card of the session
   * that is reading them.
   */
  private outboxEvents: Record<string, AdminRow[]> | null = null;
  private currentUserId = ANNA_ID;

  constructor() {
    const ts = (day: number, minute: number) =>
      `2026-06-${String(day).padStart(2, "0")}T09:${String(minute).padStart(2, "0")}:00Z`;

    // Mark is the seed's only GLOBAL_ADMIN so both role displays can be reached
    // by signing in; everyone else, Anna included, is a plain USER.
    this.users = [
      {
        id: ANNA_ID,
        login: "anna",
        email: "anna@example.com",
        displayName: "Anna Ivanova",
        status: "ACTIVE",
        // Deliberately not the colour Anna's own id computes to, and the same
        // goes for Mark and Sofia. A seed that duplicates the computed answer
        // exercises the branch without showing it: the point of seeding three
        // people is that a reader can see which colour came from the server.
        // Anna computes to #ec4899, Mark to #ec4899 and Sofia to #10b981, so
        // all three still state something else after TAS-175 restored the
        // bright palette — the three values below are the §2.2 hues the
        // darkened ones they replace were derived from, position for position.
        // The three people who do state a colour state one from
        // `avatarColorChoices`. This mock does not stand in for some server; it
        // stands in for one that behaves correctly. The "colour came from the
        // server" branch exists for TAS-148, where an admin picks from the set
        // this app itself offers — so a seeded value from outside that set
        // would be demonstrating a case the product does not permit, in the one
        // environment where anybody looks at these colours at all. Same
        // argument as Tom and Priya below: a mock that had depicted reality
        // would not have let TAS-171's flat accent avatars live this long.
        //
        // The five as drawn: Anna amber, Mark sky, Sofia pink, Tom and Priya
        // indigo. Four of those take the dark glyph and indigo takes white, so
        // both branches of `readableTextOn` are on screen at once.
        color: "#f59e0b",
        globalRole: "USER",
      },
      {
        id: MARK_ID,
        login: "mark",
        email: "mark@example.com",
        displayName: "Mark Lee",
        status: "ACTIVE",
        color: "#0ea5e9",
        globalRole: "GLOBAL_ADMIN",
      },
      {
        id: SOFIA_ID,
        login: "sofia",
        email: "sofia@example.com",
        displayName: "Sofia Reyes",
        status: "ACTIVE",
        color: "#ec4899",
        globalRole: "USER",
      },
      {
        id: TOM_ID,
        login: "tom",
        email: "tom@example.com",
        displayName: "Tom Becker",
        status: "ACTIVE",
        // Tom and Priya state no colour on purpose. Every seeded person having
        // one meant the only environment a reviewer or an e2e run can reach
        // always took the "server sent a colour" branch — the branch the live
        // gateway does not have — which is how the flat accent avatars of
        // TAS-171 survived as long as they did. Two of the five now exercise
        // the computed branch instead, and they were the pair that collided
        // with each other anyway: both compute to #6366f1, which is DESIGN.md
        // §2.2's birthday bound standing in front of a reader rather than
        // written down in a document.
        globalRole: "USER",
      },
      {
        id: PRIYA_ID,
        login: "priya",
        email: "priya@example.com",
        displayName: "Priya Nair",
        status: "ACTIVE",
        globalRole: "USER",
      },
      // The three accounts that are not ACTIVE (TAS-186, and Omar with
      // TAS-188). Every status the admin Users section can draw is on screen
      // without anybody having to change a row first, and all three of its
      // actions — Block, Unblock and Reset lockout — are one click away in the
      // only environment a reviewer or an e2e run can reach.
      //
      // Appended rather than inserted: `auth.users` derives its rows from this
      // array by position, so a person added in the middle would have moved
      // every seeded `failed_logins` and `created_at` beneath them.
      //
      // Appending is not free either, and the one thing it does move is worth
      // naming. `seedOutboxEvents` hands `users.map(u => u.id)` to `published`,
      // which round-robins the list across eight auth rows — every change to
      // the length of this array means some of those rows carry a different
      // `aggregate_id` than before. Nothing asserts them and nothing derives
      // from them: they are opaque uuids in a diagnostic table, the row count,
      // the statuses and the ages are unchanged, and the problems summary
      // counts states rather than aggregates. Recorded so the next reader does
      // not go looking for a reason the journal's ids moved.
      //
      // None of the three belongs to a project, which is the honest shape: an
      // invitation that has not been accepted, an account that was shut off and
      // one that cannot get in are exactly the people a board does not have.
      {
        id: LEO_ID,
        login: "leo",
        email: "leo@example.com",
        displayName: "Leo Fischer",
        status: "INVITED",
        globalRole: "USER",
      },
      {
        id: NINA_ID,
        login: "nina",
        email: "nina@example.com",
        displayName: "Nina Kowal",
        status: "BLOCKED",
        globalRole: "USER",
      },
      // Locked by his own failed sign-ins rather than by an administrator, so
      // he is the one account whose state nobody in this product created —
      // which is exactly the row Reset lockout exists for. Seeded because no
      // click can produce it: reaching `LOCKED` takes repeated failed sign-ins
      // against the real auth-service, so without this row the third action
      // would be unreachable in the only environment an e2e run has.
      {
        id: OMAR_ID,
        login: "omar",
        email: "omar@example.com",
        displayName: "Omar Haddad",
        status: "LOCKED",
        globalRole: "USER",
      },
    ];

    this.projects = [
      // Not `#6366f1`, which is what this key computes to: a seed equal to the
      // computed answer hides the override branch instead of showing it, the
      // same trap the seeded people above avoid. TAS and MOB now demonstrate a
      // stated colour winning; WEB happens to state its computed one, which is
      // honest and costs nothing.
      this.project(TASKA_PROJECT_ID, "TAS", "Taska Platform", "Core gateway, auth and issue services", "#0052cc", [
        ANNA_ID,
        MARK_ID,
        SOFIA_ID,
        TOM_ID,
      ]),
      this.project(WEB_PROJECT_ID, "WEB", "Web App", "Customer-facing web client", "#0ea5e9", [
        ANNA_ID,
        SOFIA_ID,
        PRIYA_ID,
      ]),
      this.project(MOB_PROJECT_ID, "MOB", "Mobile", "iOS and Android applications", "#8b5cf6", [
        MARK_ID,
        TOM_ID,
        PRIYA_ID,
      ]),
      // OPS states no colour for the same reason as Tom and Priya above: one
      // project has to take the computed path. Its former `#0d9488` was not a
      // member of the palette a computed key draws from either.
      this.project(OPS_PROJECT_ID, "OPS", "Infra and Ops", "CI/CD, observability, on-call", undefined, [
        ANNA_ID,
        TOM_ID,
      ]),
    ];

    // ADMIN for the first member of each project and MEMBER for the rest, which
    // means **no seeded member is a VIEWER anywhere**. `getMembership` answers
    // `VIEWER` for a non-member instead (`member?.role ?? "VIEWER"`), so every
    // VIEWER path in this store is exercised by a non-member standing in for
    // one. Against the gateway those are two different answers — a non-member
    // is refused by `ProjectRoleChecker` on `!isMember` before any role is
    // looked at — and the mock is the looser of the two on the read routes.
    // Recorded in docs/ai/API-DIVERGENCE.md; adding the membership check here
    // would cost the read-only seed the attachments section demonstrates.
    this.membersByProject = Object.fromEntries(
      this.projects.map((project) => [
        project.id,
        (project.memberIds ?? []).map((userId, index) => ({
          userId,
          role: index === 0 ? "ADMIN" : "MEMBER",
          addedAt: ts(8 + index, 20 + index),
          addedBy: ANNA_ID,
          user: this.userSummary(userId),
        })),
      ]),
    );

    this.workflow = {
      id: WORKFLOW_ID,
      name: "Default workflow",
      version: 1,
      createdAt: ts(8, 10),
      updatedAt: ts(8, 10),
      statuses: [
        { id: TODO_STATUS_ID, statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
        {
          id: IN_PROGRESS_STATUS_ID,
          statusKey: "IN_PROGRESS",
          name: "In Progress",
          category: "IN_PROGRESS",
          sortOrder: 20,
        },
        { id: DONE_STATUS_ID, statusKey: "DONE", name: "Done", category: "DONE", sortOrder: 30 },
      ],
      transitions: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          fromStatusId: TODO_STATUS_ID,
          toStatusId: IN_PROGRESS_STATUS_ID,
          name: "Start Progress",
          sortOrder: 10,
        },
        {
          id: "66666666-6666-6666-6666-666666666666",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: DONE_STATUS_ID,
          name: "Complete",
          sortOrder: 20,
        },
        {
          id: "88888888-8888-8888-8888-888888888888",
          fromStatusId: IN_PROGRESS_STATUS_ID,
          toStatusId: TODO_STATUS_ID,
          name: "Move to To Do",
          sortOrder: 25,
        },
        {
          id: "77777777-7777-7777-7777-777777777777",
          fromStatusId: DONE_STATUS_ID,
          toStatusId: IN_PROGRESS_STATUS_ID,
          name: "Reopen",
          sortOrder: 30,
        },
      ],
    };

    let minute = 10;
    const issue = (
      projectId: string,
      key: string,
      number: number,
      issueType: IssueType,
      summary: string,
      description: string,
      status: IssueStatus,
      priority: IssuePriority,
      assigneeId: string | null,
      reporterId: string,
      day: number,
      // The five planning fields, as one trailing bag rather than as five more
      // positional arguments: most seeds state none of them, and the ones that
      // do are worth being able to read.
      planning: Partial<PlanningFields> = {},
    ): Issue => ({
      id: makeId(`issue-${key}-${number}`),
      projectId,
      issueNumber: number,
      issueKey: `${key}-${number}`,
      issueType,
      summary,
      description,
      status,
      priority,
      assigneeId,
      reporterId,
      createdAt: ts(day, minute++),
      updatedAt: ts(day, minute++),
      version: 1,
      deletedAt: null,
      labels: [],
      // `?? null` and not `||`: `storyPoints: 0` is one of the two seeded values
      // this file exists to make clickable, and `0 || null` would seed it as
      // "not estimated".
      storyPoints: planning.storyPoints ?? null,
      startDate: planning.startDate ?? null,
      dueDate: planning.dueDate ?? null,
      originalEstimateMinutes: planning.originalEstimateMinutes ?? null,
      remainingEstimateMinutes: planning.remainingEstimateMinutes ?? null,
    });

    this.issues = [
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        101,
        "BUG",
        "Login form validation fails on empty email",
        "Submitting the sign-in form with an empty email returns a 500 instead of a 400 validation error.",
        "IN_PROGRESS",
        "HIGH",
        MARK_ID,
        ANNA_ID,
        12,
        // The only seed carrying all five at once, so a reader can see the
        // whole set on one issue: two days of work planned, half of it left.
        {
          storyPoints: 3,
          startDate: "2026-06-15",
          dueDate: "2026-06-26",
          originalEstimateMinutes: 480,
          remainingEstimateMinutes: 240,
        },
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        102,
        "TASK",
        "Prepare onboarding checklist for invited users",
        "Checklist surfaced after an invited user activates their account.",
        "TODO",
        "MEDIUM",
        ANNA_ID,
        ANNA_ID,
        13,
        // Estimated at **nought**, which is not the same as unestimated. Seeded
        // because every plausible implementation of "show the points if there
        // are any" gets this one wrong and shows nothing.
        { storyPoints: 0 },
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        103,
        "STORY",
        "Project members list endpoint",
        "Add GET /projects/{id}/members so the assignee picker and member settings can render real people.",
        "TODO",
        "HIGH",
        SOFIA_ID,
        SOFIA_ID,
        14,
        // Half a point. `format: double` permits it and the column stores it,
        // so an integer-only formatter truncates this to "1" and nothing fails.
        // The due date stands alone: one end of the window is a legal state.
        { storyPoints: 1.5, dueDate: "2026-07-03" },
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        104,
        "TASK",
        "Propagate X-Request-Id through the gateway",
        "Generate a request id when missing and forward it into gRPC Header.request_id.",
        "DONE",
        "LOW",
        TOM_ID,
        ANNA_ID,
        9,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        105,
        "BUG",
        "Refresh token rotation drops the session",
        "Rotating the refresh token occasionally invalidates the active access token early.",
        "IN_PROGRESS",
        "MEDIUM",
        ANNA_ID,
        MARK_ID,
        15,
        // The mirror of TAS-103: started, with no deadline. Between the two,
        // both halves of the stored-date cross-check have something to fire on.
        { startDate: "2026-06-20", originalEstimateMinutes: 120, remainingEstimateMinutes: 90 },
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        106,
        "STORY",
        "Kanban drag-and-drop transitions",
        "Wire POST /issues/{id}/transitions to board drag-and-drop and card buttons.",
        "TODO",
        "MEDIUM",
        MARK_ID,
        SOFIA_ID,
        16,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        107,
        "TASK",
        "Define a shared JSON error schema",
        "One error envelope { code, message, requestId } across every service.",
        "IN_PROGRESS",
        "HIGH",
        SOFIA_ID,
        ANNA_ID,
        16,
        // Estimated but never scheduled, and not started against: the remaining
        // estimate equals the original.
        { storyPoints: 8, originalEstimateMinutes: 960, remainingEstimateMinutes: 960 },
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        108,
        "TASK",
        "Assignee picker user search",
        "GET /users?query= for the assignee and member pickers.",
        "TODO",
        "MEDIUM",
        PRIYA_ID,
        SOFIA_ID,
        17,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        109,
        "STORY",
        "Notifications inbox: mark all as read",
        "PATCH /notifications/read-all plus an inbox affordance.",
        "DONE",
        "LOW",
        ANNA_ID,
        ANNA_ID,
        8,
      ),
      issue(
        TASKA_PROJECT_ID,
        "TAS",
        110,
        "BUG",
        "Board column count is off by one",
        "Soft-deleted issues are still counted in the column badge.",
        "TODO",
        "LOW",
        TOM_ID,
        MARK_ID,
        18,
      ),
      issue(WEB_PROJECT_ID, "WEB", 12, "STORY", "Responsive board layout", "Board columns should collapse gracefully under 900px.", "TODO", "MEDIUM", SOFIA_ID, ANNA_ID, 11, { storyPoints: 13, startDate: "2026-06-22", dueDate: "2026-07-10" }),
      issue(WEB_PROJECT_ID, "WEB", 13, "BUG", "Dark theme contrast on chips", "Type chips fail AA contrast on the dark surface.", "IN_PROGRESS", "HIGH", PRIYA_ID, SOFIA_ID, 12),
      issue(WEB_PROJECT_ID, "WEB", 14, "TASK", "Persist last opened project", "Remember the user's last project on reload.", "DONE", "LOW", ANNA_ID, ANNA_ID, 7),
      issue(MOB_PROJECT_ID, "MOB", 5, "TASK", "Push notification permission flow", "Ask for permission after the first assignment, not on launch.", "TODO", "MEDIUM", TOM_ID, MARK_ID, 10),
      issue(MOB_PROJECT_ID, "MOB", 6, "BUG", "Pull-to-refresh duplicates issues", "List occasionally renders duplicates after refresh.", "IN_PROGRESS", "MEDIUM", MARK_ID, TOM_ID, 11),
      issue(OPS_PROJECT_ID, "OPS", 3, "TASK", "Add board endpoint dashboards", "Grafana panels for /board latency.", "TODO", "LOW", TOM_ID, ANNA_ID, 9),
    ];

    this.historyByIssue = Object.fromEntries(
      this.issues.map((item) => [
        item.id,
        [
          {
            id: makeId("history"),
            issueId: item.id,
            eventType: "CREATED",
            actorUserId: item.reporterId,
            occurredAt: item.createdAt,
            payload: {},
          },
        ],
      ]),
    );

    const tas107 = this.issues.find((item) => item.issueKey === "TAS-107");
    const tas101 = this.issues.find((item) => item.issueKey === "TAS-101");
    this.commentsByIssue = {};
    if (tas107) {
      this.pushHistory(tas107.id, "ASSIGNED", ANNA_ID, { to: SOFIA_ID }, ts(16, 43));
      this.pushHistory(tas107.id, "TRANSITIONED", SOFIA_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(17, 14));
      this.comment(tas107, SOFIA_ID, "Picked this up — the token refresh path needs a retry guard first.", ts(17, 20));
      this.comment(tas107, ANNA_ID, "Agreed. Ping me once the guard is in and I will review.", ts(18, 5));
    }
    if (tas101) {
      this.pushHistory(tas101.id, "TRANSITIONED", MARK_ID, { from: "TODO", to: "IN_PROGRESS" }, ts(13, 31));
      this.pushHistory(tas101.id, "PRIORITY", MARK_ID, { to: "HIGH" }, ts(13, 44));
      this.comment(tas101, MARK_ID, "Bumped to high — this blocks the release checklist.", ts(13, 52));
    }

    // Seeded links so the panel has something to show on first load, and so
    // both directions of the view are reachable: TAS-101 reads "Blocks
    // TAS-102", TAS-102 reads "Is blocked by TAS-101".
    const linkSeed: [string, IssueLinkType, string][] = [
      ["TAS-101", "BLOCKS", "TAS-102"],
      ["TAS-103", "RELATES_TO", "TAS-106"],
      ["TAS-110", "DUPLICATES", "TAS-101"],
      // In a project Anna is not a member of, so the read-only view of this
      // section has something to be read-only about.
      ["MOB-5", "BLOCKS", "MOB-6"],
    ];
    linkSeed.forEach(([sourceKey, linkType, targetKey], index) => {
      const source = this.issues.find((item) => item.issueKey === sourceKey);
      const target = this.issues.find((item) => item.issueKey === targetKey);
      if (!source || !target) return;
      this.links.push({
        id: makeId("link"),
        projectId: source.projectId,
        sourceIssueId: source.id,
        targetIssueId: target.id,
        linkType,
        createdBy: source.reporterId,
        createdAt: ts(19, 10 + index),
      });
    });

    // Labels the projects already own, so the picker is not empty on first
    // load and so a project Anna cannot write to has labels to be read-only
    // about. Colours are the seed's own data, not design tokens: the contract
    // stores a HEX string per label and this is what the server would send.
    const labelSeed: [string, string, string][] = [
      [TASKA_PROJECT_ID, "backend", "#0052cc"],
      [TASKA_PROJECT_ID, "frontend", "#8b5cf6"],
      [TASKA_PROJECT_ID, "tech-debt", "#e3a008"],
      [TASKA_PROJECT_ID, "needs-design", "#ec4899"],
      [WEB_PROJECT_ID, "design", "#ec4899"],
      [WEB_PROJECT_ID, "accessibility", "#3fa863"],
      [MOB_PROJECT_ID, "ios", "#0ea5e9"],
      [MOB_PROJECT_ID, "android", "#3fa863"],
      [OPS_PROJECT_ID, "observability", "#6366f1"],
    ];
    this.projectLabels = labelSeed.map(([projectId, name, color], index) => ({
      id: makeId("label"),
      projectId,
      name,
      color,
      createdBy: ANNA_ID,
      createdAt: ts(9, 10 + index),
      deletedAt: null,
    }));

    const issueLabelSeed: [string, string][] = [
      ["TAS-101", "backend"],
      ["TAS-101", "tech-debt"],
      ["TAS-102", "frontend"],
      ["TAS-103", "frontend"],
      ["TAS-103", "needs-design"],
      ["TAS-107", "backend"],
      ["TAS-110", "tech-debt"],
      ["WEB-13", "design"],
      ["WEB-13", "accessibility"],
      ["MOB-5", "ios"],
    ];
    issueLabelSeed.forEach(([issueKey, labelName]) => {
      const target = this.issues.find((item) => item.issueKey === issueKey);
      const label = this.projectLabels.find(
        (item) => item.projectId === target?.projectId && item.name === labelName,
      );
      if (!target || !label) return;
      (this.labelIdsByIssue[target.id] ??= []).push(label.id);
    });

    // Attachments, seeded so the section is not empty on first load and so all
    // three of its interesting states are reachable by signing in as somebody:
    //
    // - Anna is ADMIN of TAS, so on TAS-101 she sees a delete on **both** rows,
    //   including Mark's — `delete-attachment-roles: ADMIN`;
    // - Mark is a MEMBER of TAS, so signing in as `mark@example.com` (this mock
    //   takes any password) leaves him a delete on his own row and none on
    //   Anna's — `delete-own-attachment-roles: ADMIN,MEMBER`. That contrast is
    //   the whole reason two rows are seeded on one issue and why they have
    //   different uploaders;
    // - Anna is not a member of MOB at all, so MOB-5's attachment is the
    //   read-only view: listed, downloadable, with no upload control and no
    //   delete.
    //
    // Sizes are real-looking and all comfortably under the 2 MB ceiling; the
    // checksums are ETag-shaped literals. No object is seeded into
    // `storeObjects`, because these rows stand for files uploaded long before
    // this session — the bucket is not part of the seed and a download link is
    // signed from the key regardless, exactly as `createPresignedDownloadUrl`
    // would.
    const attachmentSeed: [string, string, string, string, number, string][] = [
      [
        "TAS-101",
        ANNA_ID,
        "login-500-trace.txt",
        "text/plain",
        2411,
        "8f14e45fceea167a5a36dedd4bea2543",
      ],
      [
        "TAS-101",
        MARK_ID,
        "validation-error.png",
        "image/png",
        184320,
        "c9f0f895fb98ab9159f51fd0297e236d",
      ],
      [
        "MOB-5",
        PRIYA_ID,
        "crash-report.json",
        "application/json",
        14877,
        "45c48cce2e2d7fbdea1afc51c7c6ad26",
      ],
    ];
    attachmentSeed.forEach(([issueKey, uploadedBy, fileName, contentType, sizeBytes, checksum], index) => {
      const target = this.issues.find((item) => item.issueKey === issueKey);
      if (!target) return;
      const createdAt = ts(20, 10 + index);
      this.attachments.push({
        id: makeId("attachment"),
        issueId: target.id,
        uploadedBy,
        objectKey: makeId("object"),
        fileName,
        contentType,
        sizeBytes,
        checksum,
        createdAt,
        deletedAt: null,
      });
      // The history row the server writes in the same transaction, so the
      // activity feed's two new sentences are on screen without uploading
      // anything.
      this.pushHistory(
        target.id,
        "ATTACHMENT_UPLOADED",
        uploadedBy,
        { issueId: target.id, uploadedBy, fileName, contentType, sizeBytes },
        createdAt,
      );
    });

    // The three shapes the deployed gateway actually sends, measured with a
    // GLOBAL_ADMIN token (TAS-183). This seed used to carry frontend routes,
    // which is why clicking a notification worked here and landed on not-found
    // against the gateway — the one divergence a mock must not hide. It goes
    // back to routes when TAS-184 lands.
    this.notifications = [
      // `link` is the gateway's own API path, not a route this app has. The
      // body deliberately carries no id, so this row can only be resolved by
      // reading the link.
      this.notification("ISSUE_ASSIGNED", "Issue assigned", "TAS-107 was assigned to you", `/issues/${tas107?.id ?? ""}`, ts(25, 10), null),
      // No link at all, and the id sits in the prose exactly as the gateway
      // writes it ("Вам назначена задача be54f4ca-…"). Ugly in the panel, and
      // that ugliness is the gateway's, not this seed's.
      this.notification("ISSUE_TRANSITIONED", "Status changed", `TAS-101 moved to In Progress ${tas101?.id ?? ""}`, "", ts(25, 7), null),
      // Nothing to open: no link, no id, and no issue behind it. The row marks
      // itself read and goes nowhere.
      this.notification("MEMBER_ADDED", "Added to a project", "Sofia added you to Taska Platform", "", ts(24, 50), ts(25, 8)),
    ];
  }

  login(input: LoginInput): AuthTokens {
    const user = this.users.find((item) => item.email === input.email);
    if (!user || user.status !== "ACTIVE") {
      throw new MockApiError("UNAUTHENTICATED", "Invalid credentials");
    }
    this.currentUserId = user.id;
    return {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 3600,
    };
  }

  acceptInvitation(_input: AcceptInvitationInput): void {
    this.currentUserId = ANNA_ID;
  }

  /**
   * Adopt a session persisted by a previous page load. A stored id that no
   * longer names an active user is not trusted — the caller drops it.
   */
  restoreSession(userId: string): boolean {
    const user = this.users.find((item) => item.id === userId);
    if (!user || user.status !== "ACTIVE") return false;
    this.currentUserId = user.id;
    return true;
  }

  currentUser(): User {
    return this.getUser(this.currentUserId);
  }

  refresh(): AuthTokens {
    return {
      accessToken: "mock-access-token-refreshed",
      refreshToken: "mock-refresh-token-refreshed",
      expiresIn: 3600,
    };
  }

  listProjects(): Project[] {
    return this.projects.filter((project) => project.memberIds?.includes(this.currentUserId));
  }

  createProject(input: CreateProjectInput): Project {
    const key = input.projectKey.trim().toUpperCase();
    if (!key || this.projects.some((project) => project.projectKey === key)) {
      throw new MockApiError("ALREADY_EXISTS", "Project key already exists");
    }
    const project = this.project(makeId("project"), key, input.name.trim(), input.description || "Project workspace", undefined, [
      this.currentUserId,
    ]);
    this.projects.unshift(project);
    this.membersByProject[project.id] = [
      {
        userId: this.currentUserId,
        role: "ADMIN",
        addedAt: now(),
        addedBy: this.currentUserId,
        user: this.userSummary(this.currentUserId),
      },
    ];
    return project;
  }

  getProject(projectId: string): Project {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }
    return project;
  }

  getMembership(projectId: string): ProjectMembership {
    const project = this.projects.find((item) => item.id === projectId);
    const member = this.membersByProject[projectId]?.find((item) => item.userId === this.currentUserId);
    return {
      role: member?.role ?? "VIEWER",
      isMember: Boolean(member),
      projectExists: Boolean(project),
    };
  }

  listMembers(projectId: string): ProjectMember[] {
    this.getProject(projectId);
    return this.membersByProject[projectId] ?? [];
  }

  getWorkflow(): Workflow {
    return this.workflow;
  }

  listIssues(projectId: string, params: ListIssuesParams = {}): Page<Issue> {
    this.getProject(projectId);
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 100;
    const filtered = this.issues
      .filter((item) => item.projectId === projectId && item.deletedAt === null)
      .filter((item) => !params.status || item.status === params.status)
      .filter((item) => !params.assigneeId || item.assigneeId === params.assigneeId)
      // The contract's `labelId` query parameter. Filtered on the ids actually
      // attached, so a label that was soft-deleted matches nothing rather than
      // matching the issues it used to be on.
      .filter((item) => !params.labelId || this.labelsForIssue(item.id).some((label) => label.id === params.labelId))
      .sort(byCreatedAt);
    return {
      items: filtered
        .slice(page * pageSize, page * pageSize + pageSize)
        .map((item) => this.issueView(item)),
      page,
      pageSize,
      totalCount: filtered.length,
    };
  }

  /**
   * `GET /issues/search`, reproduced from the gateway probe of 2026-08-23
   * rather than from the contract where the two differ.
   *
   * The semantics that matter, because the e2e suite runs against this and
   * would otherwise pass cases the deployed gateway refuses: a query below
   * `SEARCH_QUERY_MIN_LENGTH` (the empty string included) is an
   * `INVALID_ARGUMENT`, an *absent* query is "no text filter"; the match is a
   * case-insensitive substring over `issueKey` OR `summary` OR `description`;
   * every other parameter ANDs onto it; `totalCount` counts the whole matching
   * set and the page is sliced after; and with no `projectId` the search covers
   * the projects this user can see — not every project in the store.
   */
  searchIssues(params: SearchIssuesParams = {}): Page<IssueSearchHit> {
    const query = requireSearchQuery(params.query);
    // 20 is the contract's declared default for this route, so the mock pages
    // the way the gateway does when the caller states nothing.
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;

    // A project that does not exist is a 404 from the gateway, and asking for one
    // this user is not in is the same answer.
    //
    // Measured against `visible`, not through `getProject`: that one checks
    // existence and nothing else, so the scoped branch used to hand a
    // non-member every issue in a project they are not in — a reference
    // implementation stating an access rule in its own comment and not keeping
    // it, and an e2e case that could pass here and be refused by the gateway.
    const visible = new Set(this.listProjects().map((project) => project.id));
    if (params.projectId !== undefined && !visible.has(params.projectId)) {
      throw new MockApiError("NOT_FOUND", "Project not found");
    }

    const matched = this.issues
      .filter((item) => item.deletedAt === null)
      // One rule either way: the unscoped search covers every visible project,
      // and the scoped one covers a visible project. Neither reaches past them.
      .filter((item) => (params.projectId === undefined ? visible.has(item.projectId) : item.projectId === params.projectId))
      .filter((item) => !params.statusKey || item.status === params.statusKey)
      .filter((item) => !params.assigneeId || item.assigneeId === params.assigneeId)
      .filter((item) => !params.reporterId || item.reporterId === params.reporterId)
      .filter((item) => !params.priority || item.priority === params.priority)
      .filter((item) => !params.issueType || item.issueType === params.issueType)
      .filter((item) => matchesSearchQuery(item, query))
      .sort(byCreatedAt);

    const items = matched.slice(page * pageSize, page * pageSize + pageSize).map((item) => this.searchHit(item));
    return {
      items,
      page,
      // What the page actually holds, which is what RestTaskaApi reports too —
      // the two answer identically whether or not the caller stated a size.
      pageSize: params.pageSize ?? items.length,
      totalCount: matched.length,
    };
  }

  getIssue(projectId: string, issueId: string): IssueWithHistory {
    return this.withHistory(this.findIssue(projectId, issueId));
  }

  /**
   * The project-less read. The gateway's route is issue-scoped, so this is what
   * `RestTaskaApi` has always done; the mock had no way to answer it because
   * `findIssue` matches on both ids. See `TaskaApi.getIssueById`.
   *
   * Membership is checked here and nowhere else in this file's issue reads,
   * because this is the only one a project id does not already narrow. Without
   * it the seed hands out a working answer for an issue the current user
   * cannot see — MOB has Mark, Tom and Priya and not Anna, who is the default
   * user and the e2e login — and a notification naming a MOB issue would walk
   * her onto a board the gateway would refuse. Before TAS-183 reaching that
   * state took a hand-typed URL.
   *
   * **The gateway's scoping on `GET /issues/{issueId}` is inferred from its
   * siblings, not measured.** `GET /projects/{id}` and `…/issues` answer 403
   * to a non-member (measured 2026-08-18, docs/ai/API-DIVERGENCE.md); the
   * contract declares only `200` and `default` for this route and nobody has
   * probed it with a non-member token. NOT_FOUND rather than PERMISSION_DENIED
   * is DESIGN.md §4.18's rule — the two must not be distinguishable, or the
   * refusal itself says someone else's project exists.
   */
  getIssueById(issueId: string): IssueWithHistory {
    const issue = this.issues.find((item) => item.id === issueId && item.deletedAt === null);
    const project = issue && this.projects.find((item) => item.id === issue.projectId);
    if (!issue || !project?.memberIds?.includes(this.currentUserId)) {
      throw new MockApiError("NOT_FOUND", "Issue not found");
    }
    return this.withHistory(issue);
  }

  private withHistory(issue: Issue): IssueWithHistory {
    return {
      issue: this.issueView(issue),
      history: this.historyByIssue[issue.id] ?? [],
    };
  }

  createIssue(projectId: string, input: CreateIssueInput): Issue {
    const project = this.getProject(projectId);
    // No stored record to compare against on a create, so the date cross-check
    // has nothing to read and the two dates are only checked against each other.
    requirePlanningFields(input, null);
    const planning = resolvePlanningFields(input, emptyPlanningFields());
    const issueNumber =
      Math.max(0, ...this.issues.filter((item) => item.projectId === projectId).map((item) => item.issueNumber)) + 1;
    const issue: Issue = {
      id: makeId("issue"),
      projectId,
      issueNumber,
      issueKey: `${project.projectKey}-${issueNumber}`,
      issueType: input.issueType,
      summary: input.summary.trim(),
      description: input.description.trim(),
      status: "TODO",
      priority: input.priority,
      assigneeId: null,
      reporterId: this.currentUserId,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
      deletedAt: null,
      labels: [],
      ...planning,
    };
    this.issues.push(issue);
    this.historyByIssue[issue.id] = [];
    this.pushHistory(issue.id, "CREATED", this.currentUserId, {});
    this.notifications.unshift(
      this.notification("ISSUE_CREATED", "Issue created", `${issue.issueKey} was created`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
    );
    return this.issueView(issue);
  }

  /**
   * The same read-modify-write `RestTaskaApi` does, for the same reason: the
   * gateway's `PUT` is a full replace, so "leave it as it is" is a value the
   * client resolves rather than a key it omits. Reproduced here so the two
   * cannot answer a partial edit differently — which is the defect this whole
   * story is about.
   *
   * `Object.assign(issue, { ...input })` is what this used to be, and it is
   * wrong twice over now. It writes an explicit `undefined` over a stored value
   * whenever a caller passes `{ storyPoints: undefined }` — which
   * `RestTaskaApi` can never produce, because it resolves first, but which a
   * component constructs by spreading a form state; and it cannot tell that
   * `undefined` from the `null` that means "clear it". Both are resolved before
   * anything is written.
   */
  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Issue {
    const issue = this.findIssue(projectId, issueId);
    // Before any mutation, and against the issue as stored: two of the refusals
    // compare the request with the record it is about, so a store that wrote
    // first and checked afterwards would accept what the gateway refuses.
    requirePlanningFields(input, issue);
    const changedPriority = input.priority && input.priority !== issue.priority;
    Object.assign(issue, {
      summary: input.summary ?? issue.summary,
      description: input.description ?? issue.description,
      priority: input.priority ?? issue.priority,
      ...resolvePlanningFields(input, issue),
      updatedAt: now(),
      version: issue.version + 1,
    });
    this.pushHistory(issue.id, changedPriority ? "PRIORITY" : "UPDATED", this.currentUserId, {
      field: changedPriority ? "priority" : "issue",
      to: changedPriority ? input.priority : undefined,
    });
    return this.issueView(issue);
  }

  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Issue {
    const issue = this.findIssue(projectId, issueId);
    if (assigneeId) {
      this.getUser(assigneeId);
    }
    issue.assigneeId = assigneeId;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "ASSIGNED", this.currentUserId, { to: assigneeId });
    if (assigneeId) {
      this.notifications.unshift(
        this.notification("ISSUE_ASSIGNED", "Issue assigned", `${issue.issueKey} was assigned to you`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
      );
    }
    return this.issueView(issue);
  }

  transitionIssue(projectId: string, issueId: string, transitionId: string): Issue {
    const issue = this.findIssue(projectId, issueId);
    const fromStatus = this.workflow.statuses.find((status) => status.statusKey === issue.status);
    const transition = this.workflow.transitions.find(
      (item) => item.id === transitionId && item.fromStatusId === fromStatus?.id,
    );
    const toStatus = this.workflow.statuses.find((status) => status.id === transition?.toStatusId)?.statusKey;
    if (!transition || !toStatus) {
      throw new MockApiError("FAILED_PRECONDITION", "Transition is not available for the current issue status");
    }
    const from = issue.status;
    issue.status = toStatus;
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "TRANSITIONED", this.currentUserId, { from, to: toStatus });
    this.notifications.unshift(
      this.notification("ISSUE_TRANSITIONED", "Status changed", `${issue.issueKey} moved to ${toStatus}`, `/projects/${projectId}/issues/${issue.id}`, now(), null),
    );
    return this.issueView(issue);
  }

  deleteIssue(projectId: string, issueId: string): void {
    const issue = this.findIssue(projectId, issueId);
    issue.deletedAt = now();
    issue.updatedAt = now();
    issue.version += 1;
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "deleted" });
  }

  listIssueLinks(projectId: string, issueId: string): IssueLink[] {
    const issue = this.findIssue(projectId, issueId);
    return this.links
      .filter((link) => link.sourceIssueId === issue.id || link.targetIssueId === issue.id)
      .sort(byCreatedAt)
      .map((link) => this.linkView(link, issue.id));
  }

  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): IssueLink {
    const issue = this.findIssue(projectId, issueId);
    if (input.targetIssueId === issue.id) {
      throw new MockApiError("INVALID_ARGUMENT", "An issue cannot be linked to itself");
    }
    // Unknown target, a target in another project, and a deleted target all
    // answer the same way here, because findIssue is scoped to the project.
    const target = this.findIssue(projectId, input.targetIssueId);
    const existing = this.links.find(
      (link) =>
        (link.sourceIssueId === issue.id && link.targetIssueId === target.id) ||
        (link.sourceIssueId === target.id && link.targetIssueId === issue.id),
    );
    if (existing) {
      throw new MockApiError("ALREADY_EXISTS", `${issue.issueKey} is already linked to ${target.issueKey}`);
    }

    const link: StoredIssueLink = {
      id: makeId("link"),
      projectId,
      sourceIssueId: issue.id,
      targetIssueId: target.id,
      linkType: input.linkType,
      createdBy: this.currentUserId,
      createdAt: now(),
    };
    this.links.push(link);
    return this.linkView(link, issue.id);
  }

  deleteIssueLink(projectId: string, issueId: string, linkId: string): void {
    const issue = this.findIssue(projectId, issueId);
    // Either end may remove the link: the route is issue-scoped, and the issue
    // on the receiving side of a BLOCKS sees the link just as much.
    const link = this.links.find(
      (item) => item.id === linkId && (item.sourceIssueId === issue.id || item.targetIssueId === issue.id),
    );
    if (!link) {
      throw new MockApiError("NOT_FOUND", "Issue link not found");
    }
    this.links = this.links.filter((item) => item.id !== link.id);
  }

  listProjectLabels(projectId: string): ProjectLabel[] {
    this.getProject(projectId);
    return this.projectLabels.filter((label) => label.projectId === projectId && label.deletedAt === null);
  }

  createProjectLabel(projectId: string, input: CreateProjectLabelInput): ProjectLabel {
    this.getProject(projectId);
    const name = this.validLabelName(input.name);
    const color = this.validLabelColor(input.color);
    if (this.findLabelByName(projectId, name)) {
      throw new MockApiError("ALREADY_EXISTS", `This project already has a label called "${name}"`);
    }
    const label: ProjectLabel = {
      id: makeId("label"),
      projectId,
      name,
      color,
      createdBy: this.currentUserId,
      createdAt: now(),
      deletedAt: null,
    };
    this.projectLabels.push(label);
    return label;
  }

  updateProjectLabel(projectId: string, labelId: string, input: UpdateProjectLabelInput): ProjectLabel {
    const label = this.findProjectLabel(projectId, labelId);
    const name = this.validLabelName(input.name);
    const color = this.validLabelColor(input.color);
    // A label keeping its own name is not a duplicate of itself.
    const clash = this.findLabelByName(projectId, name);
    if (clash && clash.id !== label.id) {
      throw new MockApiError("ALREADY_EXISTS", `This project already has a label called "${name}"`);
    }
    label.name = name;
    label.color = color;
    return label;
  }

  /**
   * Soft delete, as the contract's own summary says. The row keeps its place in
   * the store with `deletedAt` set, which is what makes it vanish from the
   * project list *and* from every issue at once: `labelsForIssue` resolves
   * through this list, so nothing has to walk the issues and unpick them.
   */
  deleteProjectLabel(projectId: string, labelId: string): void {
    const label = this.findProjectLabel(projectId, labelId);
    label.deletedAt = now();
  }

  listIssueLabels(projectId: string, issueId: string): Label[] {
    const issue = this.findIssue(projectId, issueId);
    return this.labelsForIssue(issue.id);
  }

  addIssueLabel(projectId: string, issueId: string, labelId: string): void {
    const issue = this.findIssue(projectId, issueId);
    const label = this.findProjectLabel(projectId, labelId);
    const attached = (this.labelIdsByIssue[issue.id] ??= []);
    if (attached.includes(label.id)) {
      throw new MockApiError("ALREADY_EXISTS", `${issue.issueKey} already carries "${label.name}"`);
    }
    attached.push(label.id);
    // "UPDATED" rather than a LABEL_ADDED of our own invention: the gateway's
    // history DTO types `eventType` as a bare string with no enum, so this
    // build has no value to claim. The panel prints "updated this issue".
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "labels", to: label.name });
  }

  removeIssueLabel(projectId: string, issueId: string, labelId: string): void {
    const issue = this.findIssue(projectId, issueId);
    const attached = this.labelIdsByIssue[issue.id] ?? [];
    if (!attached.includes(labelId)) {
      throw new MockApiError("NOT_FOUND", "This issue does not carry that label");
    }
    this.labelIdsByIssue[issue.id] = attached.filter((id) => id !== labelId);
    this.pushHistory(issue.id, "UPDATED", this.currentUserId, { field: "labels" });
  }

  listAttachments(projectId: string, issueId: string): IssueAttachment[] {
    const issue = this.findIssue(projectId, issueId);
    return this.attachments
      .filter((item) => item.issueId === issue.id && item.deletedAt === null)
      .sort(byCreatedAt)
      .map((item) => this.attachmentView(item));
  }

  /**
   * Leg 1. Refuses exactly what `S3StorageClient.validateFileParams` refuses,
   * in the server's own words, then checks the upload role, then mints a
   * presigned-shaped URL on `storage.public-url`'s only checked-in value.
   *
   * **The file is judged before the role, and that is the server's order even
   * though the source reads the other way round.** `createUploadUrl` is
   * `checkUserHasRoleForIssue(...).then(storageClient.createPresignedUploadUrl(...))`,
   * and `Mono.then(Mono other)` evaluates its argument **at assembly** — while
   * the chain is still being built, before anything subscribes. `S3StorageClient`
   * calls `validateFileParams` synchronously at the top of
   * `createPresignedUploadUrl`, before it returns a `Mono` at all, so the
   * `DomainException` escapes into the enclosing `flatMap` in
   * `GrpcAttachmentService` and becomes the answer; the role check never
   * subscribes. Verified against backend `f53dca38`.
   *
   * So leg 1's real order is: field validation (the `Mono.zip` of
   * `GrpcRequestValidators` — 400), then the file (400), then the issue
   * (404, `findActiveIssueProjectId`), then the role (403,
   * `ProjectRoleChecker`). `RestTaskaApi.createAttachmentUploadUrl` already
   * refuses the file before it sends anything, so this ordering is what keeps
   * the two answering the same code to the same input rather than `rest`
   * saying `INVALID_ARGUMENT` where `mock` said `PERMISSION_DENIED`.
   *
   * **Leg 3 is genuinely the other way round** and `confirmAttachmentUpload`
   * below is right to check the role first: `confirmUpload` passes no
   * synchronously-validated argument to `.then`, so its role check does run
   * first. The two legs differ, and reading one off the other is the mistake
   * this comment used to make.
   *
   * The URL is built to look like what the deployed stand would hand back —
   * host, bucket, a UUID key and the AWS SigV4 query parameters, including
   * `X-Amz-SignedHeaders=content-type;host`, which is the visible trace of the
   * fact that leg 2 must resend the very same `Content-Type`. It points at a
   * host nothing here serves, and that is the honest shape: this leg does not
   * go through the gateway and no browser on the deployed site can reach it
   * either.
   */
  createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): AttachmentUploadTicket {
    const refusal = attachmentRefusal(input);
    if (refusal) {
      // Two codes, split the way the server splits them: an unusable type or a
      // non-positive size is INVALID_ARGUMENT, and only the ceiling is
      // OUT_OF_RANGE. They do not share an HTTP status either — the ceiling is
      // a 500, because `RestErrorMapper` has no `OUT_OF_RANGE` row and falls to
      // its INTERNAL_SERVER_ERROR default. `MockApiError` carries no status, so
      // the code is the whole of what this side can express; `refuseAttachment`
      // in RestTaskaApi.ts carries the status and states the chain.
      const code = attachmentRefusalKind(input) === "size" ? "OUT_OF_RANGE" : "INVALID_ARGUMENT";
      throw new MockApiError(code, refusal);
    }
    const issue = this.findIssue(projectId, issueId);
    this.requireUploadRole(projectId);

    const objectKey = makeId("object");
    const signedAt = new Date();
    const behaviour = uploadBehaviourFor(input.fileName);
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `minioadmin/${signedAt.toISOString().slice(0, 10).replace(/-/g, "")}/us-east-1/s3/aws4_request`,
      "X-Amz-Date": `${signedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      "X-Amz-Expires": String(Math.round(ATTACHMENT_PRESIGNED_TTL_MS / 1000)),
      "X-Amz-SignedHeaders": "content-type;host",
      "X-Amz-Signature": mockChecksum(new TextEncoder().encode(`${objectKey}:${input.contentType}`)),
    });
    const uploadUrl = `${ATTACHMENT_STORE_ORIGIN}/${ATTACHMENT_BUCKET}/${objectKey}?${query.toString()}`;

    this.uploadTickets.set(uploadUrl, {
      objectKey,
      issueId: issue.id,
      projectId,
      contentType: input.contentType,
      // A file whose name asks for it gets a ticket that expired a minute ago,
      // which is the only way anybody can see what a stale link looks like
      // without waiting a quarter of an hour.
      expiresAt: input.fileName.toLowerCase().includes(MOCK_ATTACHMENT_TRIGGERS.expiredTicket)
        ? Date.now() - 60_000
        : Date.now() + ATTACHMENT_PRESIGNED_TTL_MS,
      behaviour,
    });

    return { uploadUrl, objectKey };
  }

  /**
   * Leg 2 — the browser's own PUT, standing in for a server this app cannot
   * reach. Every refusal here is an `AttachmentStoreError` rather than a
   * `MockApiError`, because the thing refusing is not the gateway and the panel
   * has to be able to tell.
   */
  putAttachmentBytes(uploadUrl: string, bytes: Uint8Array, contentType: string): void {
    // Before the lookup, and for the same reason `RestTaskaApi` checks before
    // its `fetch`: an unusable link is not a store that said no. Without this
    // the mock would answer 403 to a `""` the REST adapter refuses without
    // sending, and the two would stop being interchangeable on the one input
    // a malformed gateway response can actually produce.
    requireUsableUploadUrl(uploadUrl);
    const ticket = this.uploadTickets.get(uploadUrl);
    if (!ticket) {
      // A URL this store never signed. S3 answers 403 for an unparseable or
      // unknown signature, not 404 — the object is not the thing being denied.
      throw new AttachmentStoreError("The file store answered 403.", ATTACHMENT_STORE_REJECTED_CODE, 403);
    }
    if (ticket.behaviour === "storeUnreachable") {
      throw new AttachmentStoreError(
        "The file store could not be reached: Failed to fetch",
        ATTACHMENT_STORE_UNREACHABLE_CODE,
        null,
      );
    }
    if (ticket.behaviour === "storeRefused") {
      throw new AttachmentStoreError("The file store answered 500.", ATTACHMENT_STORE_REJECTED_CODE, 500);
    }
    if (Date.now() > ticket.expiresAt) {
      throw new AttachmentStoreError("The file store answered 403.", ATTACHMENT_STORE_REJECTED_CODE, 403);
    }
    // The signature covers `Content-Type`, so a value that differs by so much
    // as a charset is a signature mismatch and a 403. Reproduced because it is
    // the single easiest rule in this feature to break from the UI side, and
    // the only place it can ever be caught before production.
    if (ticket.contentType !== contentType) {
      throw new AttachmentStoreError("The file store answered 403.", ATTACHMENT_STORE_REJECTED_CODE, 403);
    }

    this.storeObjects.set(ticket.objectKey, {
      contentType,
      sizeBytes: bytes.length,
      checksum: mockChecksum(bytes),
    });
  }

  /**
   * Leg 3, in the server's own order: the caller has to hold the upload role,
   * the object has to exist, it is re-measured against the ceiling, and only
   * then is a row written. `confirmUpload` re-checks the role rather than
   * trusting leg 1 to have done it — a presigned URL is a bearer token for the
   * bucket and says nothing about who may add a row — and so does this.
   *
   * The insert is **unconditional**, exactly like
   * `AttachmentTransactionExecutor.saveAttachment` against a table with no
   * unique key on `object_key`. So confirming the same object twice produces
   * two rows here as well — deliberately, because that is the hazard the
   * "never retry a confirm" rule exists for, and a mock that quietly
   * de-duplicated would make the rule look like superstition.
   */
  confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): IssueAttachment {
    const issue = this.findIssue(projectId, issueId);
    this.requireUploadRole(projectId);
    const ticket = [...this.uploadTickets.values()].find((item) => item.objectKey === input.objectKey);
    if (ticket?.behaviour === "confirmFails") {
      // The object is in the bucket and stays there: nothing sweeps it, and the
      // delete route does not touch storage. This is the orphan.
      throw new MockApiError("UNAVAILABLE", "The attachment could not be recorded. Please try again.");
    }

    const stored = this.storeObjects.get(input.objectKey);
    if (!stored) {
      throw new MockApiError("NOT_FOUND", "Object not found in storage");
    }
    if (stored.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) {
      // The server deletes the oversized object before refusing, so the key
      // stops resolving for a second attempt too.
      this.storeObjects.delete(input.objectKey);
      throw new MockApiError("OUT_OF_RANGE", attachmentSizeRefusalMessage(stored.sizeBytes));
    }

    const attachment: StoredAttachment = {
      id: makeId("attachment"),
      issueId: issue.id,
      uploadedBy: this.currentUserId,
      objectKey: input.objectKey,
      fileName: input.fileName,
      // The stored row keeps the *request's* content type, not the object's:
      // `saveAttachment` is handed `contentType` from the confirm body and the
      // metadata only contributes size and checksum.
      contentType: input.contentType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      createdAt: now(),
      deletedAt: null,
    };
    this.attachments.push(attachment);
    this.pushHistory(issue.id, "ATTACHMENT_UPLOADED", this.currentUserId, {
      attachmentId: attachment.id,
      issueId: issue.id,
      uploadedBy: attachment.uploadedBy,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt,
    });
    return this.attachmentView(attachment);
  }

  getAttachmentDownloadUrl(projectId: string, issueId: string, attachmentId: string): AttachmentDownloadUrl {
    const attachment = this.findAttachment(projectId, issueId, attachmentId);
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Expires": String(Math.round(ATTACHMENT_PRESIGNED_TTL_MS / 1000)),
      "X-Amz-SignedHeaders": "host",
      "X-Amz-Signature": mockChecksum(new TextEncoder().encode(`${attachment.objectKey}:get:${Date.now()}`)),
      "response-content-disposition": `attachment; filename="${attachment.fileName}"`,
    });
    return {
      downloadUrl: `${ATTACHMENT_STORE_ORIGIN}/${ATTACHMENT_BUCKET}/${attachment.objectKey}?${query.toString()}`,
      checksum: attachment.checksum,
    };
  }

  /**
   * Soft delete: the split role rule the panel's per-row control is drawn from,
   * and a lookup that refuses nothing.
   *
   * `AttachmentServiceImpl.deleteAttachment` picks its allowed set by comparing
   * `uploadedBy` with the caller: `delete-own-attachment-roles` (ADMIN, MEMBER)
   * for your own file and `delete-attachment-roles` (ADMIN) for anybody else's.
   * A per-row control is only correct if the row it is drawn on would actually
   * accept it, and a mock that accepted everything could not tell a correct gate
   * from a missing one.
   *
   * **The lookup is lenient, and this method is the only place in the store
   * that is.** The server opens on `findByIdAndDeletedAtIsNull` with **no**
   * `switchIfEmpty`, so an attachment that is missing or already soft-deleted
   * skips both `flatMap`s — the role check included — and
   * `GrpcAttachmentService` closes with `.thenReturn(Empty)`, which the gateway
   * renders as 204. The contract documents a 404 there; the implementation does
   * not, and this reproduces the implementation. Reproduce **and** flag: the
   * entry in docs/ai/API-DIVERGENCE.md is the other half of this decision.
   *
   * The behaviour decided it rather than the doctrine. Against a stale list —
   * a second tab, or somebody else's delete — the server answers 204 and the
   * row correctly stays gone, while a mock answering 404 would roll the
   * optimistic removal back and make a file that *is* deleted reappear under an
   * error message. That is the worse of the two behaviours, not merely a
   * different one.
   *
   * **The leniency stops here, deliberately.** `getAttachmentDownloadUrl`
   * resolves through `findAttachment`, which mirrors the server's private
   * `findActiveAttachment` — and that one *does* carry
   * `switchIfEmpty(NOT_FOUND)`. So the download route genuinely 404s on a
   * deleted attachment, the mock is already right there, and pushing this
   * leniency down into `findAttachment` would break it.
   *
   * The object in the bucket is untouched, like the server's.
   */
  deleteAttachment(projectId: string, issueId: string, attachmentId: string): void {
    // Resolved by hand rather than through `findAttachment`, because every way
    // this can come up empty — no such issue, no such attachment, deleted
    // already — is a 204 on the server and none of them reaches the role check.
    const issue = this.issues.find(
      (item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null,
    );
    const attachment = this.attachments.find(
      (item) => item.id === attachmentId && item.issueId === issue?.id && item.deletedAt === null,
    );
    if (!attachment) return;

    const role = this.getMembership(projectId).role;
    const allowed = attachment.uploadedBy === this.currentUserId ? role === "ADMIN" || role === "MEMBER" : role === "ADMIN";
    if (!allowed) {
      throw new MockApiError("PERMISSION_DENIED", "You do not have permission to delete this attachment");
    }
    attachment.deletedAt = now();
    this.pushHistory(attachment.issueId, "ATTACHMENT_DELETED", this.currentUserId, {
      attachmentId: attachment.id,
      issueId: attachment.issueId,
      deletedBy: this.currentUserId,
      fileName: attachment.fileName,
      deletedAt: attachment.deletedAt,
    });
  }

  listComments(projectId: string, issueId: string, params: ListCommentsParams = {}): Page<IssueComment> {
    const issue = this.findIssue(projectId, issueId);
    const page = params.page ?? 0;
    const pageSize = params.pageSize ?? 20;
    // The gateway returns the newest comment first, so "load more" walks backwards in time.
    const comments = [...(this.commentsByIssue[issue.id] ?? [])].sort((a, b) => byCreatedAt(b, a));
    return {
      items: comments.slice(page * pageSize, page * pageSize + pageSize),
      page,
      pageSize,
      totalCount: comments.length,
    };
  }

  addComment(projectId: string, issueId: string, body: string): IssueComment {
    const issue = this.findIssue(projectId, issueId);
    const comment = this.comment(issue, this.currentUserId, this.commentBody(body), now());
    this.pushHistory(issue.id, "COMMENT_CREATED", this.currentUserId, { commentId: comment.id });
    return comment;
  }

  updateComment(projectId: string, issueId: string, commentId: string, body: string): IssueComment {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    comment.body = this.commentBody(body);
    comment.updatedAt = now();
    comment.version += 1;
    this.pushHistory(comment.issueId, "COMMENT_UPDATED", this.currentUserId, { commentId: comment.id });
    return comment;
  }

  deleteComment(projectId: string, issueId: string, commentId: string): void {
    const comment = this.findOwnComment(projectId, issueId, commentId);
    this.commentsByIssue[comment.issueId] = (this.commentsByIssue[comment.issueId] ?? []).filter(
      (item) => item.id !== comment.id,
    );
    this.pushHistory(comment.issueId, "COMMENT_DELETED", this.currentUserId, { commentId: comment.id });
  }

  listNotifications(params: ListNotificationsParams = {}): Page<Notification> {
    const offset = params.offset ?? 0;
    const pageSize = params.pageSize ?? 20;
    const notifications = [...this.notifications]
      .filter((notification) => !params.unreadOnly || !notification.readAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      items: notifications.slice(offset, offset + pageSize),
      pageSize,
      offset,
    };
  }

  markNotificationRead(notificationId: string): Notification {
    const notification = this.notifications.find((item) => item.id === notificationId);
    if (!notification) {
      throw new MockApiError("NOT_FOUND", "Notification not found");
    }
    notification.readAt = notification.readAt ?? now();
    return notification;
  }

  markAllNotificationsRead(): { updatedCount: number } {
    let updatedCount = 0;
    this.notifications.forEach((notification) => {
      if (!notification.readAt) {
        notification.readAt = now();
        updatedCount += 1;
      }
    });
    return { updatedCount };
  }

  /**
   * The read-only admin API looks at the *services' own tables*, not at the
   * product model, so this is deliberately a separate shape rather than a view
   * over `this.projects` and friends: snake_case columns, database ids, and one
   * column per masking treatment — `MASK_FULL`, `MASK_PARTIAL` and `HIDE` —
   * so all three render paths are reachable without a gateway.
   * Rows are derived from the same seed where it is cheap, so a table the
   * console shows agrees with the app around it.
   *
   * `type` is spelled the way `information_schema.columns.data_type` spells it —
   * `character varying`, not `varchar`; `timestamp with time zone`, not
   * `timestamptz` — because that is what the gateway forwards and what the
   * console classifies a column by. A mock that used the short aliases would
   * offer operators the real gateway then answers 400 for, and no test could
   * see it.
   *
   * The seed deliberately covers what the screen branches on: `auth.users` has
   * a `uuid` primary key (its rows open a card) and a column of every class,
   * while `admin.audit_log` is keyed by text (the gateway takes a `UUID` in the
   * path, so those rows are not addressable and must not pretend to be).
   */
  adminCatalog(): AdminCatalog {
    return {
      services: [
        {
          name: "auth",
          databaseAlias: "taska_auth",
          tables: [
            {
              name: "users",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "login", type: "character varying", sensitive: false },
                { name: "email", type: "character varying", sensitive: false },
                { name: "display_name", type: "character varying", sensitive: false },
                { name: "status", type: "character varying", sensitive: false },
                { name: "global_role", type: "character varying", sensitive: false },
                { name: "password_hash", type: "character varying", sensitive: true },
                { name: "recovery_email", type: "character varying", sensitive: true },
                { name: "failed_logins", type: "integer", sensitive: false },
                { name: "email_verified", type: "boolean", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
            {
              // Keyed by a uuid *and* long enough to page through, which is the
              // combination the row card needs to be exercised properly: the
              // product tables are all one page, and the only long table in the
              // seed is keyed by a code.
              name: "sessions",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "user_id", type: "uuid", sensitive: false },
                { name: "token_hash", type: "character varying", sensitive: true },
                { name: "ip_address", type: "inet", sensitive: false },
                { name: "revoked", type: "boolean", sensitive: false },
                { name: "expires_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
            outboxTable(),
          ],
        },
        {
          name: "project",
          databaseAlias: "taska_project",
          tables: [
            {
              name: "projects",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "project_key", type: "character varying", sensitive: false },
                { name: "name", type: "character varying", sensitive: false },
                { name: "created_by", type: "uuid", sensitive: false },
                { name: "settings", type: "jsonb", sensitive: false },
                { name: "archived_at", type: "timestamp with time zone", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
            outboxTable(),
          ],
        },
        {
          name: "issue",
          databaseAlias: "taska_issue",
          tables: [
            {
              name: "issues",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: false },
                { name: "issue_key", type: "character varying", sensitive: false },
                { name: "project_id", type: "uuid", sensitive: false },
                { name: "summary", type: "character varying", sensitive: false },
                { name: "issue_type", type: "character varying", sensitive: false },
                { name: "status", type: "character varying", sensitive: false },
                { name: "priority", type: "character varying", sensitive: false },
                { name: "assignee_id", type: "uuid", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
            outboxTable(),
          ],
        },
        {
          name: "admin",
          databaseAlias: "taska_admin",
          tables: [
            {
              // Keyed by a readable code rather than a uuid, which is the case
              // the gateway cannot address: `GET /readonly/{s}/{t}/{id}` parses
              // `id` as a UUID and refuses everything else before admin-service
              // ever sees it. The console must not offer those rows a link.
              name: "audit_log",
              primaryKey: "id",
              columns: [
                { name: "id", type: "character varying", sensitive: false },
                { name: "actor_id", type: "uuid", sensitive: false },
                { name: "action", type: "character varying", sensitive: false },
                { name: "target", type: "character varying", sensitive: false },
                { name: "duration_ms", type: "integer", sensitive: false },
                { name: "created_at", type: "timestamp with time zone", sensitive: false },
              ],
            },
          ],
        },
      ],
    };
  }

  listAdminRows(query: AdminRowsQuery): AdminRows {
    const table = this.adminTable(query.service, query.table);
    const columns = table.columns.map((column) => column.name);
    // The catalog's own types, which is what makes the comparisons below the
    // gateway's comparisons rather than JavaScript's.
    const typeOf = (column: string) => table.columns.find((item) => item.name === column)?.type;
    let rows = this.adminRowsFor(query.service, query.table);

    for (const filter of query.filters ?? []) {
      if (filter.value === "") continue;
      const columnClass = classifyColumnType(typeOf(filter.column));
      rows = rows.filter((row) => {
        const raw = row[filter.column];
        const value = raw === null || raw === undefined ? "" : String(raw);
        switch (filter.operator) {
          // Case-insensitive only here, matching the gateway: `contains` is
          // ILIKE, everything else compares exactly. Lowercasing all of them
          // made the mock accept `global_admin` where the gateway wants
          // `GLOBAL_ADMIN`, so a filter that worked in every test found nothing
          // in production.
          case "contains":
            return value.toLowerCase().includes(filter.value.toLowerCase());
          case "from": {
            const order = compareAsColumn(columnClass, raw, filter.value);
            return order !== null && order >= 0;
          }
          case "to": {
            const order = compareAsColumn(columnClass, raw, filter.value);
            return order !== null && order <= 0;
          }
          default:
            // Equality is typed too, and for the same reason: the gateway binds
            // a BigDecimal against a numeric column, so `10.0` and `10` are the
            // same row there. Where the value cannot be read as the column's
            // type, the text comparison is the honest fallback.
            return (compareAsColumn(columnClass, raw, filter.value) ?? (value === filter.value ? 0 : 1)) === 0;
        }
      });
    }

    if (query.sort && columns.includes(query.sort)) {
      const direction = query.order === "desc" ? -1 : 1;
      const sortColumn = query.sort;
      const columnClass = classifyColumnType(typeOf(sortColumn));
      rows = [...rows].sort((left, right) => {
        const a = left[sortColumn];
        const b = right[sortColumn];
        // Nulls last whichever way the sort runs: a column full of them at the
        // top is never what the person asking to sort by it wanted.
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        // By the column's type, not `localeCompare`: the gateway sorts in the
        // database, where 9 comes before 10 and a timestamp is an instant.
        // Sorting every column as locale-collated text put 10 before 9 and made
        // the order depend on the machine's locale.
        return (compareAsColumn(columnClass, a, b) ?? compareAsText(a, b)) * direction;
      });
    }

    const pageSize = query.pageSize ?? 20;
    const currentPage = query.page ?? 1;
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const start = (currentPage - 1) * pageSize;

    return {
      rows: rows.slice(start, start + pageSize),
      pagination: {
        currentPage,
        pageSize,
        totalRows,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      },
      meta: {
        service: query.service,
        table: query.table,
        columns,
        // Everything is sortable and filterable here. A real service will say
        // less, and the screen reads these lists rather than assuming.
        sortableColumns: columns,
        filterableColumns: columns,
      },
    };
  }

  /**
   * One row by its primary key. A key nobody has fails exactly the way the
   * gateway's 404 reaches the UI, so the card's missing-row state is reachable
   * in mock mode — that state is otherwise unreachable without a database.
   *
   * A key that is not a UUID is refused outright, because that is where the
   * gateway refuses it: the path parameter is typed `UUID`, so
   * `/admin/data/admin/audit_log/AUD-0001` is a 400 there however honest the
   * row behind it. Serving a card the gateway never could made the mock the
   * more permissive of the two, which is the direction that hides bugs — the
   * console refuses to link those rows, and a hand-typed address has to hit the
   * same wall in both modes.
   *
   * Past that, the id is compared as text, which is what admin-service does
   * (`"pk"::text = $1`).
   */
  adminRow(query: AdminRowQuery): AdminRow {
    const table = this.adminTable(query.service, query.table);
    if (!UUID_PATTERN.test(query.id)) {
      throw new MockApiError("INVALID_ARGUMENT", `Row id ${query.id} is not a UUID`);
    }
    const row = this.adminRowsFor(query.service, query.table).find(
      (candidate) => String(candidate[table.primaryKey] ?? "") === query.id,
    );
    if (!row) {
      throw new MockApiError("NOT_FOUND", `No row ${query.id} in ${query.service}.${query.table}`);
    }
    return row;
  }

  /** The catalog entry both admin reads start from, refusing the same two ways. */
  private adminTable(serviceName: string, tableName: string): AdminTable {
    const service = this.adminCatalog().services.find((item) => item.name === serviceName);
    if (!service) {
      // Not NOT_FOUND, and the wording is not ours. The gateway resolves the
      // service key before it looks for anything, and a key it does not know is
      // a rejected *argument* rather than a missing resource: measured
      // 2026-08-25, `400 INVALID_ARGUMENT` with exactly this sentence. The mock
      // is the reference implementation, so it answers what the gateway answers.
      //
      // Until TAS-194 the Events section read one instance of this sentence —
      // `Unknown service: outbox` — as "the problems summary has not deployed
      // yet", because a gateway without that path routed it here. That gateway
      // is gone and the branch with it; this refusal is now only ever about a
      // service key nobody has.
      throw new MockApiError("INVALID_ARGUMENT", `Unknown service: ${serviceName}`);
    }
    const table = service.tables.find((item) => item.name === tableName);
    if (!table) {
      // A different refusal from the one above, and deliberately so. The
      // service key is resolved first and a key the gateway does not know is a
      // rejected argument; a table is a later question, permitted or denied by
      // the gateway's own config, so a table it will not serve comes back as
      // PERMISSION_DENIED. Both are unreachable from the console, which only
      // offers catalog tables — but the mock is the reference implementation,
      // and the two answers are not interchangeable: `AdminError` sorts a
      // refusal ("not this account, or not this table") from a rejected request
      // ("read and refused, here is what to change") into different sentences.
      throw new MockApiError("PERMISSION_DENIED", `Table ${serviceName}.${tableName} is not served`);
    }
    return table;
  }

  /**
   * `POST /admin/users/{userId}/block` (TAS-186).
   *
   * Every refusal below is the backend's own, read out of
   * `AdminUserManagementServiceImpl` on the TAS-107 branch and reproduced word
   * for word — the mock is the reference implementation, and a mock that were
   * the more permissive of the two would teach a screen the gateway cannot
   * serve.
   *
   * The last-active-admin rule is the reason nothing about this operation is
   * optimistic (DESIGN.md §5.8): it is a count across the whole table, and no
   * client holds it.
   */
  blockUser(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "ACTIVE" && user.status !== "INVITED") {
      // ABORTED, not FAILED_PRECONDITION, and the difference is the gateway's
      // rather than a taste: `DomainStatus.ABORTED` is what auth-service raises
      // for this one, and `RestErrorMapper` turns it into a 409 carrying the
      // literal string "ABORTED". The refusal below is the other code and the
      // other status. Emitting one code for both would make the mock the only
      // place the two look alike.
      throw new MockApiError("ABORTED", `Cannot block user with current status: ${user.status}`);
    }
    if (user.globalRole === "GLOBAL_ADMIN" && user.status === "ACTIVE" && this.activeGlobalAdmins() <= 1) {
      // FAILED_PRECONDITION, which the gateway maps to **400** rather than 409.
      // The section reads this refusal by its code, not by its status, and this
      // line is why (`isConflict`, src/api/errors.ts).
      throw new MockApiError("FAILED_PRECONDITION", "Cannot block the last active global admin");
    }
    return this.changeUserStatus(user, "BLOCKED");
  }

  /**
   * `POST /admin/users/{userId}/unblock`. Legal from `BLOCKED` and from
   * nothing else, and it always lands on `ACTIVE`.
   *
   * An `INVITED` account that was blocked therefore comes back **active**, not
   * invited: the backend does not restore the invite state, and the section
   * says so in the confirmation rather than pretending otherwise here.
   */
  unblockUser(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "BLOCKED") {
      // ABORTED for the same reason as in `blockUser` above.
      throw new MockApiError("ABORTED", `Cannot unblock user with current status: ${user.status}`);
    }
    return this.changeUserStatus(user, "ACTIVE");
  }

  /**
   * `POST /admin/users/{userId}/reset-lockout` (TAS-188), read out of
   * `AdminUserManagementServiceImpl.resetCredentialLockout` at the head of
   * backend PR #146.
   *
   * `LOCKED` is not an administrative state — an account arrives there by
   * failing to sign in `maxFailedAttempts` times, and leaves on its next
   * success — and this is the only *write* that leaves it. Legal
   * from `LOCKED` and from nothing else, and it always
   * lands on `ACTIVE`, which is why the confirmation can state the transition
   * before asking for it.
   *
   * The refusal is `FAILED_PRECONDITION`, which the gateway maps to **400** —
   * the shape `blockUser`'s last-admin guard wears, not the 409 of its
   * transition guard. Reproduced with the server's own sentence, because the
   * dialog prints it.
   *
   * What the server clears — `failedAttempts`, `lockedUntil`, `lastFailedAt` —
   * has no representation in this store, and inventing one would be modelling
   * state no client can read: `UserCredentialStateResponseDto` never reaches
   * REST. The status is the whole of what a client can see change.
   */
  resetCredentialLockout(userId: string, reason: string): UserStatusChange {
    const user = this.adminUser(userId, reason);
    if (user.status !== "LOCKED") {
      throw new MockApiError("FAILED_PRECONDITION", "User is not in LOCKED status");
    }
    return this.changeUserStatus(user, "ACTIVE");
  }

  /**
   * Everything all three writes check before they look at the transition.
   *
   * The body first, so a blank reason on an account nobody has is a `400` and
   * not a `404`. Then the path parameter, which is typed `UUID` and refused
   * before auth-service ever sees it, exactly as `adminRow` refuses a non-uuid
   * row id. Then the account itself.
   *
   * Not "because Spring validates `@Valid @RequestBody` before the controller
   * method runs", which is what this said until TAS-194 and is not what the
   * gateway does. `AdminUserManagementController` takes each body as a
   * `Mono<…RequestDto>` and passes it into
   * `executor.execute(exchange, GLOBAL_ADMIN_REQUIRED, …)`, so the body is
   * subscribed *after* the admin check, while `UUID userId` is bound before the
   * method runs at all. On the wire the path is therefore the first thing
   * refused and the only one refused without a token — measured on the retry
   * route, whose controller has the same shape (see `retryOutboxEvent`).
   *
   * What is reproduced here is the half that is about this endpoint's own
   * checks: the reason before the lookup. The mock has no auth leg to order
   * against, so the id and the reason are in the order the checks read best.
   *
   * None of the three is reachable from the section, which sends a key it read
   * out of the table and a reason the field would not let be blank. They are
   * here because the mock is the reference implementation: a hand-made call has
   * to hit the same wall in both modes.
   */
  private adminUser(userId: string, reason: string): User {
    requireAdminWriteReason(reason);
    if (!UUID_PATTERN.test(userId)) {
      throw new MockApiError("INVALID_ARGUMENT", `User id ${userId} is not a UUID`);
    }
    return this.getUser(userId);
  }

  /** How many accounts can administer this instance right now. */
  private activeGlobalAdmins(): number {
    return this.users.filter((user) => user.globalRole === "GLOBAL_ADMIN" && user.status === "ACTIVE").length;
  }

  /**
   * The write itself, and the response it produces. `changedAt` is a real
   * instant here and on the gateway too, where it is the changed row's own
   * `updated_at` (see `UserStatusChange`); nothing draws either, because the
   * section refetches the list and reads the timestamp there.
   */
  private changeUserStatus(user: User, currentStatus: UserStatus): UserStatusChange {
    const previousStatus = user.status;
    user.status = currentStatus;
    return { userId: user.id, previousStatus, currentStatus, changedAt: now() };
  }

  /**
   * The problems summary (`GET /readonly/outbox/problematic-summary`), derived
   * from the same rows the Outbox journal reads — so the two views of the
   * Events section can never contradict each other, which is the whole reason
   * the mock computes this rather than seeding a second, independent answer.
   *
   * In the vendored contract and on the deployed gateway since backend PR #141
   * (TAS-105) merged 2026-08-27 — this comment said the opposite until TAS-194,
   * and the mock is not a stand-in for a missing route any more. What it is is
   * the reference implementation: the same answer, from seeded rows, so the
   * section can be clicked through without a gateway.
   */
  problematicOutboxSummary(): ProblematicOutboxSummary {
    const nowMs = Date.now();
    const events: ProblematicOutboxEvent[] = [];
    const counts: ProblematicOutboxCounts[] = [];

    for (const serviceKey of this.outboxServiceKeys()) {
      const count: ProblematicOutboxCounts = {
        serviceKey,
        overdueNewCount: 0,
        stuckProcessingCount: 0,
        failedCount: 0,
      };
      for (const row of this.outboxRowsFor(serviceKey)) {
        const problem = outboxProblem(row, nowMs);
        if (!problem) continue;
        if (problem === "FAILED") count.failedCount += 1;
        if (problem === "PROCESSING") count.stuckProcessingCount += 1;
        if (problem === "NEW") count.overdueNewCount += 1;
        events.push({
          id: String(row.id),
          aggregateType: String(row.aggregate_type),
          aggregateId: String(row.aggregate_id),
          eventType: String(row.event_type),
          payload: String(row.payload),
          status: String(row.status),
          createdAt: String(row.created_at),
          publishedAt: (row.published_at as string | null) ?? null,
          attempts: Number(row.attempts),
          lastErrorMessage: (row.last_error_message as string | null) ?? null,
          processingStartedAt: (row.processing_started_at as string | null) ?? null,
          requestId: (row.request_id as string | null) ?? null,
          serviceKey,
          reason: OUTBOX_REASONS[problem],
        });
      }
      // Every service, counted in full, whether or not any of its rows made the
      // list: the counts are the answer to "where is it broken" and the list is
      // only the head of it.
      counts.push(count);
    }

    // Oldest first — the list exists to say when this started — and cut to the
    // server's limit afterwards, so the counts above still cover what was cut.
    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return {
      events: events.slice(0, OUTBOX_SUMMARY_LIMIT),
      counts,
      notAllShown: events.length > OUTBOX_SUMMARY_LIMIT,
    };
  }

  /**
   * `POST /admin/outbox/{service}/{eventId}/retry`, checked and applied the way
   * admin-service checks and applies it (`OutboxRetryServiceImpl` and
   * `OutboxRetryRepositoryImpl`, backend `develop` 2026-09-08).
   *
   * The reason before the event, so a blank reason against an event nobody has
   * is a `400` and not a `404`. Then the id, typed `UUID` in the path and
   * refused before admin-service sees it. Then the event, then eligibility.
   *
   * The gateway's own order is read off
   * `AdminReadOnlyController.retryOutboxEvent` (backend `develop`): `eventId`
   * is a `UUID` argument bound before the method body runs, while the request
   * is a `Mono<RetryOutboxEventRequestDto>` subscribed *inside*
   * `executor.execute(exchange, GLOBAL_ADMIN_REQUIRED, …)`. So the path is
   * refused first, before authentication, and the body only after the admin
   * check — probed on the deployed gateway with no token 2026-09-08: a
   * malformed uuid answers `400 "Invalid request parameters"`, a blank reason
   * answers `401`. It is *not* "the body before the path because Spring
   * validates `@Valid @RequestBody` first", which is what this comment claimed
   * and which describes a blocking controller this route does not have.
   *
   * The two orders differ only for a call malformed in both ways at once, which
   * this section cannot make: it sends an id read out of the table and a reason
   * the field would not let be blank.
   *
   * What the update does, field for field:
   *
   * - `status` → `NEW`;
   * - `last_error_message` → `null`;
   * - `processing_started_at` → `null`;
   * - **`attempts` untouched.** It is not in the backend's `UPDATE`, so the
   *   count carries over and the response reports the number the row already
   *   had. A mock that reset it here would teach the one thing about this
   *   endpoint an operator is most likely to assume and be wrong about.
   *
   * Eligibility is `FAILED`, or `PROCESSING` stuck longer than
   * `OUTBOX_RETRY_STUCK_MINUTES` — which is *not* the threshold the summary uses
   * to call a row stuck, on the backend or here. Everything else is
   * `FAILED_PRECONDITION` in the server's own words, including the `NEW` rows
   * this section's own list is full of.
   */
  retryOutboxEvent(service: string, eventId: string, reason: string): OutboxRetryResult {
    requireOutboxRetryReason(reason);
    if (!UUID_PATTERN.test(eventId)) {
      throw new MockApiError("INVALID_ARGUMENT", `Outbox event id ${eventId} is not a UUID`);
    }
    // The gateway's path enum refuses an unknown service before this, and
    // admin-service refuses it again from its own map of write datasources. The
    // mock speaks the second one's sentence: it is the one a hand-made call to a
    // service that has no outbox would actually meet.
    if (!this.outboxServiceKeys().includes(service)) {
      throw new MockApiError("INVALID_ARGUMENT", `Unsupported outbox service: ${service}`);
    }
    const row = this.outboxRowsFor(service).find((candidate) => String(candidate.id) === eventId);
    if (!row) {
      throw new MockApiError("NOT_FOUND", `Outbox event not found: ${eventId}`);
    }

    const stuckBefore = Date.now() - OUTBOX_RETRY_STUCK_MINUTES * 60_000;
    const startedAt = row.processing_started_at;
    const eligible =
      row.status === "FAILED" ||
      (row.status === "PROCESSING" &&
        typeof startedAt === "string" &&
        new Date(startedAt).getTime() < stuckBefore);
    if (!eligible) {
      throw new MockApiError(
        "FAILED_PRECONDITION",
        `Outbox event with status ${String(row.status)} is not eligible for retry`,
      );
    }

    row.status = "NEW";
    row.last_error_message = null;
    row.processing_started_at = null;
    // Read back out of the row, like the backend's second `findById`, rather
    // than assembled from what was just written: the response is a statement
    // about the row's state, and the two are the same only while nothing else
    // touches it.
    return { eventId, status: String(row.status), attempts: Number(row.attempts) };
  }

  private outboxRowsFor(service: string): AdminRow[] {
    this.outboxEvents ??= this.seedOutboxEvents();
    return this.outboxEvents[service] ?? [];
  }

  /**
   * Which services have an outbox — read back out of the catalog rather than
   * listed a second time. The three `outboxTable()` calls up there are the
   * statement; a parallel array beside them would be a second thing to keep
   * true, and the day they disagreed the summary would count a service whose
   * rows nothing seeds (or miss one it does).
   *
   * Its order is also the id slot, so no two outbox rows can share a key.
   */
  private outboxServiceKeys(): string[] {
    return this.adminCatalog()
      .services.filter((service) => service.tables.some((table) => table.name === OUTBOX_TABLE))
      .map((service) => service.name);
  }

  /**
   * Three services' worth of outbox rows: mostly published traffic, plus the
   * three shapes the Events section exists to show — a NEW row the scheduler
   * never picked up, a PROCESSING row past the timeout, and a FAILED row with
   * its attempts exhausted and the kind of error string a broker actually
   * writes.
   *
   * Two of the recent rows are deliberately *not* problematic: a NEW and a
   * PROCESSING row a couple of minutes old. Without them nothing here would
   * prove the summary applies a threshold rather than counting states.
   *
   * One row sits in the gap between the summary's threshold and the retry
   * route's — listed as stuck, refused by retry. See the last of `project`'s
   * seeds; it is the only place that divergence is reachable by clicking.
   *
   * Every payload here is a JSON document, which is all a `jsonb` column can
   * hold — including one whose values arrive masked, because admin-service
   * masks *inside* the document and the result is still JSON.
   *
   * This seed used to carry one payload that was not JSON at all, an
   * `JsonByteArrayInput{…}` string modelling admin-service's `value.toString()`
   * fall-through for `jsonb`. Backend PR #141 (TAS-105) replaced that with an
   * `instanceof Json → asString()` branch, and the probe
   * docs/ai/API-DIVERGENCE.md required before closing the entry was taken on
   * 2026-09-08: `GET /api/v1/readonly/issue/outbox_events` returned 20 rows and
   * every `payload` was clean JSON, with no `JsonByteArrayInput` anywhere in the
   * response. TAS-194 dropped the seed there, because a mock that keeps sending
   * it teaches a wire format the gateway can no longer produce. The card's rule
   * — parse as JSON and lay it out, anything else print verbatim — is untouched
   * and is not a compensation; it is TAS-167's instruction to escalate rather
   * than repair, and its verbatim branch is tested directly in
   * src/screens/admin/columns.test.ts.
   */
  private seedOutboxEvents(): Record<string, AdminRow[]> {
    const base = Date.now();
    const at = (minutesAgo: number) => {
      const moment = new Date(base - minutesAgo * 60_000);
      moment.setUTCSeconds(0, 0);
      // The wire's own spelling in this section: full ISO-8601, no milliseconds.
      return moment.toISOString().replace(/\.\d{3}Z$/, "Z");
    };
    const slots = this.outboxServiceKeys();
    const rowsOf = (serviceKey: string, seeds: OutboxSeed[]): AdminRow[] => {
      const slot = slots.indexOf(serviceKey);
      return seeds.map((seed, index) => ({
        id: outboxUuid("7e0", slot, index),
        aggregate_type: seed.aggregateType,
        aggregate_id: seed.aggregateId,
        event_type: seed.eventType,
        payload: seed.payload,
        status: seed.status,
        created_at: at(seed.minutesAgo),
        published_at: seed.publishedMinutesAgo === undefined ? null : at(seed.publishedMinutesAgo),
        attempts: seed.attempts,
        last_error_message: seed.lastErrorMessage ?? null,
        processing_started_at: seed.processingMinutesAgo === undefined ? null : at(seed.processingMinutesAgo),
        request_id: outboxUuid("a11", slot, index),
      }));
    };

    const users = this.users;
    const projects = this.projects;
    const issues = this.issues;

    const published = (
      count: number,
      aggregateType: string,
      eventTypes: string[],
      aggregateIds: string[],
      firstMinutesAgo: number,
    ): OutboxSeed[] =>
      Array.from({ length: count }, (_, index) => {
        const minutesAgo = firstMinutesAgo - index * 37;
        const aggregateId = aggregateIds[index % aggregateIds.length] ?? ANNA_ID;
        return {
          eventType: eventTypes[index % eventTypes.length],
          aggregateType,
          aggregateId,
          status: "PUBLISHED",
          minutesAgo,
          attempts: 1,
          processingMinutesAgo: minutesAgo,
          publishedMinutesAgo: minutesAgo,
          payload: JSON.stringify({ aggregateId, occurredAt: at(minutesAgo) }),
        };
      });

    return {
      auth: rowsOf("auth", [
        ...published(
          8,
          "User",
          ["user.registered", "user.password_changed", "session.revoked", "user.role_changed"],
          users.map((user) => user.id),
          2160,
        ),
        {
          eventType: "user.registered",
          aggregateType: "User",
          aggregateId: users[2]?.id ?? SOFIA_ID,
          status: "NEW",
          minutesAgo: 600,
          attempts: 0,
          // Valid JSON whose values arrived masked. The card pretty-prints it by
          // the same rule as any other JSON — a masked document is still a
          // document, and giving it a special case would be the client deciding
          // what the server already decided.
          payload: '{"userId":"16ad2404-96e3-4c51-b00d-55c5d1451d3c","email":"n****a@mail.ru","login":"s****a"}',
        },
        {
          eventType: "session.revoked",
          aggregateType: "Session",
          aggregateId: users[1]?.id ?? MARK_ID,
          status: "PROCESSING",
          minutesAgo: 45,
          processingMinutesAgo: 44,
          attempts: 2,
          payload: JSON.stringify({ sessionId: outboxUuid("9c1", 0, 3), reason: "USER_LOGOUT" }),
        },
        {
          eventType: "user.password_changed",
          aggregateType: "User",
          aggregateId: users[0]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 180,
          processingMinutesAgo: 178,
          attempts: 5,
          lastErrorMessage:
            "org.apache.kafka.common.errors.TimeoutException: Expiring 1 record(s) for taska.auth.events-0: 60000 ms has passed since batch creation",
          payload: JSON.stringify({ userId: users[0]?.id ?? ANNA_ID, changedAt: at(180) }),
        },
      ]),
      project: rowsOf("project", [
        ...published(
          6,
          "Project",
          ["project.created", "project.updated", "project.member_added"],
          projects.map((project) => project.id),
          1980,
        ),
        {
          eventType: "project.member_added",
          aggregateType: "Project",
          aggregateId: projects[1]?.id ?? WEB_PROJECT_ID,
          status: "NEW",
          minutesAgo: 300,
          attempts: 0,
          payload: JSON.stringify({ projectId: projects[1]?.id ?? WEB_PROJECT_ID, userId: SOFIA_ID, role: "MEMBER" }),
        },
        {
          eventType: "project.archived",
          aggregateType: "Project",
          aggregateId: projects[3]?.id ?? OPS_PROJECT_ID,
          status: "FAILED",
          minutesAgo: 1500,
          processingMinutesAgo: 1498,
          attempts: 5,
          lastErrorMessage: "Connection refused: schema-registry.taska.svc.cluster.local/10.0.4.11:8081",
          payload: JSON.stringify({ projectId: projects[3]?.id ?? OPS_PROJECT_ID, archivedBy: MARK_ID }),
        },
        // The row that lives in the gap between the section's two thresholds,
        // and the reason `OUTBOX_RETRY_STUCK_MINUTES` exists at all: old enough
        // for the summary to call it "Stuck processing" (past 5m) and too young
        // for the retry route to take it (short of 10m). Retrying it is a
        // `FAILED_PRECONDITION`, in the server's own words, on a row that looks
        // exactly as retryable as the ones above it.
        //
        // Its shape is the one that produces this on a real stand: an event
        // created two days ago, requeued by somebody, picked up minutes ago and
        // still going. That is also why `attempts` is 6 — the count survives a
        // retry, so a requeued event carries its history forward.
        //
        // Appended rather than inserted: the id is derived from the position in
        // this array, and a row's address has to survive a reload and a copied
        // link.
        {
          eventType: "project.member_added",
          aggregateType: "Project",
          aggregateId: projects[0]?.id ?? TASKA_PROJECT_ID,
          status: "PROCESSING",
          minutesAgo: 700,
          processingMinutesAgo: 7,
          attempts: 6,
          payload: JSON.stringify({ projectId: projects[0]?.id ?? TASKA_PROJECT_ID, userId: MARK_ID, role: "ADMIN" }),
        },
      ]),
      issue: rowsOf("issue", [
        ...published(
          20,
          "Issue",
          ["issue.created", "issue.status_changed", "issue.assigned", "issue.commented"],
          issues.map((issue) => issue.id),
          2400,
        ),
        // Young enough to be nobody's problem: a scheduler that runs every
        // minute has not missed these yet, and the summary must not count them.
        {
          eventType: "issue.commented",
          aggregateType: "Issue",
          aggregateId: issues[0]?.id ?? ANNA_ID,
          status: "NEW",
          minutesAgo: 2,
          attempts: 0,
          payload: JSON.stringify({ issueId: issues[0]?.id ?? "", commentId: outboxUuid("cc1", 2, 0) }),
        },
        {
          eventType: "issue.status_changed",
          aggregateType: "Issue",
          aggregateId: issues[1]?.id ?? ANNA_ID,
          status: "PROCESSING",
          minutesAgo: 2,
          processingMinutesAgo: 1,
          attempts: 1,
          payload: JSON.stringify({ issueId: issues[1]?.id ?? "", from: "TODO", to: "IN_PROGRESS" }),
        },
        {
          eventType: "issue.created",
          aggregateType: "Issue",
          aggregateId: issues[2]?.id ?? ANNA_ID,
          status: "NEW",
          minutesAgo: 30,
          attempts: 0,
          payload: JSON.stringify({ issueId: issues[2]?.id ?? "", projectId: TASKA_PROJECT_ID }),
        },
        {
          eventType: "issue.assigned",
          aggregateType: "Issue",
          aggregateId: issues[3]?.id ?? ANNA_ID,
          status: "PROCESSING",
          minutesAgo: 900,
          processingMinutesAgo: 898,
          attempts: 3,
          payload: JSON.stringify({ issueId: issues[3]?.id ?? "", assigneeId: MARK_ID }),
        },
        {
          eventType: "issue.status_changed",
          aggregateType: "Issue",
          aggregateId: issues[4]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 420,
          processingMinutesAgo: 418,
          attempts: 5,
          lastErrorMessage:
            "org.apache.kafka.common.errors.RecordTooLargeException: The message is 2097244 bytes when serialized which is larger than 1048576",
          payload: JSON.stringify({ issueId: issues[4]?.id ?? "", from: "IN_PROGRESS", to: "DONE" }),
        },
        {
          eventType: "issue.commented",
          aggregateType: "Issue",
          aggregateId: issues[5]?.id ?? ANNA_ID,
          status: "FAILED",
          minutesAgo: 120,
          processingMinutesAgo: 118,
          attempts: 5,
          lastErrorMessage: "Topic taska.issue.events not present in metadata after 60000 ms",
          payload: JSON.stringify({ issueId: issues[5]?.id ?? "", authorId: SOFIA_ID }),
        },
      ]),
    };
  }

  private adminRowsFor(service: string, table: string): AdminRow[] {
    // One table, three services — and the only one in this seed that is not
    // per-service, which is exactly what the Events section's selector is for.
    if (table === OUTBOX_TABLE) return this.outboxRowsFor(service);

    if (service === "auth" && table === "users") {
      return this.users.map((user, index) => ({
        id: user.id,
        login: user.login,
        email: user.email,
        display_name: user.displayName,
        status: user.status,
        global_role: user.globalRole ?? null,
        // Masked here, not in the client. `admin-service` replaces a
        // `MASK_FULL` column's value with this exact literal before it leaves
        // the server, so a mock that sent the real hash and trusted the console
        // to hide it would be teaching a shape the gateway never sends.
        password_hash: "***",
        // The other half of the same rule: `MASK_PARTIAL` keeps the first and
        // last character and stars the middle, which is a value — degraded, but
        // enough to tell two rows apart — and the console prints it.
        recovery_email:
          user.email.length <= 2
            ? "***"
            : `${user.email[0]}${"*".repeat(user.email.length - 2)}${user.email.slice(-1)}`,
        // Spans one and two digits on purpose: 5 and 10 order one way as
        // numbers and the other way as text, so a numeric column compared as a
        // string — in a filter or in a sort — is visible here rather than only
        // against a real database.
        failed_logins: index * 5,
        email_verified: index % 2 === 0,
        created_at: `2026-06-0${index + 1}T09:00:00Z`,
      }));
    }

    if (service === "auth" && table === "sessions") {
      // Deterministic uuids: a row address has to survive a reload and a
      // copied link, so the ids cannot be regenerated per call.
      return Array.from({ length: 45 }, (_, index) => ({
        id: `9c1f${String(index + 1).padStart(4, "0")}-0000-4000-8000-0000000${String(index + 1).padStart(5, "0")}`,
        user_id: [ANNA_ID, MARK_ID, SOFIA_ID][index % 3],
        // `token_hash` is deliberately absent: a `HIDE` column is deleted from
        // the row altogether, so the console meets a missing key rather than a
        // masked value. The catalog still names it, which is the case the table
        // has to survive — a column with a header and no cell behind it.
        ip_address: `10.0.${index % 8}.${index % 251}`,
        revoked: index % 3 === 0,
        expires_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T08:00:00Z`,
      }));
    }

    if (service === "project" && table === "projects") {
      return this.projects.map((project, index) => ({
        id: project.id,
        project_key: project.projectKey,
        name: project.name,
        created_by: project.createdBy,
        // A column the console renders as JSON, and one more type the catalog
        // classifies as neither text nor a number.
        settings: index === 0 ? { board: "kanban", wipLimit: 3 } : null,
        archived_at: project.archivedAt,
        created_at: project.createdAt,
      }));
    }

    if (service === "issue" && table === "issues") {
      return this.issues.map((issue) => ({
        id: issue.id,
        issue_key: issue.issueKey,
        project_id: issue.projectId,
        summary: issue.summary,
        issue_type: issue.issueType,
        status: issue.status,
        priority: issue.priority,
        assignee_id: issue.assigneeId,
        created_at: issue.createdAt,
      }));
    }

    if (service === "admin" && table === "audit_log") {
      // Enough rows that paging is a real control rather than a decoration.
      return Array.from({ length: 47 }, (_, index) => ({
        id: `audit-${String(index + 1).padStart(3, "0")}`,
        actor_id: index % 2 === 0 ? ANNA_ID : MARK_ID,
        action: ["TABLE_READ", "CATALOG_READ", "LOGIN", "ROLE_CHANGED"][index % 4],
        target: ["auth.users", "project.projects", "issue.issues", "admin.audit_log"][index % 4],
        duration_ms: (index % 7) * 11,
        created_at: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T10:${String(index % 60).padStart(2, "0")}:00Z`,
      }));
    }

    return [];
  }

  private project(
    id: string,
    projectKey: string,
    name: string,
    description: string,
    /**
     * Optional because the gateway has no such field: `color` is a label
     * property in the contract, and nothing else. The seeded projects state one
     * so the mock keeps showing the palette DESIGN.md §2.2 chose; anything
     * created at runtime states none and is coloured from its key, which is the
     * path the live gateway takes for every project.
     */
    color: string | undefined,
    memberIds: string[],
  ): Project {
    return {
      id,
      projectKey,
      name,
      description,
      color,
      memberIds,
      createdBy: memberIds[0] ?? ANNA_ID,
      createdAt: "2026-06-08T09:10:00Z",
      updatedAt: "2026-06-18T10:30:00Z",
      archivedAt: null,
    };
  }

  private notification(
    notificationType: Notification["notificationType"],
    title: string,
    body: string,
    link: string,
    createdAt: string,
    readAt: string | null,
  ): Notification {
    return {
      id: makeId("notification"),
      userId: this.currentUserId,
      notificationType,
      title,
      body,
      link,
      createdAt,
      readAt,
      sourceEventId: makeId("event"),
    };
  }

  private getUser(userId: string): User {
    const user = this.users.find((item) => item.id === userId);
    if (!user) {
      throw new MockApiError("NOT_FOUND", "User not found");
    }
    return user;
  }

  private userSummary(userId: string): ProjectMember["user"] {
    const user = this.getUser(userId);
    return {
      displayName: user.displayName,
      email: user.email,
      color: user.color,
    };
  }

  /** The issue as a reader sees it: the stored record plus its current labels. */
  private issueView(issue: Issue): Issue {
    return { ...issue, labels: this.labelsForIssue(issue.id) };
  }

  /**
   * The issue as `IssueShortResponseDto` states it — seven fields since backend
   * PR #148 added `storyPoints` to that DTO, listed one by one rather than
   * spread, so the mock can never hand out a `status` or a `projectId` the
   * gateway would not have sent. That narrowness is the whole reason
   * `IssueSearchHit` exists, and adding the seventh field is the moment it was
   * most likely to be lost.
   */
  private searchHit(issue: Issue): IssueSearchHit {
    return {
      id: issue.id,
      issueKey: issue.issueKey,
      issueType: issue.issueType,
      summary: issue.summary,
      priority: issue.priority,
      assigneeId: issue.assigneeId || null,
      // The seventh field, and the only planning field this DTO carries. Stated
      // one by one like its neighbours so the mock can never hand out a date or
      // an estimate the gateway would not have sent.
      storyPoints: issue.storyPoints,
    };
  }

  /**
   * Resolved through `projectLabels` on every read, in the project's own label
   * order rather than in the order they were attached — the picker below the
   * chips lists them the same way, and two orders for one set of labels reads
   * as a bug even when both are arbitrary.
   */
  private labelsForIssue(issueId: string): Label[] {
    const attached = this.labelIdsByIssue[issueId] ?? [];
    return this.projectLabels
      .filter((label) => label.deletedAt === null && attached.includes(label.id))
      .map(({ id, name, color }) => ({ id, name, color }));
  }

  private findProjectLabel(projectId: string, labelId: string): ProjectLabel {
    this.getProject(projectId);
    const label = this.projectLabels.find(
      (item) => item.projectId === projectId && item.id === labelId && item.deletedAt === null,
    );
    if (!label) {
      throw new MockApiError("NOT_FOUND", "Label not found");
    }
    return label;
  }

  /** Case-insensitive, as TAS-119 asks: "Backend" and "backend" are one name. */
  private findLabelByName(projectId: string, name: string): ProjectLabel | undefined {
    return this.projectLabels.find(
      (item) =>
        item.projectId === projectId &&
        item.deletedAt === null &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
  }

  private validLabelName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new MockApiError("INVALID_ARGUMENT", "A label needs a name");
    }
    if (name.length > LABEL_NAME_MAX) {
      throw new MockApiError("INVALID_ARGUMENT", `A label name is at most ${LABEL_NAME_MAX} characters`);
    }
    return name;
  }

  private validLabelColor(value: string): string {
    if (!HEX_COLOR_PATTERN.test(value)) {
      throw new MockApiError("INVALID_ARGUMENT", "A label colour must be a #RRGGBB value");
    }
    return value;
  }

  private findIssue(projectId: string, issueId: string): Issue {
    const issue = this.issues.find((item) => item.projectId === projectId && item.id === issueId && item.deletedAt === null);
    if (!issue) {
      throw new MockApiError("NOT_FOUND", "Issue not found");
    }
    return issue;
  }

  private findAttachment(projectId: string, issueId: string, attachmentId: string): StoredAttachment {
    const issue = this.findIssue(projectId, issueId);
    const attachment = this.attachments.find(
      (item) => item.id === attachmentId && item.issueId === issue.id && item.deletedAt === null,
    );
    if (!attachment) {
      throw new MockApiError("NOT_FOUND", "Attachment not found");
    }
    return attachment;
  }

  /**
   * `upload-attachment-roles: ADMIN,MEMBER`, checked on both legs that reach
   * the gateway — `createUploadUrl` and `confirmUpload` each open with their
   * own `checkUserHasRoleForIssue` against that same set.
   *
   * Nothing in the UI can reach either leg as a VIEWER, because the picker is
   * hidden. That is exactly why the mock enforces it: a hidden control is a
   * courtesy and the server is the authority, so the only place this gate can
   * be proved is the reference implementation — the same argument
   * `deleteAttachment` is written on.
   *
   * **The sentence below is this mock's, and it is kinder than the gateway's.**
   * `ProjectRoleChecker.validateAccess` answers two different `PERMISSION_DENIED`
   * strings and neither of them is this one: `"Access denied"` when the caller
   * is not a member of the project, and `"Not allowed role"` when they are a
   * member holding the wrong role. It refuses on `!isMember` **before** it maps
   * a role or consults `allowedRoles`, so a non-member never reaches the second
   * sentence. Named here so a future reader does not take this wording for the
   * server's — the panel prints whatever comes back, and against the gateway
   * that is one of those two.
   */
  private requireUploadRole(projectId: string): void {
    const { role } = this.getMembership(projectId);
    if (role !== "ADMIN" && role !== "MEMBER") {
      throw new MockApiError("PERMISSION_DENIED", "You do not have permission to attach files to this issue");
    }
  }

  /**
   * The row as the gateway serves it. `objectKey` is dropped here rather than
   * never stored, because that is the shape of the real thing:
   * `IssueAttachmentMapper.toIssueAttachmentDto` reads eight fields off an
   * `AttachmentResponse` that carries ten, leaving the object key and the
   * presigned download URL behind. A mock that exposed the key would let a
   * component be written against a field the gateway does not send.
   */
  private attachmentView(attachment: StoredAttachment): IssueAttachment {
    return {
      id: attachment.id,
      issueId: attachment.issueId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      uploadedBy: attachment.uploadedBy,
      checksum: attachment.checksum,
      createdAt: attachment.createdAt,
    };
  }

  /**
   * The stored link as the given issue sees it. Only `viewLinkType` depends on
   * the viewer: `sourceIssueId` and `targetIssueId` keep naming the ends the
   * link was created with, so the caller finds "the other issue" by comparing
   * against the issue it asked about rather than by trusting either field.
   */
  private linkView(link: StoredIssueLink, viewerIssueId: string): IssueLink {
    return {
      id: link.id,
      projectId: link.projectId,
      sourceIssueId: link.sourceIssueId,
      targetIssueId: link.targetIssueId,
      viewLinkType: link.sourceIssueId === viewerIssueId ? link.linkType : inverseViewLinkType[link.linkType],
      createdBy: link.createdBy,
      createdAt: link.createdAt,
    };
  }

  // The gateway rejects edits and deletes from anyone but the comment author.
  private findOwnComment(projectId: string, issueId: string, commentId: string): IssueComment {
    const issue = this.findIssue(projectId, issueId);
    const comment = this.commentsByIssue[issue.id]?.find((item) => item.id === commentId);
    if (!comment) {
      throw new MockApiError("NOT_FOUND", "Comment not found");
    }
    if (comment.authorUserId !== this.currentUserId) {
      throw new MockApiError("PERMISSION_DENIED", "Only the author can modify this comment");
    }
    return comment;
  }

  private commentBody(body: string): string {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 10000) {
      throw new MockApiError("INVALID_ARGUMENT", "Comment body must be between 1 and 10000 characters");
    }
    return trimmed;
  }

  private comment(issue: Issue, authorUserId: string, body: string, createdAt: string): IssueComment {
    const comment: IssueComment = {
      id: makeId("comment"),
      issueId: issue.id,
      projectId: issue.projectId,
      authorUserId,
      body,
      createdAt,
      updatedAt: null,
      version: 1,
    };
    this.commentsByIssue[issue.id] = [...(this.commentsByIssue[issue.id] ?? []), comment];
    return comment;
  }

  private pushHistory(
    issueId: string,
    eventType: IssueHistoryEvent["eventType"],
    actorUserId: string,
    payload: IssueHistoryEvent["payload"],
    occurredAt = now(),
  ) {
    const event: IssueHistoryEvent = {
      id: makeId("history"),
      issueId,
      eventType,
      actorUserId,
      occurredAt,
      payload,
    };
    this.historyByIssue[issueId] = [...(this.historyByIssue[issueId] ?? []), event];
  }
}

/**
 * Deliberate limitation: only the session is gated here. The store's data
 * methods stay readable without one, because the mock doubles as the unit-test
 * fixture (MockTaskaApi.test.ts reads projects and issues without signing in)
 * and as the seed the UI is developed against. The route guard is what this
 * story is about; making the store throw would be a different, larger change.
 */
export class MockTaskaApi implements TaskaApi {
  constructor(private readonly store = new MockTaskaStore()) {
    // The session has to survive a reload the way the REST tokens do, or the
    // route guard would bounce every full page load back to the login form.
    const userId = window.localStorage.getItem(SESSION_KEY);
    if (userId && !this.store.restoreSession(userId)) {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const tokens = this.store.login(input);
    window.localStorage.setItem(SESSION_KEY, this.store.currentUser().id);
    return wait(tokens);
  }

  // No session is opened here, on purpose: `POST /auth/invitations/accept`
  // answers 204 with no tokens, so `rest` cannot produce one either and the two
  // modes would disagree about whether an activated user is signed in. How an
  // activated user *does* get a session is a hole in the contract — recorded in
  // docs/ai/API-DIVERGENCE.md.
  async acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    this.store.acceptInvitation(input);
    await wait(null);
  }

  async refresh(_refreshToken: string): Promise<AuthTokens> {
    return wait(this.store.refresh());
  }

  async logout(): Promise<void> {
    window.localStorage.removeItem(SESSION_KEY);
    await wait(null);
  }

  async getCurrentUser(): Promise<User> {
    return wait(this.store.currentUser());
  }

  hasSession(): boolean {
    return window.localStorage.getItem(SESSION_KEY) !== null;
  }

  // Implemented, never fired: the mock hands out tokens that never expire and
  // has no server to reject them, so there is no moment at which a session dies
  // on its own. Signing out is not an expiry and does not belong here either.
  onSessionExpired(_listener: () => void): () => void {
    return () => {};
  }

  async listProjects(): Promise<Project[]> {
    return wait(this.store.listProjects());
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return wait(this.store.createProject(input));
  }

  async getProject(projectId: string): Promise<Project> {
    return wait(this.store.getProject(projectId));
  }

  async getMembership(projectId: string): Promise<ProjectMembership> {
    return wait(this.store.getMembership(projectId));
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    return wait(this.store.listMembers(projectId));
  }

  async getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    void projectId;
    void issueType;
    return wait(this.store.getWorkflow());
  }

  async listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return wait(this.store.listIssues(projectId, params));
  }

  async searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>> {
    return wait(this.store.searchIssues(params));
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return wait(this.store.getIssue(projectId, issueId));
  }

  async getIssueById(issueId: string): Promise<IssueWithHistory> {
    return wait(this.store.getIssueById(issueId));
  }

  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return wait(this.store.createIssue(projectId, input));
  }

  async updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    return wait(this.store.updateIssue(projectId, issueId, input));
  }

  async assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    return wait(this.store.assignIssue(projectId, issueId, assigneeId));
  }

  async transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue> {
    return wait(this.store.transitionIssue(projectId, issueId, transitionId));
  }

  async deleteIssue(projectId: string, issueId: string): Promise<void> {
    this.store.deleteIssue(projectId, issueId);
    await wait(null);
  }

  async listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]> {
    return wait(this.store.listIssueLinks(projectId, issueId));
  }

  async createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink> {
    return wait(this.store.createIssueLink(projectId, issueId, input));
  }

  async deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void> {
    this.store.deleteIssueLink(projectId, issueId, linkId);
    await wait(null);
  }

  async listProjectLabels(projectId: string): Promise<ProjectLabel[]> {
    return wait(this.store.listProjectLabels(projectId));
  }

  async createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel> {
    return wait(this.store.createProjectLabel(projectId, input));
  }

  async updateProjectLabel(
    projectId: string,
    labelId: string,
    input: UpdateProjectLabelInput,
  ): Promise<ProjectLabel> {
    return wait(this.store.updateProjectLabel(projectId, labelId, input));
  }

  async deleteProjectLabel(projectId: string, labelId: string): Promise<void> {
    this.store.deleteProjectLabel(projectId, labelId);
    await wait(null);
  }

  async listIssueLabels(projectId: string, issueId: string): Promise<Label[]> {
    return wait(this.store.listIssueLabels(projectId, issueId));
  }

  async addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    this.store.addIssueLabel(projectId, issueId, labelId);
    await wait(null);
  }

  async removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    this.store.removeIssueLabel(projectId, issueId, labelId);
    await wait(null);
  }

  async listAttachments(projectId: string, issueId: string): Promise<IssueAttachment[]> {
    return wait(this.store.listAttachments(projectId, issueId));
  }

  async createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket> {
    return wait(this.store.createAttachmentUploadUrl(projectId, issueId, input));
  }

  /**
   * Reads the blob here rather than in the store because this is the only layer
   * that may be asynchronous — and it reads the *bytes*, not just `size`, so
   * the checksum the confirm reports is a fact about what was actually sent.
   *
   * `wait` is skipped for the failure paths only in the sense that the throw
   * happens before it; there is no artificial slowness here beyond the store's
   * own, which is the same 140ms every other call takes.
   */
  async putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    const bytes = new Uint8Array(await body.arrayBuffer());
    this.store.putAttachmentBytes(uploadUrl, bytes, contentType);
    await wait(null);
  }

  async confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): Promise<IssueAttachment> {
    return wait(this.store.confirmAttachmentUpload(projectId, issueId, input));
  }

  async getAttachmentDownloadUrl(
    projectId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl> {
    return wait(this.store.getAttachmentDownloadUrl(projectId, issueId, attachmentId));
  }

  async deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void> {
    this.store.deleteAttachment(projectId, issueId, attachmentId);
    await wait(null);
  }

  async listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>> {
    return wait(this.store.listComments(projectId, issueId, params));
  }

  async addComment(projectId: string, issueId: string, body: string): Promise<IssueComment> {
    return wait(this.store.addComment(projectId, issueId, body));
  }

  async updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment> {
    return wait(this.store.updateComment(projectId, issueId, commentId, body));
  }

  async deleteComment(projectId: string, issueId: string, commentId: string): Promise<void> {
    this.store.deleteComment(projectId, issueId, commentId);
    await wait(null);
  }

  async listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>> {
    return wait(this.store.listNotifications(params));
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    return wait(this.store.markNotificationRead(notificationId));
  }

  async markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return wait(this.store.markAllNotificationsRead());
  }

  async getAdminCatalog(): Promise<AdminCatalog> {
    return wait(this.store.adminCatalog());
  }

  async listAdminRows(query: AdminRowsQuery): Promise<AdminRows> {
    return wait(this.store.listAdminRows(query));
  }

  async getAdminRow(query: AdminRowQuery): Promise<AdminRow> {
    return wait(this.store.adminRow(query));
  }

  async getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary> {
    return wait(this.store.problematicOutboxSummary());
  }

  async blockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.blockUser(userId, reason));
  }

  async unblockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.unblockUser(userId, reason));
  }

  async resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange> {
    return wait(this.store.resetCredentialLockout(userId, reason));
  }

  async retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult> {
    return wait(this.store.retryOutboxEvent(service, eventId, reason));
  }
}
