import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LOCKED_MESSAGE,
  LOCK_INSTANT_PATTERN,
  accountLockedMessage,
  accountLockedUntil,
  formatLockDeadline,
  formatLockMoment,
  formatLockTime,
} from "./accountLock";

// The measured sentence names 2026-09-22T11:55:50.398486Z, so every test that
// wants that lock to be live has to stand before it. Named rather than inlined
// because "one minute before the pinned instant" is the fact, not the number.
const BEFORE_PINNED_LOCK = Date.parse("2026-09-22T11:54:50Z");

describe("ACCOUNT_LOCKED_MESSAGE", () => {
  // The whole point of pinning it: the parser is exercised on the exact bytes
  // the gateway was measured sending, not on a paraphrase written from memory.
  // If the backend rewords and somebody updates this constant, this test is
  // what says whether the parser still copes.
  it("is what the parser reads a deadline out of", () => {
    expect(accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, BEFORE_PINNED_LOCK)?.toISOString()).toBe(
      "2026-09-22T11:55:50.398Z",
    );
  });

  // Microseconds in, milliseconds out: Instant holds six digits and Date holds
  // three, so this is a documented loss rather than a parse failure. 398486µs
  // truncates to 398ms — the deadline moves 486 microseconds earlier, which is
  // 0.0000005 of a fifteen-minute lock.
  it("loses only the sub-millisecond part of the backend's instant", () => {
    expect(ACCOUNT_LOCKED_MESSAGE).toContain("2026-09-22T11:55:50.398486Z");
    expect(accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, BEFORE_PINNED_LOCK)?.getTime()).toBe(
      Date.parse("2026-09-22T11:55:50.398Z"),
    );
  });

  // The mock has to refuse in the gateway's shape or mock mode tests a screen
  // the gateway will never produce. Compared with the instants blanked out,
  // because that is the only part the two are allowed to differ in — this goes
  // red the day somebody edits one copy of the wording and not the other.
  it("is the shape MockTaskaApi reproduces", () => {
    const shape = (sentence: string) => sentence.replace(LOCK_INSTANT_PATTERN, "<instant>");
    expect(shape(accountLockedMessage(new Date("2027-01-02T03:04:05.678Z")))).toBe(shape(ACCOUNT_LOCKED_MESSAGE));
  });
});

