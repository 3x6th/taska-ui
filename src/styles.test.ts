import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read from disk rather than imported: Vitest hands a `.css` import — `?raw`
// included — to its CSS pipeline, which answers an empty string unless CSS
// processing is switched on for the whole suite. From the project root, where
// the suite runs; under jsdom `import.meta.url` is not a file URL.
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/**
 * Every rule in the stylesheet as its selector list and its declarations, with
 * comments taken out first — a comment may quote a rule. A rule nested in an
 * at-rule (`@media`) is found the same way: only the innermost `{…}` holds
 * declarations, and the pattern matches nothing that contains a brace.
 */
function rules(css: string): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
}

/**
 * DESIGN.md §7 since TAS-299: one focus ring for the product, declared once at
 * zero specificity, with the exceptions §7 records winning by weight. The
 * Tab-walk itself is `e2e/focus-ring.spec.ts`; this is the part a stylesheet
 * can be checked for without a browser.
 */
describe("the focus ring in styles.css", () => {
  it("is never switched off by a rule written for :focus-visible", () => {
    // Not vacuous: the sheet holds dozens of these.
    expect(rules(styles).filter(({ selector }) => selector.includes(":focus-visible")).length).toBeGreaterThan(20);
    const offenders = rules(styles)
      .filter(({ selector }) => selector.includes(":focus-visible"))
      .filter(({ body }) => /(^|[;\s])outline\s*:\s*(0|none)\s*(;|$)/m.test(body))
      .map(({ selector }) => selector);

    expect(offenders).toEqual([]);
  });

  it("is declared once for everything interactive, at zero specificity, before the exceptions", () => {
    const all = rules(styles);
    const global = all.findIndex(({ selector }) => selector.startsWith(":where(") && selector.endsWith(":focus-visible"));
    expect(global).toBeGreaterThan(-1);
    const { selector, body } = all[global];
    for (const target of [
      "a[href]",
      "button",
      "select",
      "summary",
      "[tabindex]",
      'input[type="checkbox"]',
      'input[type="radio"]',
      "input:read-only",
      "textarea:read-only",
    ]) {
      expect(selector).toContain(target);
    }
    expect(body).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(body).toMatch(/outline-offset:\s*2px/);

    // The recorded exceptions come after it, so a reader finds the rule first.
    for (const [exception, offset] of [
      [".segmented button:focus-visible", "0"],
      [".issue-card:focus-visible", "-2px"],
      [".avatar-filter.is-active:focus-visible", "4px"],
    ]) {
      const at = all.findIndex((rule) => rule.selector === exception);
      expect(at, exception).toBeGreaterThan(global);
      expect(all[at].body).toMatch(new RegExp(`outline-offset:\\s*${offset.replace("-", "\\-")}\\s*;`));
    }
  });

  it("takes Chrome's ring off a date field's calendar button by the pseudo-element itself", () => {
    // The e2e walk cannot read a pseudo-element's style, so this is where the
    // rule is held. `:focus` does not apply to `::-webkit-calendar-picker-indicator`,
    // so a selector keyed on it matches nothing (art-director, TAS-299 round 1).
    const all = rules(styles);
    expect(all.filter(({ selector }) => selector.includes("::-webkit-calendar-picker-indicator:focus"))).toEqual([]);
    const button = all.find(({ selector }) =>
      selector.split(",").some((part) => part.trim() === "input::-webkit-calendar-picker-indicator"),
    );
    expect(button?.body).toMatch(/(^|[;\s])outline\s*:\s*none\s*(;|$)/m);
  });

  it("keeps the field focus rule off read-only fields, whose ring it would otherwise erase", () => {
    const field = rules(styles).find(({ selector }) => selector.includes(".summary-textarea:focus"));
    expect(field?.selector.split(",").map((part) => part.trim())).toEqual([
      ".field input:focus:not(:read-only)",
      ".field textarea:focus:not(:read-only)",
      ".description-field textarea:focus:not(:read-only)",
      ".member-search-input:focus:not(:read-only)",
      ".summary-textarea:focus:not(:read-only)",
    ]);
  });
});
