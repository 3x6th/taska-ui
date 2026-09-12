/**
 * Everything about the current user's avatar that all three `TaskaApi`
 * implementations and the profile menu have to agree on: the server's own
 * limits and the refusals it answers with.
 *
 * Sibling of `attachments.ts`, built the same way and for the same reason — a
 * rule the mock and the REST adapter both enforce has to be written once, or
 * the two drift and the mock stops being able to prove anything. The cross-
 * origin PUT the upload needs is in `objectStore.ts`, shared with attachments,
 * because that leg is the same leg.
 *
 * **Nothing here is shared with `attachments.ts`, and the agreement between
 * them is a coincidence rather than a constant.** Both ceilings are 2 MB
 * today, and they are two different properties in two different services'
 * `application.yml` — issue-service's for attachments, auth-service's for
 * avatars — against two different buckets. Merging them into one
 * `STORAGE_MAX_SIZE_BYTES` would mean that the day either service is
 * reconfigured, the other feature starts refusing files its server would have
 * taken, or offering files its server will refuse. The next reader will want to
 * merge them; this paragraph is the answer.
 *
 * Every value below was read at backend PR #150's head `12e909d42dcc`, pinned
 * in `docs/contract/pending/pr-150-TAS-129.yml`. Re-read them when that pin
 * moves.
 */

/**
 * The largest avatar the server will store, **2 MB exactly** — and *not* the
 * 5 MB the schema declares.
 *
 * `CreateAvatarUploadUrlRequestDto.sizeBytes` is declared
 * `minimum: 1, maximum: 5242880`, and its description says 5 MB in as many
 * words. What actually enforces the size is the shared
 * `S3StorageClient.validateFileParams`, reading `storage.max-file-size-bytes`
 * from **auth-service's** own `application.yml`, which is `2097152 # 2 MB`. So
 * a 3 MB image passes the gateway's bean validation and is refused a layer
 * deeper, after a round trip.
 *
 * This client enforces the number that is enforced. The declared one is
 * `AVATAR_DECLARED_MAX_SIZE_BYTES` below, named so that a reader who has the
 * schema open can see that the disagreement is known rather than missed. It was
 * raised on TAS-129 while that PR is open; if the backend settles it by raising
 * the *configuration* to match the schema instead, one constant moves and
 * nothing else in this file does.
 *
 * Checked twice on the server, not once, exactly as attachments are:
 * `validateFileParams` refuses an over-size *request* at leg 1, and the confirm
 * re-measures the stored object at leg 3.
 */
export const AVATAR_MAX_SIZE_BYTES = 2097152;

/**
 * What `CreateAvatarUploadUrlRequestDto` says the ceiling is. Deliberately not
 * used as a limit anywhere — it exists so that this file states both numbers
 * and so a reader diffing it against the schema finds the disagreement written
 * down rather than having to rediscover it.
 */
export const AVATAR_DECLARED_MAX_SIZE_BYTES = 5242880;

/**
 * The three MIME types the server accepts, **verbatim and in the order
 * auth-service's `storage.allowed-content-types` lists them**.
 *
 * `S3StorageClient.validateFileParams` tests them with
 * `List.contains(contentType)` — an exact string comparison. No wildcard, no
 * `image/*`, no case folding and no parameter stripping, so `IMAGE/PNG` is
 * refused. Nothing on this side may normalise a browser-reported type before
 * sending it.
 *
 * Three, not thirteen: the attachments allowlist is a different property in a
 * different service and carries PDFs, text and archives. An avatar is an image
 * or it is nothing — GIF, SVG and AVIF included in the nothing.
 */
export const AVATAR_ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * How long a presigned avatar URL is honoured — `storage.presigned-url-ttl`,
 * 15 minutes, and the same value signs both the upload and the download link.
 *
 * **The download side is the one that matters here**, and it is why `Avatar`
 * falls back to initials instead of showing a broken image: a `downloadUrl`
 * that came with a member list fifteen minutes ago has simply expired, which is
 * an ordinary state of a long-open board rather than an error anybody should be
 * told about.
 *
 * Used for wording and for the mock's own expiry, never as a client-side gate
 * that would refuse a link the server would still have honoured.
 */
export const AVATAR_PRESIGNED_TTL_MS = 15 * 60 * 1000;

/**
 * `storage.bucket` for auth-service — only ever used to shape the mock's
 * presigned URLs, so that what a reader sees in mock mode has the same shape as
 * the deployed stand's. Not the attachments bucket, and the two are configured
 * separately.
 */
export const AVATAR_BUCKET = "taska-avatars";