describe("accountLockedUntil", () => {
  // Instant.toString() emits 0, 3, 6 or 9 fractional digits depending on the
  // value, and all four reach this parser from the same backend expression. A
  // pattern built from the six-digit sample alone would miss the whole-second
  // case — about one lock in a million, and untraceable when it happened.
  it.each([
    ["six digits, as measured", "2026-09-22T11:55:50.398486Z", 398],
    ["three digits", "2026-09-22T11:55:50.398Z", 398],
    ["nine digits", "2026-09-22T11:55:50.398486123Z", 398],
    ["no fractional part at all", "2026-09-22T11:55:50Z", 0],
  ])("reads an instant with %s", (_case, instant, milliseconds) => {
    const until = accountLockedUntil(`Account is locked until ${instant}. Try again later.`, BEFORE_PINNED_LOCK);

    expect(until?.getUTCMinutes()).toBe(55);
    expect(until?.getUTCSeconds()).toBe(50);
    expect(until?.getUTCMilliseconds()).toBe(milliseconds);
  });

  // The instant is found by its own shape, never by the words around it, so
  // the backend may reword the sentence — as PR #162 did the week this was
  // written — without the reader losing the readable time.
  it("does not depend on the wording around the instant", () => {
    expect(accountLockedUntil("Заблокировано до 2026-09-22T11:55:50Z", BEFORE_PINNED_LOCK)).not.toBeNull();
    expect(accountLockedUntil("2026-09-22T11:55:50Z", BEFORE_PINNED_LOCK)).not.toBeNull();
  });

  // The arm that matters most, because its failure mode is invisible: a
  // deadline that has passed renders as a time the reader is still waiting
  // for. `null` sends the caller to the server's own sentence, which at least
  // carries its own date.
  it("refuses an instant that has already passed", () => {
    expect(accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, Date.parse("2026-09-22T12:10:00Z"))).toBeNull();
  });

  it("refuses an instant that is exactly now, because the lock is over", () => {
    expect(accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, Date.parse("2026-09-22T11:55:50.398Z"))).toBeNull();
  });

  // The pattern matches on shape, so it accepts a month and a day no calendar
  // has; Date.parse is the second gate and rejects them.
  it("refuses a well-shaped instant that is not a date", () => {
    expect(accountLockedUntil("Account is locked until 2026-13-45T11:55:50Z.", BEFORE_PINNED_LOCK)).toBeNull();
  });

  it("refuses a message with no instant in it", () => {
    expect(accountLockedUntil("Account is locked. Try again later.", BEFORE_PINNED_LOCK)).toBeNull();
    expect(accountLockedUntil("Account is locked until tomorrow.", BEFORE_PINNED_LOCK)).toBeNull();
  });

  // A refusal that carried no body at all: apiErrorFacts hands back `null` for
  // the message, and this has to be an answer rather than a throw.
  it("refuses an absent message", () => {
    expect(accountLockedUntil(null, BEFORE_PINNED_LOCK)).toBeNull();
    expect(accountLockedUntil("", BEFORE_PINNED_LOCK)).toBeNull();
  });

  // Not a fluent assertion but a real one: a `g` flag here would make every
  // second call on the same string miss, and nothing else would report it.
  it("reads the same message twice with the same answer", () => {
    const first = accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, BEFORE_PINNED_LOCK);
    const second = accountLockedUntil(ACCOUNT_LOCKED_MESSAGE, BEFORE_PINNED_LOCK);

    expect(first?.toISOString()).toBe(second?.toISOString());
  });
});

// Everything below builds its Dates from local components — `new Date(y, m, d,
// h, min)` is local time and Intl formats in local time — so the assertions
// read the same in every zone the suite might run in, without moving TZ. What
// they do assume is a locale with Latin digits and a colon, which is what a
// failure here would name rather than hide.
//
// **What a test in this process cannot assert is the zone**, and TAS-237's
// review proved it by mutation: with `formatLockTime` hard-coded to +3, all
// eighteen cases this file then held stayed green on a `TZ=Europe/Moscow`
// machine — including the one named "takes the offset from the platform rather
// than from a constant", which was the case written to catch exactly that. Only
// `TZ=UTC` failed, and only three cases did. That is not a weak assertion, it
// is arithmetic: a test running in zone Z cannot tell "formats in Z" from
// "formats in the reader's zone", because in Z the two produce the same string.
// The offset case has therefore been deleted rather than left to be trusted —
// the claim is made where the zone is a parameter, in `e2e/login-lock.spec.ts`,
// which renders one lock under `timezoneId: "Europe/Moscow"` and again under
// `"America/New_York"` and asserts the two differ. What is left here is the
// half that does hold everywhere: the shape of the string.
describe("formatLockTime", () => {
  // Zero-padded, colon-separated, no meridiem. A `hour12: true` or a missing
  // `2-digit` fails this in every zone, which is the part worth keeping.
  it("renders the clock zero-padded and 24-hour", () => {
    expect(formatLockTime(new Date(2026, 8, 22, 14, 55))).toBe("14:55");
    expect(formatLockTime(new Date(2026, 8, 22, 9, 5))).toBe("09:05");
  });

  // What `hourCycle: "h23"` buys over `hour12: false`, which renders this hour
  // as 24:10 in several locales.
  it("renders the hour after midnight as 00, not 24", () => {
    expect(formatLockTime(new Date(2026, 8, 23, 0, 10))).toBe("00:10");
  });
});

