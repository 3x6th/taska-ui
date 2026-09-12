/**
 * One colour out of a short row of them, picked by clicking a round swatch.
 *
 * Two things in this product choose a colour this way — a project's label
 * (TAS-169) and the project itself (TAS-148) — and they are the same control,
 * not two that look alike: same set of hexes, same single choice, same ring for
 * the checked state. DESIGN.md §8 asks for a prop rather than a second variant,
 * so the differences between the two are data. The project's picker passes one
 * extra option whose value is `null` ("Automatic", meaning the project states
 * no colour of its own and the client computes one), and marks it `disabled`
 * once the server holds a colour, because the contract has no way to take one
 * back.
 *
 * A group of `aria-pressed` buttons rather than an ARIA radio group. `role=
 * "radio"` would announce a keyboard contract this does not implement — arrow
 * keys moving the selection inside a single tab stop — and a promise of an
 * interaction nobody wrote is worse than the plainer control that behaves as it
 * reads.
 *
 * The ring on the active swatch is not decoration: a checked state expressed
 * only by colour would be unreadable to exactly the people DESIGN.md §4.6
 * exists for. Every swatch carries a text `aria-label` for the same reason.
 */
export interface ColorChoice {
  /**
   * What picking this swatch means to the caller. `null` is a real answer —
   * "no colour of its own" — and not an absence of one.
   */
  value: string | null;
  /** The hex the swatch is painted with. For `null` that is the computed colour. */
  swatch: string;
  /** The swatch's accessible name. A colour alone is not a name (§7). */
  label: string;
  /**
   * Offered but refused, with the reason in text beside the group. A real
   * `disabled`, so it carries DESIGN.md §4.1's recipe rather than only the
   * `aria-disabled` §7 already records as a gap elsewhere.
   */
  disabled?: boolean;
}

export function ColorSwatches({
  choices,
  describedBy,
  groupLabel,
  onPick,
  selected,
}: {
  choices: ColorChoice[];
  /** The id of the line explaining a refusal, announced on entering the group. */
  describedBy?: string;
  groupLabel: string;
  onPick: (value: string | null) => void;
  selected: string | null;
}) {
  return (
    <div aria-describedby={describedBy} aria-label={groupLabel} className="color-swatches" role="group">
      {choices.map((choice) => (
        <button
          aria-label={choice.label}
          aria-pressed={selected === choice.value}
          // `is-automatic` draws a dashed inner ring, which is the only thing
          // telling this swatch apart from a plain colour: it is painted with
          // the colour the project is *computing*, so on a project whose key
          // happens to hash to one of the eight, two swatches in this row wear
          // the same hue and mean different things. Dashed is what §4.4 already
          // uses for "nobody chose this" on the unassigned avatar, and it
          // survives greyscale, which the colour cannot (§7).
          className={`color-swatch ${choice.value === null ? "is-automatic" : ""} ${
            selected === choice.value ? "is-active" : ""
          }`}
          disabled={choice.disabled}
          key={choice.value ?? "automatic"}
          onClick={() => onPick(choice.value)}
          style={{ background: choice.swatch }}
          title={choice.label}
          type="button"
        />
      ))}
    </div>
  );
}
