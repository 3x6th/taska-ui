/**
 * Reading the deadline out of the gateway's account-lock refusal.
 *
 * `POST /api/v1/auth/login` answers an account locked by failed sign-ins with
 *
 * ```
 * 403 {"code":"PERMISSION_DENIED","message":"Account is locked until 2026-09-22T11:55:50.398486Z. Try again later."}
 * ```
 *
 * and the deadline exists **only** in that English prose. There is nothing
 * structured to read anywhere in the envelope: every gRPC refusal in the
 * backend monorepo is `Status.withDescription(String)` — no `withDetails`, no
 * `com.google.rpc.ErrorInfo`, no `Metadata.Key` in any service — and
 * `RestErrorResponse` is `{code, message}` with no `details` field, in the
 * handwritten contract and in the gateway's own `/v3/api-docs` alike. So
 * parsing the sentence is the only route to a readable time, and the whole of
 * that parsing lives here rather than inside the screen, where it could be
 * neither tested nor found again (docs/ai/API-DIVERGENCE.md).
 *
 * Two rules hold everything below together. The **branch** is chosen by the
 * response code and never by the wording — `isAccountLocked` in
 * src/api/errors.ts — so a reworded sentence loses the pretty time and keeps
 * the right refusal. The **number** is then keyed off the shape of an ISO
 * instant and never off the words around it, so the same rewording usually
 * does not even cost the time.
 */

/**
 * The gateway's sentence, verbatim, measured at backend head `63f7ea5` on
 * 2026-09-22.
 *
 * Pinned for the reason `UNDEPLOYED_ROUTE_MESSAGE` (src/api/TaskaApi.ts) is: a
 * server string this build reads is a measurement, and it belongs where the
 * measurement can be read. Unlike that one it is **not** matched against —
 * matching the prose is exactly what `LOCK_INSTANT_PATTERN` exists to avoid —
 * so its job is to be the fixture the parser is tested on and the shape the
 * mock reproduces. Backend PR #162 reworded this sentence within the week
 * before this was written (". Try again later." is its addition), so the next
 * rewording is a question of when: the tests below fail the moment somebody
 * edits one copy of the shape and not the other, which is the loud break a
 * silent fall back to raw UTC would not be.
 *
 * Built by string concatenation in `AuthServiceImpl.java:235-238`. The `Instant`
 * it interpolates carries microseconds, which no JavaScript `Date` can hold —
 * hence six fractional digits here and three from `accountLockedMessage`.
 */
export const ACCOUNT_LOCKED_MESSAGE = "Account is locked until 2026-09-22T11:55:50.398486Z. Try again later.";

/**
 * An ISO-8601 UTC instant, anywhere in a sentence.
 *
 * The fractional part is optional and of free length on purpose:
 * `Instant.toString()` emits 0, 3, 6 or 9 fractional digits depending on the
 * value, so a lock that lands on a whole second serialises as
 * `2026-09-22T11:55:50Z`. A pattern copied from the six-digit sample above
 * would miss roughly one lock in a million and be untraceable when it did.
 *
 * No `g` flag: a global regex carries `lastIndex` between calls, and this one
 * is shared by a parser, a test and an end-to-end assertion.
 */
export const LOCK_INSTANT_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

/**
 * The same sentence for a given deadline — what `MockTaskaApi` throws, so that
 * mock mode refuses a locked account in the gateway's shape rather than in one
 * nothing else would ever send (AGENTS.md: the implementations stay
 * behaviourally interchangeable). Written here beside the measurement it
 * imitates, because two copies of a shape in two files is how they drift.
 */
export const accountLockedMessage = (until: Date) =>
  `Account is locked until ${until.toISOString()}. Try again later.`;

/**
 * The instant a locked account frees up, or `null` when the sentence does not
 * yield a usable one. The caller shows the server's own message in that case:
 * unreadable and accurate beats readable and invented.
 *
 * `null` for three different reasons, and the third is the one worth stating:
 *
 * - no instant in the message — a rewording the pattern no longer matches, or
 *   a `PERMISSION_DENIED` that is not about a lock at all;
 * - an instant that is not a date — the pattern accepts `2026-13-45T…`, which
 *   `Date.parse` rejects;
 * - **an instant already past.** A stale sentence is worse than an ugly one:
 *   "locked until 14:55" read at 15:10 tells the reader to wait for a moment
 *   that has gone, and they have no way to know it. The raw sentence at least
 *   carries its own date. `now` is a parameter so this arm can be tested
 *   without moving the clock.
 */
