import { afterEach, describe, expect, it, vi } from "vitest";
import { OBJECT_URL_REVOKE_DELAY_MS, closeTab, openBlankTab, saveBlob, sendTabTo } from "./browserFiles";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("openBlankTab", () => {
  it("opens a blank tab with no feature string and cuts its way back to this page", () => {
    const tab = { opener: window as Window | null };
    const open = vi.fn((..._args: unknown[]) => tab as unknown as Window);
    vi.stubGlobal("open", open);

    expect(openBlankTab()).toBe(tab);
    // `noopener` in the features would make the answer `null` by spec, and
    // every tab that opened would read as blocked (TAS-253).
    expect(open.mock.calls[0]).toEqual(["", "_blank"]);
    expect(tab.opener).toBeNull();
  });

  it("answers null only when the browser refused the tab", () => {
    vi.stubGlobal("open", vi.fn(() => null));
    expect(openBlankTab()).toBeNull();
  });
});

describe("sendTabTo", () => {
  it("replaces the blank page with the link", () => {
    const replace = vi.fn();
    expect(sendTabTo({ closed: false, location: { replace } } as unknown as Window, "https://store.example/a")).toBe(true);
    expect(replace).toHaveBeenCalledWith("https://store.example/a");
  });

  it("says so when the reader closed the tab while the link was being signed", () => {
    const replace = vi.fn();
    expect(sendTabTo({ closed: true, location: { replace } } as unknown as Window, "https://store.example/a")).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("closes without throwing, whatever state the tab is in", () => {
    expect(() => closeTab(null)).not.toThrow();
    expect(() =>
      closeTab({
        close: () => {
          throw new Error("gone");
        },
      } as unknown as Window),
    ).not.toThrow();
  });
});

describe("saveBlob", () => {
  it("clicks a temporary download anchor named for the file, then lets the object URL go", () => {
    vi.useFakeTimers();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:taska/42");
    URL.revokeObjectURL = revoke;
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });

    try {
      saveBlob(new Blob(["x"], { type: "text/html" }), "report.html");

      // Attached for the click (Firefox ignores a detached one), gone after.
      expect(clicked).toEqual([{ href: "blob:taska/42", download: "report.html", attached: true }]);
      expect(document.querySelector("a[download]")).toBeNull();
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS);
      expect(revoke).toHaveBeenCalledWith("blob:taska/42");
    } finally {
      Object.assign(URL, original);
    }
  });
});
