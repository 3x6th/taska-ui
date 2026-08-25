/**
 * **This section is UTC** (DESIGN.md §5.8). `datetime-local` has no offset of
 * its own, so something has to say which clock its digits are on, and the only
 * defensible answer here is the one the table prints: the server's, `Z`.
 * Reading the field as local wall time meant an admin looking at
 * `2026-09-10T08:00:00Z` typed 08:00 and filtered from 05:00Z, with both
 * spellings on screen 20px apart.
 *
 * So these two never touch the local timezone in either direction, and they are
 * exact inverses of each other. They stay forgiving in one direction only: an
 * unreadable stored value opens the picker empty rather than throwing, while an
 * empty picker produces an empty value every caller already treats as "no
 * filter".
 *
 * Shared by both filter forms in this area — the Data section's column filter
 * and the Events journal's named ones. One copy on purpose: two copies of a
 * timezone rule is two chances for the digits in the field and the digits on
 * the wire to part company, which is the exact bug this rule exists to prevent.
 */
export function toPickerValue(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return `${date}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

export function toIsoValue(local: string): string {
  if (!local) return "";
  // The `Z` is the whole point: it makes the digits in the field the digits on
  // the wire, whatever the reader's own clock says.
  const at = new Date(`${local}Z`);
  if (Number.isNaN(at.getTime())) return "";
  // Without milliseconds (§5.8): the server does not need them, and `.000` eats
  // a quarter of the chip's width.
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
