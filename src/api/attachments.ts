/**
 * Everything about issue attachments that all three `TaskaApi` implementations
 * and the panel have to agree on: the server's own limits, the refusals it
 * answers with, and the one failure in this feature that never travels as an
 * `ApiError` because it never touches the gateway.
 *
 * Sibling of `planningFields.ts` and here for the same reason: a rule the mock
 * and the REST adapter both enforce has to be written once, or the two drift
 * and the mock stops being able to prove anything.
 */

/**
 * The largest file the server will store, **2 MB exactly**.
 *
 * Read out of `issue-service/src/main/resources/application.yml` at backend PR
 * #147's head `f53dca38`, where the line is
 *
 * ```yaml
 * storage:
 *   max-file-size-bytes: 2097152 # 2 MB
 * ```
 *
 * — a bare YAML literal with **no `${…}` env override**, unlike every other
 * property in that block (`presigned-url-ttl`, `bucket`, `endpoint`,
 * `public-url` and the rest all take one). So on today's backend this number
 * cannot be moved by configuration and is the same in every environment, which
 * is what makes pinning it here safe.
 *
 * **It becomes a lie the moment that line changes**, and nothing on this side
 * will notice: the frontend would refuse a file the server would have taken, or
 * — worse, and the direction that costs a round trip and an orphaned object —
 * accept one the server refuses at `confirm` after the bytes are already in the
 * bucket. Re-read that line when the pin in `docs/contract/pending/` moves.
 *
 * Checked twice on the server, not once: `S3StorageClient.validateFileParams`
 * refuses an over-size *request* at leg 1, and
 * `validateAndGetUploadedObjectMetadata` re-measures the stored object at leg 3
 * and deletes it if it is over. This constant exists so neither of those is
 * ever the first time anybody hears about the limit.
 */
export const ATTACHMENT_MAX_SIZE_BYTES = 2097152;

/**
 * The thirteen MIME types the server accepts, **verbatim and in the order the
 * YAML lists them** (`storage.allowed-content-types`, same file and same
 * commit).
 *
 * `S3StorageClient.validateFileParams` tests them with
 * `List.contains(contentType)` — an exact string comparison. There is no
 * wildcard, no `image/*`, no case folding and no parameter stripping, so
 * `IMAGE/PNG` is refused, and so is `text/plain; charset=utf-8`. That is why
 * nothing on this side may normalise a browser-reported type before sending it.
 *
 * The list refuses more than people expect, and every one of these is a real
 * file somebody will try:
 *
 * - `.docx` and `.xlsx` — the Office types are not here at all;
 * - GIF and SVG — `image/gif` and `image/svg+xml` are not here, though JPEG,
 *   PNG and WebP are;
 * - every video and every audio type;
 * - any file the browser cannot type, which it reports as
 *   `application/octet-stream` — an extensionless file, most often;
 * - a `.zip` on the Windows browsers that report `application/x-zip-compressed`
 *   rather than `application/zip`. Same file, same bytes, refused on one
 *   machine and accepted on another, which is why the picker states the
 *   accepted list up front instead of letting someone find out afterwards.
 */
export const ATTACHMENT_ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/x-yaml",
  "application/zip",
] as const;

/**
 * How long a presigned URL is honoured — `storage.presigned-url-ttl: 15m`, and
 * the same value signs both the upload and the download link
 * (`S3StorageClient` passes `properties.getPresignedUrlTtl()` to both
 * presigners).
 *
 * **The clock starts at leg 1**, when the ticket is minted, not when the panel
 * opens and not when the PUT starts. That is the whole reason the panel asks
 * for the ticket at the moment a file is chosen: a ticket requested on mount
 * and used twenty minutes later is a 403 the person cannot explain.
 *
 * Unlike the size ceiling this one *is* env-overridable
 * (`${MINIO_PRESIGNED_URL_TTL:15m}`), so it is used for wording and for the
 * mock's own expiry — never as a client-side gate that would refuse a link the
 * server would still have honoured.
 */
export const ATTACHMENT_PRESIGNED_TTL_MS = 15 * 60 * 1000;

/** `storage.bucket` — only ever used to shape the mock's presigned URLs. */
export const ATTACHMENT_BUCKET = "taska-attachments";

/**
 * `storage.public-url`'s only checked-in value. The mock builds its upload and
 * download URLs on it so that what a reader sees in mock mode is the same host
 * the deployed stand would hand them — including the fact that it is not the
 * gateway.
 */
export const ATTACHMENT_STORE_ORIGIN = "http://127.0.0.1:9000";

/**
 * What goes in the file input's `accept`, built from the allowlist so the two
 * cannot drift.
 *
 * A hint and never the guard. `accept` filters by the *operating system's* idea
 * of a type, `File.type` is the *browser's*, and the `.zip` case above is
 * exactly where those two disagree — so a file can pass the picker and still be
 * refused by `attachmentRefusal` below. The refusal is the guard; this only
 * spares most people from meeting it.
 */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = ATTACHMENT_ALLOWED_CONTENT_TYPES.join(",");

