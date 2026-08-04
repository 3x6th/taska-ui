// Deliberate duck typing: the two error classes this has to read are not
// related. MockApiError (mock/MockTaskaApi.ts) carries only `code`; ApiError
// (rest/RestTaskaApi.ts) carries `code` and the HTTP `status`. Introducing one
// shared error type is its own piece of work and stays in the backlog — this
// helper only answers the single question DESIGN.md §4.18 asks: is this failure
// "missing or not yours", which the UI must not tell apart.

// Codes come from MockApiError / ApiError (`code`), statuses from ApiError (`status`).
export function isMissingOrForbidden(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as Partial<{ code: unknown; status: unknown }>;
  return code === "NOT_FOUND" || code === "PERMISSION_DENIED" || status === 404 || status === 403;
}