describe("formatLockMoment", () => {
  // Everything the short form drops, and the case it is dropped for: a lock
  // started at 23:55 ends on the next day, where "00:10" alone reads as a time
  // that has already gone.
  it("carries the date and the zone the short form drops", () => {
    const until = new Date(2026, 8, 23, 0, 10);
    const moment = formatLockMoment(until);

    expect(moment).toContain("Sep 23");
    expect(moment).toContain("00:10");
    // Derived, not spelled. This assertion used to read `/GMT|UTC/`, which is
    // the same defect as the deleted case wearing the other face: en-US names
    // Moscow "GMT+3" and New York "EDT", so it passed where it was written and
    // failed on a correct implementation in New York. What is portable is that
    // the string carries whatever *this* platform calls its own zone.
    expect(platformZone(until)).not.toBe("");
    expect(moment).toContain(platformZone(until));
  });
});

/** Whatever the runner's own zone is called here, e.g. `GMT+3`, `EDT`, `UTC`. */
function platformZone(at: Date) {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(at)
    .filter((part) => part.type === "timeZoneName")
    .map((part) => part.value)
    .join("");
}

// The `title` was the whole answer to a lock that crosses midnight until
// TAS-237's review read it on a phone, where there is no hover, a `<time>`
// takes no focus, and the attribute is therefore reachable by no route at all.
// These pin which form the reader gets and what is left for `title`.
//
// What none of them can catch, said here rather than left to be found again: a
// comparison made on the UTC day instead of the local one. Both instants in
// each case are built from local components, so whether their UTC days differ
// is a fact about the runner's zone — under `TZ=UTC` a UTC comparison answers
// identically and every case below stays green. The pair that separates the
// two — 23:50 and 00:05 in Moscow, one single UTC day — is pinned in
// `e2e/login-lock.spec.ts`, with the browser's clock and zone both fixed. Same
// lesson as the deleted offset case, one function along.
describe("formatLockDeadline", () => {
  it("shows the clock alone while the lock ends on the reader's own day", () => {
    const now = new Date(2026, 8, 22, 14, 40);
    const until = new Date(2026, 8, 22, 14, 55);

    // The title is compared against the formatter rather than against a
    // spelled-out "Sep 22, 14:55 GMT+3", which would be an assertion about the
    // runner's zone again. `formatLockMoment` has its own case above.
    expect(formatLockDeadline(until, now)).toStrictEqual({ text: "14:55", title: formatLockMoment(until) });
  });

  // The case the review found: a fifteen-minute lock started at 23:50 ends
  // tomorrow, and `00:05` alone reads as a moment that has already passed.
  it("moves the date into the text once the lock runs past the reader's midnight", () => {
    const now = new Date(2026, 8, 22, 23, 50);
    const until = new Date(2026, 8, 23, 0, 5);
    const { text } = formatLockDeadline(until, now);

    expect(text).toContain("Sep 23");
    expect(text).toContain("00:05");
  });

  // And `title` goes away with it: repeating the element's own text is a
  // tooltip that says what is on screen and a description a reader may hear
  // twice.
  it("leaves no title once the text carries the whole moment", () => {
    const now = new Date(2026, 8, 22, 23, 50);
    const until = new Date(2026, 8, 23, 0, 5);

    expect(formatLockDeadline(until, now)).toStrictEqual({ text: formatLockMoment(until) });
  });

  // The branch is on the calendar day and not on how far off the deadline is,
  // so four minutes across midnight take the date and thirteen hours inside one
  // day do not.
  it("decides on the calendar day rather than on the distance to the deadline", () => {
    const beforeMidnight = new Date(2026, 8, 22, 23, 58);
    const justAfter = new Date(2026, 8, 23, 0, 2);
    const muchLaterSameDay = new Date(2026, 8, 22, 23, 59);

    expect(formatLockDeadline(justAfter, beforeMidnight).text).toContain("Sep 23");
    expect(formatLockDeadline(muchLaterSameDay, new Date(2026, 8, 22, 11, 0)).text).toBe("23:59");
  });
});
