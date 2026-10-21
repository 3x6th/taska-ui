import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialTheme, THEME_STORAGE_KEY } from "../hooks/useTheme";
import {
  boardColumnsPreference,
  currentPreference,
  issueDetailsPreference,
  setPreference,
  storedPreference,
  subscribePreferences,
} from "./readerPrefs";

const root = document.documentElement;

const clearAttributes = () => {
  root.removeAttribute("data-theme");
  root.removeAttribute("data-issue-details");
  root.removeAttribute("data-board-columns");
};

/** Storage that refuses every call, as private mode or a policy can. */
const refuseStorage = () => {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
};

beforeEach(() => {
  window.localStorage.clear();
  clearAttributes();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  clearAttributes();
});

describe("the reader's appearance preferences", () => {
  it("default to the side panel and left-aligned columns", () => {
    expect(storedPreference(issueDetailsPreference)).toBe("side");
    expect(storedPreference(boardColumnsPreference)).toBe("left");
    expect(currentPreference(issueDetailsPreference)).toBe("side");
    expect(currentPreference(boardColumnsPreference)).toBe("left");
  });

  it("read a stored choice, and treat a value they do not know as the default", () => {
    window.localStorage.setItem("taska.issueDetails", "centered");
    window.localStorage.setItem("taska.boardColumns", "centered");
    expect(storedPreference(issueDetailsPreference)).toBe("centered");
    expect(storedPreference(boardColumnsPreference)).toBe("centered");

    window.localStorage.setItem("taska.issueDetails", "floating");
    window.localStorage.setItem("taska.boardColumns", "right");
    expect(storedPreference(issueDetailsPreference)).toBe("side");
    expect(storedPreference(boardColumnsPreference)).toBe("left");

    // An attribute somebody else wrote is read on the same terms.
    root.dataset.issueDetails = "modal";
    expect(currentPreference(issueDetailsPreference)).toBe("side");
  });

  it("apply a choice on <html> at once, remember it, and tell their subscribers", () => {
    const heard = vi.fn();
    const unsubscribe = subscribePreferences(heard);

    setPreference(issueDetailsPreference, "centered");
    setPreference(boardColumnsPreference, "centered");

    expect(root.dataset.issueDetails).toBe("centered");
    expect(root.dataset.boardColumns).toBe("centered");
    expect(window.localStorage.getItem("taska.issueDetails")).toBe("centered");
    expect(window.localStorage.getItem("taska.boardColumns")).toBe("centered");
    expect(currentPreference(issueDetailsPreference)).toBe("centered");
    expect(heard).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("survive storage that throws: the default on read, and the choice still applied on write", () => {
    refuseStorage();

    expect(storedPreference(issueDetailsPreference)).toBe("side");
    expect(() => setPreference(issueDetailsPreference, "centered")).not.toThrow();
    // Not remembered — and still in force for this page, because the
    // attribute is where the page reads it.
    expect(root.dataset.issueDetails).toBe("centered");
    expect(currentPreference(issueDetailsPreference)).toBe("centered");
    // The theme's reader is guarded the same way: no stored choice, so the
    // system's (jsdom's stub reports none, which is light).
    expect(initialTheme()).toBe("light");
  });
});

/**
 * The inline script in index.html applies all three before the first paint
 * (ruling 2, TAS-380). It cannot import the modules above, so it repeats their
 * keys and defaults; this runs it, as the browser would, against every case
 * they cover — and fails the day one of the two copies moves without the other.
 */
describe("the inline script in index.html", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  const inline = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => body);

  const runScript = () => {
    expect(inline).toHaveLength(1);
    new Function(inline[0])();
  };

  it("sits in <head>, before the stylesheets and the app", () => {
    expect(head.indexOf("<script>")).toBeGreaterThan(-1);
    expect(head.indexOf("<script>")).toBeLessThan(head.indexOf("<link"));
  });

  it.each([
    [{}, { theme: "light", issueDetails: "side", boardColumns: "left" }],
    [
      { [THEME_STORAGE_KEY]: "dark", "taska.issueDetails": "centered", "taska.boardColumns": "centered" },
      { theme: "dark", issueDetails: "centered", boardColumns: "centered" },
    ],
    [
      { [THEME_STORAGE_KEY]: "sepia", "taska.issueDetails": "floating", "taska.boardColumns": "right" },
      { theme: "light", issueDetails: "side", boardColumns: "left" },
    ],
  ])("puts what the modules would read on <html> (%o)", (stored, expected) => {
    Object.entries(stored).forEach(([key, value]) => window.localStorage.setItem(key, value));
    runScript();
    expect(root.dataset.theme).toBe(expected.theme);
    expect(root.dataset.issueDetails).toBe(expected.issueDetails);
    expect(root.dataset.boardColumns).toBe(expected.boardColumns);
    // And the modules agree with it.
    expect(initialTheme()).toBe(expected.theme);
    expect(storedPreference(issueDetailsPreference)).toBe(expected.issueDetails);
    expect(storedPreference(boardColumnsPreference)).toBe(expected.boardColumns);
  });

  it("follows the system's dark preference on a first visit", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(prefers-color-scheme: dark)", media: query }) as MediaQueryList,
    );
    runScript();
    expect(root.dataset.theme).toBe("dark");
    expect(initialTheme()).toBe("dark");
  });

  it("still sets every attribute when storage throws", () => {
    refuseStorage();
    expect(runScript).not.toThrow();
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.issueDetails).toBe("side");
    expect(root.dataset.boardColumns).toBe("left");
  });
});
