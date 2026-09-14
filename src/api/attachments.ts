/**
 * Everything about issue attachments that all three `TaskaApi` implementations
 * and the panel have to agree on: the server's own limits and the refusals it
 * answers with.
 *
 * Sibling of `planningFields.ts` and here for the same reason: a rule the mock
 * and the REST adapter both enforce has to be written once, or the two drift
 * and the mock stops being able to prove anything.
 *
 * The failure that never travels as an `ApiError` **used to be declared here**
 * and now lives in `objectStore.ts`, because a second feature — the user's
 * avatar, backend PR #150 — PUTs bytes to a presigned host the same way. What
 * moved is only the leg that is not a gateway request: `ObjectStoreError`,
 * `requireUsableUploadUrl` and the failure classifier. Everything below stayed,
 * because every line of it is a fact about the *attachments* bucket and about
 * nothing else.
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

/** Which of `validateFileParams`'s three arms a file trips. */
export type AttachmentRefusalKind = "type" | "empty" | "size";

/**
 * Why this file cannot be uploaded, or `null` if it can — decided before any
 * request and identically by every implementation, so the same file is refused
 * in mock mode and against the gateway.
 *
 * Order matters and follows the server's: type first, then the empty file, then
 * the ceiling. A 3 MB `.docx` is refused for its *type*, which is the fact that
 * will not change if the person shrinks it.
 *
 * The **kind** is separate from the sentence because the two audiences are.
 * `attachmentRefusal` below turns a kind into the server's own words, which is
 * what the API layer throws so that a mock refusal and a gateway refusal read
 * alike. The panel takes the kind and writes its own sentence instead: those
 * two arms never travel over the wire, and a person holding a file is owed its
 * name and a size they can compare with the limit the picker states, not
 * `"File size 2097153 bytes exceeds maximum allowed size of 2097152 bytes"`.
 */
export function attachmentRefusalKind(candidate: AttachmentCandidate): AttachmentRefusalKind | null {
  const allowed: readonly string[] = ATTACHMENT_ALLOWED_CONTENT_TYPES;
  if (!allowed.includes(candidate.contentType)) return "type";
  if (candidate.sizeBytes <= 0) return "empty";
  if (candidate.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) return "size";
  return null;
}

/**
 * The same decision in `S3StorageClient.validateFileParams`'s own words, for
 * the implementations that stand in for the server. A reader-facing sentence
 * belongs to the panel, not here.
 */
export function attachmentRefusal(candidate: AttachmentCandidate): string | null {
  switch (attachmentRefusalKind(candidate)) {
    case "type":
      return attachmentTypeRefusalMessage(candidate.contentType || "unknown");
    case "empty":
      return attachmentEmptyRefusalMessage(candidate.sizeBytes);
    case "size":
      return attachmentSizeRefusalMessage(candidate.sizeBytes);
    default:
      return null;
  }
}