/**
 * The accepted list as a person reads it, for the line the picker shows
 * *before* a file is chosen. Grouped by what someone would call the file rather
 * than by MIME type, because "application/x-yaml" is not how anybody describes
 * a file they are looking at.
 */
export const ATTACHMENT_ACCEPTED_SUMMARY =
  "JPEG, PNG or WebP images, PDF, plain text, CSV, Markdown, HTML, JSON, XML, YAML or ZIP";

/**
 * `S3StorageClient.validateFileParams`, word for word, for a type outside the
 * allowlist: `"Content type not allowed: " + contentType`. Reproduced rather
 * than reworded so that a refusal reads the same whether this side stopped it
 * or the server did.
 */
export const attachmentTypeRefusalMessage = (contentType: string) =>
  `Content type not allowed: ${contentType}`;

/** Same method, the `sizeBytes <= 0` arm: `"File size must be positive, got: " + sizeBytes`. */
export const attachmentEmptyRefusalMessage = (sizeBytes: number) =>
  `File size must be positive, got: ${sizeBytes}`;

/**
 * Same method again, the over-size arm — and the identical sentence
 * `validateAndGetUploadedObjectMetadata` uses at leg 3.
 */
export const attachmentSizeRefusalMessage = (sizeBytes: number) =>
  `File size ${sizeBytes} bytes exceeds maximum allowed size of ${ATTACHMENT_MAX_SIZE_BYTES} bytes`;

/** The three facts every implementation needs about a file before leg 1. */
export interface AttachmentCandidate {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * The server's own sentence for why this file cannot be uploaded, or `null` if
 * it can — checked before any request, identically by every implementation, so
 * a bad file is refused in the same words in mock mode and against the gateway.
 *
 * Order matters and follows the server's: type first, then the empty file, then
 * the ceiling. A 3 MB `.docx` is refused for its *type*, which is the fact that
 * will not change if the person shrinks it.
 */
export function attachmentRefusal(candidate: AttachmentCandidate): string | null {
  const allowed: readonly string[] = ATTACHMENT_ALLOWED_CONTENT_TYPES;
  if (!allowed.includes(candidate.contentType)) {
    return attachmentTypeRefusalMessage(candidate.contentType || "unknown");
  }
  if (candidate.sizeBytes <= 0) return attachmentEmptyRefusalMessage(candidate.sizeBytes);
  if (candidate.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) return attachmentSizeRefusalMessage(candidate.sizeBytes);
  return null;
}

/** The store could not be reached at all: no status, because no response came back. */
export const ATTACHMENT_STORE_UNREACHABLE_CODE = "STORAGE_UNREACHABLE";

/** The store answered, and the answer was not a success. */
export const ATTACHMENT_STORE_REJECTED_CODE = "STORAGE_REJECTED";

/**
 * A failure of the **middle leg** — the browser's own PUT straight to the
 * object store, which does not pass through the gateway and therefore never
 * produces an `ApiError`.
 *
 * **It deliberately has no `status` field, and adding one would be a bug.**
 * `apiErrorFacts` in `src/api/errors.ts` reads `status` off any `Error`, and
 * `isMissingOrForbidden` turns a `403` there into "missing or not yours" — the
 * sentence §4.18 reserves for a gateway permission answer. A store's 403 means
 * the *signature* was not accepted, which is a different fact about a different
 * server, so the store's real status travels as `storeStatus` and in the
 * message, where nothing classifies it by accident.
 *
 * The `code` values are for the same reason outside the gateway's `DomainStatus`
 * vocabulary: neither `isMissingOrForbidden` nor `isConflict` matches them.
 */
export class AttachmentStoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** The status the store answered with, or `null` when nothing answered. */
    public readonly storeStatus: number | null,
  ) {
    super(message);
    this.name = "AttachmentStoreError";
  }
}

/**
 * Which of the three ways the direct PUT can fail this was, or `null` if the
 * failure came from somewhere else.
 *
 * - `blocked` — `fetch` rejected without a response. A cross-origin PUT stopped
 *   by CORS preflight surfaces exactly like this: a `TypeError`, no status, and
 *   by design no way for script to learn why. Being offline, DNS failing and
 *   mixed content look the same, which is why the sentence for it names the
 *   possibilities rather than picking one.
 * - `expired` — the store answered `403`. The presigned signature stopped being
 *   accepted: fifteen minutes elapsed, or the `Content-Type` sent did not match
 *   the one that was signed. Not a permission failure, and not something
 *   retrying the same link fixes.
 * - `rejected` — any other status the store returned.
 */
export type AttachmentUploadFailure =
  | { kind: "blocked" }
  | { kind: "expired"; storeStatus: number }
  | { kind: "rejected"; storeStatus: number };

export function attachmentUploadFailure(error: unknown): AttachmentUploadFailure | null {
  if (!(error instanceof AttachmentStoreError)) return null;
  if (error.storeStatus === null) return { kind: "blocked" };
  if (error.storeStatus === 403) return { kind: "expired", storeStatus: error.storeStatus };
  return { kind: "rejected", storeStatus: error.storeStatus };
}
