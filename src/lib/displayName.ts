/**
 * The display-name rule (TAS-425, DESIGN.md §5.9): one check shared by My
 * profile, the invitation form (§4.27) and Admin → Users (§5.8), and the one
 * normalisation the mock answers with.
 *
 * The server's rule is common-lib `DisplayNames.normalize` (backend develop
 * `d886b031`, TAS-443), applied by profile/admin rename, invitation acceptance,
 * email signup and OAuth completion: any ISO control character, U+2028, U+2029
 * or a lone surrogate anywhere in the raw value is a 400 `INVALID_ARGUMENT`
 * with `details.reason` `DISPLAY_NAME_INVALID`; then the edges are trimmed of
 * every code point that is `Character.isWhitespace` or `Character.isSpaceChar`
 * (U+00A0 included); then 1–128 code points must be left, with at least one
 * outside that space set and Unicode FORMAT (`Cf`), or the same 400. Format
 * characters in an accepted name are preserved; the stored value is the trimmed one.
 *
 * The client checks so a reader is told before the request, never instead of
 * it: the server decides, and its 400 is printed as it came.
 */

/** The longest name the server keeps, in code points after trimming. */
export const DISPLAY_NAME_MAX_CODE_POINTS = 128;

/** The server's sentence for every refusal of the rule — what the mock answers with. */
export const DISPLAY_NAME_REFUSAL_MESSAGE =
  "Display name must contain 1 to 128 characters, a visible character, and no control characters or line breaks";

/**
 * What the server trims off the edges: the union of Java's
 * `Character.isWhitespace` (the Unicode space separators other than the three
 * no-break spaces, plus U+0009–U+000D and U+001C–U+001F) and
 * `Character.isSpaceChar` (every `Zs`, `Zl` and `Zp`, the no-break spaces
 * included) — which is `Zs`, `Zl`, `Zp`, U+0009–U+000D and U+001C–U+001F.
 *
 * Spelt by general category rather than with `String.prototype.trim`, which
 * is not the same set and differs at exactly these edges: JS trims U+FEFF,
 * which Java keeps (it is `Cf`), and keeps U+001C–U+001F, which Java trims.
 * What can still differ is the Unicode version behind the two tables — the
 * browser's against the JDK's — for a separator added in one and not the
 * other. Nothing typed into a name field reaches that, so it is named here
 * rather than modelled. Every control character in the set is refused before
 * the trim anyway, so for a name the server would accept this is `Zs` alone.
 */
const SEPARATOR = /[\p{Zs}\p{Zl}\p{Zp}]/u;

function isServerSpace(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x1f) || SEPARATOR.test(char);
}

const FORMAT = /\p{Cf}/u;

/** The server's category check, not a measurement of rendered glyphs; accepted FORMAT characters stay untouched. */
function hasNameCharacter(value: string): boolean {
  return [...value].some((char) => !isServerSpace(char) && !FORMAT.test(char));
}

/** The name with the server's edges trimmed off — what the server stores, and what every write sends. */
export function trimDisplayName(value: string): string {
  const chars = [...value];
  let start = 0;
  let end = chars.length;
  while (start < end && isServerSpace(chars[start])) start += 1;
  while (end > start && isServerSpace(chars[end - 1])) end -= 1;
  return start === 0 && end === chars.length ? value : chars.slice(start, end).join("");
}

/**
 * Anything the server refuses wherever it stands in the raw value: an ISO
 * control character (`Character.isISOControl` — C0, DEL, C1, which is `\p{Cc}`
 * exactly), the line and paragraph separators, or a lone surrogate. With the
 * `u` flag a well-formed pair is one astral code point, so the surrogate range
 * matches only a half standing alone. A tab and U+2028 survive a paste into an
 * `<input>`; CR and LF do not, the browser strips them.
 */
const REFUSED = /[\p{Cc}\u{2028}\u{2029}\u{D800}-\u{DFFF}]/u;

/**
 * Why the server would refuse this name, in the reader's words — or `null`
 * when it would not. One reason at a time, in §5.9's order: an empty name
 * first (a lone tab is empty, not a tab to remove), then a character it
 * refuses, then only spaces/FORMAT left, then the length.
 */
export function displayNameProblem(value: string): string | null {
  const trimmed = trimDisplayName(value);
  if (trimmed === "") return "Enter a name.";
  if (REFUSED.test(value)) return "Remove the tab or line break from the name.";
  if (!hasNameCharacter(trimmed)) return "Enter a name.";
  const length = [...trimmed].length;
  if (length > DISPLAY_NAME_MAX_CODE_POINTS) {
    return `Use at most ${DISPLAY_NAME_MAX_CODE_POINTS} characters. This name has ${length}.`;
  }
  return null;
}

/**
 * `DisplayNames.normalize` as the mock applies it: the trimmed name, or
 * `null` for one the server refuses with `DISPLAY_NAME_INVALID`. The control
 * check reads the raw value, before the trim, as the server's does — so a name
 * with a tab at its edge is refused rather than trimmed.
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || REFUSED.test(value)) return null;
  const trimmed = trimDisplayName(value);
  const length = [...trimmed].length;
  return length >= 1 && length <= DISPLAY_NAME_MAX_CODE_POINTS && hasNameCharacter(trimmed) ? trimmed : null;
}