/**
 * The host the mock signs its upload links against, and **the one value in this
 * file that is not a reading of the backend**: the pinned extract records
 * auth-service's bucket, its ceiling, its allowlist and its TTL, and does not
 * record its `storage.public-url`. This is the address the *attachments* block
 * checks in, reproduced here so a reader in mock mode sees a link with the
 * right shape — absolute, not the gateway — rather than a claim about where
 * auth-service's store actually lives.
 *
 * Nothing outside `MockTaskaStore` reads it. `RestTaskaApi` PUTs to whatever
 * the gateway signed, and never to this.
 */
export const AVATAR_MOCK_STORE_ORIGIN = "http://127.0.0.1:9000";

/**
 * What goes in the file input's `accept`, built from the allowlist so the two
 * cannot drift.
 *
 * A hint and never the guard. `accept` filters by the *operating system's* idea
 * of a type and `File.type` is the *browser's*, so a file can pass the picker
 * and still be refused by `avatarRefusal` below. The refusal is the guard; this
 * only spares most people from meeting it.
 */
export const AVATAR_ACCEPT_ATTRIBUTE = AVATAR_ALLOWED_CONTENT_TYPES.join(",");

/** The accepted list as a person reads it, for the line shown before a file is chosen. */
export const AVATAR_ACCEPTED_SUMMARY = "JPEG, PNG or WebP";

/**
 * `S3StorageClient.validateFileParams`, word for word, for a type outside the
 * allowlist: `"Content type not allowed: " + contentType`. Reproduced rather
 * than reworded so that a refusal reads the same whether this side stopped it
 * or the server did.
 */
export const avatarTypeRefusalMessage = (contentType: string) => `Content type not allowed: ${contentType}`;

/** Same method, the `sizeBytes <= 0` arm: `"File size must be positive, got: " + sizeBytes`. */
export const avatarEmptyRefusalMessage = (sizeBytes: number) => `File size must be positive, got: ${sizeBytes}`;

/**
 * Same method again, the over-size arm — and the sentence carries the number
 * the server would have used, which is the *enforced* 2 MB and not the
 * declared 5 MB. A refusal quoting a ceiling the server does not apply would be
 * worse than no sentence at all.
 */
export const avatarSizeRefusalMessage = (sizeBytes: number) =>
  `File size ${sizeBytes} bytes exceeds maximum allowed size of ${AVATAR_MAX_SIZE_BYTES} bytes`;

/** The three facts every implementation needs about an image before leg 1. */
export interface AvatarCandidate {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/** Which of `validateFileParams`'s three arms an image trips. */
export type AvatarRefusalKind = "type" | "empty" | "size";

/**
 * Why this file cannot be an avatar, or `null` if it can — decided before any
 * request and identically by every implementation, so the same file is refused
 * in mock mode and against the gateway.
 *
 * Order matters and follows the server's: type first, then the empty file, then
 * the ceiling. A 3 MB GIF is refused for its *type*, which is the fact that
 * will not change if the person shrinks it.
 *
 * The **kind** is separate from the sentence because the two audiences are.
 * `avatarRefusal` below turns a kind into the server's own words, which is what
 * the API layer throws so that a mock refusal and a gateway refusal read alike.
 * The profile menu takes the kind and writes its own sentence instead: those
 * arms never travel over the wire, and a person holding a photo is owed a size
 * they can compare with the limit the picker states, not
 * `"File size 2097153 bytes exceeds maximum allowed size of 2097152 bytes"`.
 */
export function avatarRefusalKind(candidate: AvatarCandidate): AvatarRefusalKind | null {
  const allowed: readonly string[] = AVATAR_ALLOWED_CONTENT_TYPES;
  if (!allowed.includes(candidate.contentType)) return "type";
  if (candidate.sizeBytes <= 0) return "empty";
  if (candidate.sizeBytes > AVATAR_MAX_SIZE_BYTES) return "size";
  return null;
}

/**
 * The same decision in `S3StorageClient.validateFileParams`'s own words, for
 * the implementations that stand in for the server. A reader-facing sentence
 * belongs to the profile menu, not here.
 */
export function avatarRefusal(candidate: AvatarCandidate): string | null {
  switch (avatarRefusalKind(candidate)) {
    case "type":
      return avatarTypeRefusalMessage(candidate.contentType || "unknown");
    case "empty":
      return avatarEmptyRefusalMessage(candidate.sizeBytes);
    case "size":
      return avatarSizeRefusalMessage(candidate.sizeBytes);
    default:
      return null;
  }
}
