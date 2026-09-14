/**
 * The one leg of a presigned upload that is **not** a gateway request, and
 * everything a caller needs to tell its failures apart from a gateway's.
 *
 * Two features now share this choreography — issue attachments (backend PR
 * #147, TAS-190) and the user's avatar (backend PR #150, TAS-129) — and they
 * share exactly this much: ask the gateway to sign an upload, PUT the bytes to
 * a host that is not the gateway, then confirm. Everything else about them is
 * separate, including their buckets and their limits, which is why the two
 * constant modules beside this one do not share a line.
 *
 * It used to live in `attachments.ts` under attachment-specific names. Moved
 * here rather than copied, because the guarantee AGENTS.md attaches to it is
 * about the *class*: "such a method carries its own error type that the
 * gateway-error predicates in `src/api/errors.ts` provably do not match". Two
 * error types meaning the same thing would be two chances for one of them to
 * drift into a shape `isMissingOrForbidden` matches, and only one of them would
 * have the test that says it must not.
 */

/** The store could not be reached at all: no status, because no response came back. */
export const OBJECT_STORE_UNREACHABLE_CODE = "STORAGE_UNREACHABLE";

/** The store answered, and the answer was not a success. */
export const OBJECT_STORE_REJECTED_CODE = "STORAGE_REJECTED";

/**
 * Nothing was sent at all, because the link leg 1 handed back is not a link
 * this browser may PUT to. See `requireUsableUploadUrl`.
 */
export const OBJECT_STORE_UNUSABLE_URL_CODE = "STORAGE_URL_UNUSABLE";

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
export class ObjectStoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** The status the store answered with, or `null` when nothing answered. */
    public readonly storeStatus: number | null,
  ) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

/**
 * The one thing every implementation of a direct-to-store PUT has to check
 * before it sends anything: that the link leg 1 handed back is an absolute
 * `http(s)` URL.
 *
 * `RestTaskaApi` lands a response with no `uploadUrl` as `""`, the way it lands
 * every other absent field, and `fetch("")` does not fail — it **resolves
 * against the document**, so the PUT would go to the SPA's own URL. On that
 * request `credentials: "same-origin"` stops being the no-op the leg-2 comment
 * describes and attaches this app's cookies to a PUT of the file's bytes. A
 * malformed gateway response must not be able to do that.
 *
 * Refused as an `ObjectStoreError` rather than an `ApiError` even though a
 * gateway answer is what produced it: nothing was sent, so there is no gateway
 * *failure* to report, and the store-error shape is the one the callers already
 * read as "the middle leg did not happen". Its own code, because the sentence
 * for it is neither "we could not reach the store" nor "the store said no" —
 * nobody was asked.
 *
 * A relative or empty string throws out of `new URL`, so both land here; the
 * protocol test then also refuses `javascript:`, `data:` and `blob:` links,
 * which are absolute and are not somewhere to PUT a file.
 */
export function requireUsableUploadUrl(uploadUrl: string): void {
  let parsed: URL | null;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new ObjectStoreError(
      "The upload link was not usable, so nothing was sent.",
      OBJECT_STORE_UNUSABLE_URL_CODE,
      null,
    );
  }
}

/**
 * Which of the four ways the direct PUT can fail this was, or `null` if the
 * failure came from somewhere else.
 *
 * - `unusable` — nothing was sent, because the link was not one. See
 *   `requireUsableUploadUrl`. First, because it is the only one of the four
 *   that is not a fact about the store, and it shares `blocked`'s absent
 *   status.
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
export type ObjectStoreUploadFailure =
  | { kind: "unusable" }
  | { kind: "blocked" }
  | { kind: "expired"; storeStatus: number }
  | { kind: "rejected"; storeStatus: number };

export function objectStoreUploadFailure(error: unknown): ObjectStoreUploadFailure | null {
  if (!(error instanceof ObjectStoreError)) return null;
  if (error.code === OBJECT_STORE_UNUSABLE_URL_CODE) return { kind: "unusable" };
  if (error.storeStatus === null) return { kind: "blocked" };
  if (error.storeStatus === 403) return { kind: "expired", storeStatus: error.storeStatus };
  return { kind: "rejected", storeStatus: error.storeStatus };
}