export function accountLockedUntil(message: string | null, now = Date.now()): Date | null {
  if (!message) return null;
  const found = LOCK_INSTANT_PATTERN.exec(message);
  if (!found) return null;
  const instant = Date.parse(found[0]);
  if (!Number.isFinite(instant) || instant <= now) return null;
  return new Date(instant);
}

/**
 * `14:55` — the deadline on the reader's own clock.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, which is the option that
 * actually guarantees `00:30` at midnight instead of `24:30`, and it holds
 * whatever the locale would have chosen. The locale itself is the reader's
 * (`undefined`) rather than `format.ts`'s pinned `en-US`, and the difference is
 * deliberate: those render server timestamps in the product's own English
 * voice, while this is a deadline the reader has to act on and the entire
 * complaint behind TAS-237 is that it arrived in somebody else's frame of
 * reference. The zone follows from the same argument, and nothing here adds a
 * fixed offset — `+3` is the reporter's own zone, not a rule.
 *
 * `HH:mm`, not `HH:mm:ss`. The story says both: its prose asks for seconds
 * while its worked example and both quoted lines say `14:55`, and DESIGN.md §6
 * «Формат данных» already sets `MMM d, HH:mm` 24h as this product's time.
 * Seconds on a fifteen-minute lockout are noise with a false precision: the
 * server rounds nothing and the reader is not going to count them.
 */
export const formatLockTime = (until: Date) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(until);

/**
 * `Sep 23, 00:30 GMT+3` — the same instant with everything the short form
 * drops.
 *
 * A fifteen-minute lock started at 23:55 ends tomorrow, and `00:10` on its own
 * is then ambiguous in the one direction that matters (the reader assumes
 * today and thinks the wait is over). The date answers that, and the zone name
 * answers the question the story was filed about — whose clock this is.
 *
 * Where it is spent is `formatLockDeadline`'s decision, not this function's:
 * in the `title` while the short form is unambiguous, and in the sentence
 * itself once it is not.
 */
export const formatLockMoment = (until: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(until);

/**
 * What the reader sees, and what is left for `title` to add: `14:55` on their
 * own day, `Sep 23, 00:10 GMT+3` once the lock runs past their midnight.
 *
 * **The title was the whole answer to the late lock, and on a phone it is no
 * answer at all.** There is no hover on touch, a `<time>` takes no focus, and
 * nothing else reaches a `title` from the keyboard — so a fifteen-minute lock
 * started at 23:55 showed a phone reader `Account is locked until 00:10` with
 * nothing anywhere saying "tomorrow", which is the exact misreading the
 * attribute was put there to prevent. The date therefore moves into the
 * sentence for the case that needs it, and the attribute keeps only what the
 * sentence does not already carry — on the crossing case, nothing. Text and
 * title come back together because they are one decision: a `title` repeating
 * its own element is a tooltip that says what is already on screen and a
 * description a screen reader may read out twice.
 *
 * **The comparison is on the reader's calendar day, and not on UTC.**
 * `getFullYear`/`getMonth`/`getDate` are local by definition, which is the
 * whole point: the pair this exists for — 23:50 and 00:05 in Moscow — is one
 * and the same UTC day, so a `toISOString().slice(0, 10)` comparison would
 * call it today and print the bare clock again. `e2e/login-lock.spec.ts` pins
 * that pair with the browser clock and zone both fixed; a unit test cannot,
 * for the reason written over `formatLockTime`'s tests in
 * `accountLock.test.ts`.
 *
 * `now` is a parameter for the same reason it is one on `accountLockedUntil`:
 * so the branch can be chosen in a test without moving the clock. Read at
 * render, like the deadline itself — a lock open across midnight gains its
 * date on the next paint rather than being decided once at mount.
 */
export function formatLockDeadline(until: Date, now = new Date()): { text: string; title?: string } {
  const onReadersDay =
    until.getFullYear() === now.getFullYear() &&
    until.getMonth() === now.getMonth() &&
    until.getDate() === now.getDate();

  return onReadersDay
    ? { text: formatLockTime(until), title: formatLockMoment(until) }
    : { text: formatLockMoment(until) };
}
