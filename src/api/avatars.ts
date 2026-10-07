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
 * Every value below was read at backend `develop` `368ae77355bd`, where PR #150
 * (TAS-129) merged on 2026-09-14, and the size limit again at `60d62ee`, where
 * TAS-222 (`be6ea7f`) brought the schema into line with the service: the
 * contract's schemas, auth-service's `application.yml`, and the shared storage
 * client that reads it. Re-read them when that snapshot is refreshed or
 * auth-service's storage configuration changes — the second can move without
 * the first.
 */

/**
 * The largest avatar the server will store, **2 MB exactly** — and since
 * backend TAS-222 (`be6ea7f`, deployed) the number the schema declares too.
 *
 * `CreateAvatarUploadUrlRequestDto.sizeBytes` is `minimum: 1, maximum: 2097152`
 * in the contract, and the gateway generates its DTOs with `useValidation`, so
 * `@Max(2097152)` fails as the body is read and
 * `GatewayValidationExceptionHandler` answers **400** `INVALID_ARGUMENT` with
 * its fixed `AVATAR_GATEWAY_REFUSAL_MESSAGE` — before the avatar call leaves the
 * gateway, and before the content type is looked at. A 3 MB GIF is therefore
 * refused for its size, not its type.
 *
 * auth-service enforces the same number behind it (`S3StorageClient
 * .validateFileParams`, reading its `storage.max-file-size-bytes: 2097152`).
 * The schema used to say 5 MB, so a file between the two reached that check and
 * came back `OUT_OF_RANGE`; nothing a client sends can reach it now
 * (docs/ai/API-DIVERGENCE.md, "Closed by TAS-246: the avatar schema declared
 * 5 MB and the service enforced 2 MB"). The service still re-measures the
 * stored object at the confirm (leg 3), and that refusal is still
 * `OUT_OF_RANGE`.
 */
export const AVATAR_MAX_SIZE_BYTES = 2097152;

/**
 * The gateway's answer for an avatar request its bean validation refuses —
 * `GatewayValidationExceptionHandler`'s fixed sentence, word for word, sent on
 * **400** with `INVALID_ARGUMENT`. It names no field and no number, which is the
 * gateway's choice rather than a sentence this client would have written; the
 * profile menu never shows it, because it refuses an over-size file in its own
 * words first.
 */
export const AVATAR_GATEWAY_REFUSAL_MESSAGE = "Invalid request parameters";

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
 * whose default is 15 minutes, and the same value signs both the upload and the
 * download link. A default and not a literal: the property reads
 * `${MINIO_PRESIGNED_URL_TTL:15m}`, so an environment can change it and nothing
 * on this side can see that it has.
 *
 * **The download side is the one that matters here**, and it is why `Avatar`
 * falls back to initials instead of showing a broken image: a `downloadUrl`
 * that came with a member list fifteen minutes ago has simply expired, which is
 * an ordinary state of a long-open board rather than an error anybody should be
 * told about.
 *
 * Used for the mock's own expiry, never as a client-side gate that would
 * refuse a link the server would still have honoured. **Not** used for
 * wording: nothing interpolates this constant into a sentence, so the
 * "15 minutes" wording in the profile menu is a literal, written separately.
 * This constant is a record of the server's `storage.presigned-url-ttl`, not
 * its source — a reader changing one is not warned to check the other.
 */
export const AVATAR_PRESIGNED_TTL_MS = 15 * 60 * 1000;

/**
 * `storage.bucket` for auth-service, or rather its default —
 * `${MINIO_BUCKET_AVATARS:taska-avatars}`, which an environment can override —
 * only ever used to shape the mock's presigned URLs, so that what a reader sees
 * in mock mode has the same shape as a default deployment's. Not the
 * attachments bucket, and the two are configured separately.
 */
export const AVATAR_BUCKET = "taska-avatars";

/**
 * The host the mock signs its upload links against: auth-service's own
 * `storage.public-url` default, `${MINIO_PUBLIC_URL:http://127.0.0.1:9000}` —
 * a reading of the backend, like the bucket, the ceilings, the allowlist and
 * the TTL above, and the same loopback default the attachments block carries. It is reproduced so a reader in mock
 * mode sees a link with the right shape — absolute, and not the gateway — and
 * it says nothing about where a deployment's store actually lives: a loopback
 * address cannot be the stand's, and whether the stand overrides it is unknown
 * until the first real upload from its origin.
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
 * Same method again, the over-size arm. Since TAS-222 the request never gets
 * this far with an over-size file — the gateway refuses it first — so this is
 * the leg-3 sentence: the confirm re-measures the stored object and refuses it
 * with this, as `OUT_OF_RANGE`.
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
 * Order matters, and it is the menu's rather than the server's: type first,
 * then the empty file, then the ceiling. A 3 MB GIF is refused for its *type*,
 * which is the fact that will not change if the person shrinks it. The gateway
 * asks the other way round — the size, in bean validation, before the type —
 * which is why the implementations standing in for it check the size first
 * themselves (`refuseAvatar`, `MockTaskaStore.createAvatarUploadUrl`) and use
 * this only for the type and the empty file.
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
