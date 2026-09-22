import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LOCKED_MESSAGE,
  LOCK_INSTANT_PATTERN,
  accountLockedMessage,
  accountLockedUntil,
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

// These build their Dates from local components — `new Date(y, m, d, h, min)`
// is local time and Intl formats in local time — so they assert the same
// string in every zone the suite might run in, without moving TZ. What they do
// assume is a locale with Latin digits and a colon, which is what a failure
// here would name rather than hide.
describe("formatLockTime", () => {
  it("renders the reader's own clock, zero-padded and 24-hour", () => {
    expect(formatLockTime(new Date(2026, 8, 22, 14, 55))).toBe("14:55");
    expect(formatLockTime(new Date(2026, 8, 22, 9, 5))).toBe("09:05");
  });

  // What `hourCycle: "h23"` buys over `hour12: false`, which renders this hour
  // as 24:10 in several locales.
  it("renders the hour after midnight as 00, not 24", () => {
    expect(formatLockTime(new Date(2026, 8, 23, 0, 10))).toBe("00:10");
  });

  // The reporter reads UTC+3 and the story's example adds three hours. Adding
  // three hours in code would be right for them and wrong for everyone else,
  // so the offset comes from the platform: a UTC instant and the local clock
  // agree only where the two agree.
  it("takes the offset from the platform rather than from a constant", () => {
    const instant = new Date(Date.UTC(2026, 8, 22, 11, 55));
    const local = `${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}`;

    expect(formatLockTime(instant)).toBe(local);
  });
});

describe("formatLockMoment", () => {
  // The `title`, and the case it exists for: a lock started at 23:55 ends on
  // the next day, where "00:10" alone reads as a time that has already gone.
  it("carries the date and the zone the short form drops", () => {
    const moment = formatLockMoment(new Date(2026, 8, 23, 0, 10));

    expect(moment).toContain("Sep 23");
    expect(moment).toContain("00:10");
    expect(moment).toMatch(/GMT|UTC/);
  });
});
