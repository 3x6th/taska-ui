import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferencesPatch, User } from "../../domain/types";
import { MockNotificationPreferences } from "./MockNotificationPreferences";

const anna = { id: "anna", email: "anna@example.com" } as User;
const tom = { id: "tom", email: "tom@example.com" } as User;

describe("current-user delivery preferences", () => {
  let store: MockNotificationPreferences;
  beforeEach(() => {
    store = new MockNotificationPreferences();
    vi.useRealTimers();
  });

  it("starts email-only, supports all four combinations and never changes the other channel", () => {
    expect(store.get(anna)).toMatchObject({ emailEnabled: true, telegramEnabled: false });
    const link = store.createLink(anna);
    expect(() => store.confirm(anna, link.linkId)).toThrow();
    store.receiveStart(anna, link.linkId, "Anna", "anna_tg");
    expect(store.get(anna).telegramEnabled).toBe(false);
    expect(store.confirm(anna, link.linkId)).toMatchObject({ emailEnabled: true, telegramEnabled: true });
    expect(store.update(anna, { emailEnabled: false })).toMatchObject({ emailEnabled: false, telegramEnabled: true });
    expect(store.update(anna, { telegramEnabled: false })).toMatchObject({
      emailEnabled: false,
      telegramEnabled: false,
      telegramStatus: "CONNECTED",
    });
    expect(store.update(anna, { emailEnabled: true })).toMatchObject({ emailEnabled: true, telegramEnabled: false });
  });

  it("answers a new link with the row as it stands after the link was issued (TelegramLinkDto.preferences)", () => {
    const link = store.createLink(anna);
    expect(link.preferences).toEqual(store.get(anna));
    expect(link.preferences).toMatchObject({ telegramStatus: "PENDING", telegramLinkId: link.linkId });
  });

  it("keeps links and preferences per user and rejects a different user's link", () => {
    const link = store.createLink(anna);
    store.receiveStart(anna, link.linkId, "Anna", null);
    expect(() => store.confirm(tom, link.linkId)).toThrow();
    store.update(anna, { emailEnabled: false });
    expect(store.get(tom)).toMatchObject({ emailEnabled: true, telegramStatus: "NOT_CONNECTED" });
    expect(store.confirm(anna, link.linkId)).toMatchObject({
      emailEnabled: false,
      telegramEnabled: true,
      telegramUsername: null,
    });
  });

  it("replaces a pending link, expires the candidate, and cannot confirm stale links", () => {
    vi.useFakeTimers();
    const old = store.createLink(anna);
    const fresh = store.createLink(anna);
    expect(() => store.receiveStart(anna, old.linkId, "Wrong", null)).toThrow();
    store.receiveStart(anna, fresh.linkId, "Anna", null);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(store.get(anna)).toMatchObject({
      telegramStatus: "NOT_CONNECTED",
      telegramName: null,
      telegramEnabled: false,
    });
    expect(() => store.confirm(anna, fresh.linkId)).toThrow();
    vi.useRealTimers();
  });

  it("disconnect and /stop remove the binding while preserving the email choice", () => {
    store.update(anna, { emailEnabled: false });
    const link = store.createLink(anna);
    store.receiveStart(anna, link.linkId, "Anna", "anna");
    store.confirm(anna, link.linkId);
    store.stop(anna);
    expect(store.get(anna)).toMatchObject({
      emailEnabled: false,
      telegramEnabled: false,
      telegramStatus: "NOT_CONNECTED",
      telegramUsername: null,
    });
    expect(() => store.confirm(anna, link.linkId)).toThrow();
    expect(store.disconnect(anna).telegramStatus).toBe("NOT_CONNECTED");
  });

  it("rejects enabling an unbound or unavailable channel and invalid patches", () => {
    expect(() => store.update(anna, { telegramEnabled: true })).toThrow();
    for (const input of [{}, { emailEnabled: null }, { unknown: true }]) {
      expect(() => store.update(anna, input as NotificationPreferencesPatch)).toThrow();
    }
    store.available = false;
    expect(store.get(anna)).toMatchObject({ telegramAvailable: false, telegramStatus: "NOT_CONNECTED" });
    const unavailable = expect.objectContaining({ code: "UNAVAILABLE" });
    expect(() => store.createLink(anna)).toThrowError(unavailable);
    expect(() => store.confirm(anna, "any-link")).toThrowError(unavailable);
    expect(() => store.update(anna, { telegramEnabled: true })).toThrow();
    expect(store.update(anna, { emailEnabled: false }).emailEnabled).toBe(false);
  });
});
