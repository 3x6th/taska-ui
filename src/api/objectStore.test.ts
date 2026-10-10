import { describe, expect, it } from "vitest";
import { UNDEPLOYED_ROUTE_MESSAGE } from "./TaskaApi";
import { apiErrorFacts, isAccountLocked, isConflict, isMissingOrForbidden, isUndeployedRoute } from "./errors";
import {
  OBJECT_STORE_REJECTED_CODE,
  OBJECT_STORE_UNREACHABLE_CODE,
  OBJECT_STORE_UNUSABLE_URL_CODE,
  ObjectStoreError,
  requireUsableDownloadUrl,
} from "./objectStore";

/**
 * The condition AGENTS.md sets for a method on `TaskaApi` that is not a
 * gateway route: its failures carry their own type, and the gateway-error
 * predicates provably do not match it. TAS-253 added the third such leg — the
 * GET of an attachment's bytes — and these are the shapes it throws, the store's
 * own 403 and 404 included, which are exactly the statuses that would read as
 * "missing or not yours" if they travelled in a field called `status`.
 */
describe("ObjectStoreError from the download GET", () => {
  const failures = [
    new ObjectStoreError("The file store could not be reached: Failed to fetch", OBJECT_STORE_UNREACHABLE_CODE, null),
    new ObjectStoreError("The file store answered 403.", OBJECT_STORE_REJECTED_CODE, 403),
    new ObjectStoreError("The file store answered 404.", OBJECT_STORE_REJECTED_CODE, 404),
    new ObjectStoreError("The file store answered 409.", OBJECT_STORE_REJECTED_CODE, 409),
    new ObjectStoreError("The file store answered 405.", OBJECT_STORE_REJECTED_CODE, 405),
    new ObjectStoreError("The download link was not usable, so nothing was fetched.", OBJECT_STORE_UNUSABLE_URL_CODE, null),
  ];

  it.each(failures.map((error) => [error.message, error] as const))("is not a gateway answer: %s", (_name, error) => {
    expect(isMissingOrForbidden(error)).toBe(false);
    expect(isConflict(error)).toBe(false);
    expect(isAccountLocked(error)).toBe(false);
    expect(isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
    // No HTTP status and no request id reach the shared reader: the store's
    // status lives in `storeStatus`, where nothing classifies it by accident.
    const facts = apiErrorFacts(error);
    expect(facts.status).toBeNull();
    expect(facts.requestId).toBeNull();
  });

  it("refuses an empty, relative or non-http link before anything is fetched", () => {
    for (const url of ["", "/api/v1/whatever", "javascript:alert(1)", "blob:https://taska.ozero.dev/x", "data:text/plain,x"]) {
      expect(() => requireUsableDownloadUrl(url)).toThrow(ObjectStoreError);
    }
    expect(() => requireUsableDownloadUrl("https://minio.taska.ozero.dev/taska-attachments/k?X-Amz-Signature=a")).not.toThrow();
  });
});
