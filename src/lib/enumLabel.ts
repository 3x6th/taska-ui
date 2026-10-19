import type { DictionaryEntry } from "../domain/types";

/**
 * The words this build has for the codes it knows — one table per dictionary,
 * all in `src/lib/format.ts`. A `Partial<Record<string, …>>` rather than a
 * record keyed by the union, because the code being looked up is whatever the
 * server sent, and a lookup keyed by the union is exactly the index that threw
 * on a code it did not list (TAS-173).
 */
export type KnownLabels = Readonly<Partial<Record<string, string>>>;

/**
 * Whether a name may be printed in this English UI: not blank, and no Cyrillic
 * in it. A Russian word in the middle of an English screen reads as a fault
 * rather than as a label, so such a name is passed over and the code is printed
 * as it came.
 *
 * **Permanent** (DESIGN.md §6, the owner's ruling of 2026-10-19). `/meta` has
 * named every value in English since backend #201 (TAS-264), so for its names
 * the check now simply passes; it stays as the guard that keeps the UI English
 * if a Russian name is ever served again. Its other use was never about
 * `/meta`: `statusLabel` (src/lib/format.ts) reads a *workflow's* status name
 * through this, and that name is project configuration an admin may write in
 * any language.
 */
export function isEnglishName(name: string): boolean {
  return name.trim() !== "" && !/\p{Script=Cyrillic}/u.test(name);
}

/** The served name for exactly this code, when there is one this UI may print. */
function servedName(code: string, served: readonly DictionaryEntry[] | null | undefined): string | null {
  const entry = served?.find((item) => item.code === code);
  return entry && isEnglishName(entry.name) ? entry.name.trim() : null;
}

/**
 * The one rule every dictionary is printed by (TAS-173, the owner's ruling of
 * 2026-10-19):
 *
 * - a code this build knows → the build's own English label;
 * - a code it does not → the `/meta` name, when it has no Cyrillic in it;
 * - otherwise → the code verbatim, exactly as received.
 *
 * A blank or missing code is `empty`. Never throws and never answers `""`: an
 * unknown value is drawn as itself rather than taking the screen down or
 * leaving a hole. `Object.hasOwn`, so a code spelled `constructor` is a code
 * like any other and not a member of `Object.prototype`.
 */
export function enumLabel(
  code: string | null | undefined,
  known: KnownLabels,
  served?: readonly DictionaryEntry[] | null,
  empty = "—",
): string {
  if (typeof code !== "string" || code.trim() === "") return empty;
  if (Object.hasOwn(known, code)) return known[code] ?? code;
  return servedName(code, served) ?? code;
}

/**
 * The same label for running text. Only the build's own words are lowercased
 * ("no workflow for bug issues"); a served name or a verbatim code is printed as
 * received ("no workflow for EPIC issues"), because lowercasing a code turns it
 * into a word nobody sent.
 */
export function enumLabelInSentence(
  code: string | null | undefined,
  known: KnownLabels,
  served?: readonly DictionaryEntry[] | null,
  empty = "—",
): string {
  if (typeof code === "string" && Object.hasOwn(known, code)) return (known[code] ?? code).toLowerCase();
  return enumLabel(code, known, served, empty);
}

/**
 * The values a picker offers (art-director's ruling 5, TAS-173). With a served
 * dictionary: the codes this build knows first, in the build's own order, then
 * the ones it does not, in the order the server listed them — so `/meta` can
 * only add segments at the end and a known value never moves. A known code the
 * dictionary leaves out leaves the set. With no dictionary — still loading,
 * failed, or answered without this one — the build's own set, at once, with no
 * notice (D5): the picker works the way it always did.
 *
 * Which served entries a picker may offer is the server's to say since backend
 * #201: `selectable: false` marks its placeholders — `UNKNOWN`, `UNSPECIFIED`,
 * `UNRECOGNIZED` — and is the whole of the filter. This used to be a list of
 * those three codes kept here, which was a hard-coded enum list standing in for
 * a fact the server now states.
 */
export function selectableCodes(served: readonly DictionaryEntry[] | null | undefined, buildOrder: readonly string[]): string[] {
  const listed = (served ?? []).filter((entry) => entry.selectable !== false).map((entry) => entry.code);
  if (!listed.length) return [...buildOrder];
  return [...buildOrder.filter((code) => listed.includes(code)), ...listed.filter((code) => !buildOrder.includes(code))];
}
