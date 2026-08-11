import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AdminFilter, AdminFilterOperator } from "../../domain/types";
import type { AdminValueControl } from "./columns";
import { operatorsForType, supportsOperator, valueControlForType } from "./columns";
import { operatorLabels } from "./urlState";

interface AdminFilterControlProps {
  /** Filterable, non-sensitive columns of the table on screen. */
  columns: string[];
  /** The catalog's type for a column, which is what decides the operators. */
  typeOf: (column: string) => string | undefined;
  filter: AdminFilter | null;
  onChange: (filter: AdminFilter | null) => void;
  /**
   * True while the rows on screen belong to a different table than the one
   * selected: the form still describes the table being left.
   */
  switching: boolean;
}

/**
 * The Data section's filter (DESIGN.md §5.8): a chip that opens a popover with
 * column / match / value, and the applied filter shown as a chip with a cross.
 *
 * It replaces the row of three labelled selects that used to sit here. That row
 * took a screen-wide band for one filter — and one filter is all the contract
 * offers.
 */
export function AdminFilterControl({ columns, typeOf, filter, onChange, switching }: AdminFilterControlProps) {
  const fieldId = useId();
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdminFilter>({ column: "", operator: "equals", value: "" });
  // Removing a filter unmounts the cross that was clicked, and with it the
  // focus — the keyboard would land on <body> (§7). The chip becomes the
  // "+ Filter" button in the same place, so focus goes there once it exists.
  // A ref, not state: this is a note to the next commit, and nothing renders
  // differently because of it.
  const returnFocusRef = useRef(false);

  useEffect(() => {
    // Waits for the render where the filter is actually gone: removing it goes
    // through the URL, which lands a commit later than the click, and focusing
    // before that would land on the chip that is about to disappear.
    if (!returnFocusRef.current || filter) return;
    returnFocusRef.current = false;
    triggerRef.current?.focus();
  }, [filter]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // The gateway checks the operator against the column's type itself and
  // answers 400, so an operator this column cannot take is not a bad
  // suggestion — it is a request that cannot succeed. The catalog states the
  // type; `operatorsForType` states what the server will accept for it.
  const draftColumnType = typeOf(draft.column);
  const operators = operatorsForType(draftColumnType);
  // And the value is constrained the same way and for the same reason: the
  // gateway parses it against the column's type (`new BigDecimal`, `true`/
  // `false`, `OffsetDateTime.parse`) and answers 400 when it cannot. §5.8: the
  // format is the form's job, not something the admin is expected to remember.
  const control = valueControlForType(draftColumnType);

  const openPopover = () => {
    if (!filter) {
      setDraft({ column: "", operator: "equals", value: "" });
    } else {
      // While the popover is open the draft holds what the *fields* hold, so a
      // temporal filter comes back out of the URL as the picker's own spelling
      // and returns to ISO on Apply. Converting on every keystroke instead
      // would fight the picker: a half-typed date parses to nothing, and a
      // controlled field reset to "" mid-entry cannot be typed into.
      const type = typeOf(filter.column);
      setDraft({
        ...filter,
        // A hand-edited address can name an operator this column cannot take.
        // The form must not state it as if applying it were possible — now that
        // a single legal operator is printed rather than selected, that would
        // be the form asserting something the gateway answers 400 to.
        operator: supportsOperator(type, filter.operator) ? filter.operator : "equals",
        value: toFieldValue(valueControlForType(type), filter.value),
      });
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // The chip says the whole filter, and the value on it is whatever was typed.
  // It is truncated by width, so it goes into `title` as well — §5.8 applies the
  // table key's rule here: a truncation the value cannot be read back out of is
  // lost data, not saved space.
  const chipLabel = filter ? `${filter.column} ${operatorLabels[filter.operator]} ${filter.value}` : "";

  return (
    <div className="admin-filter" ref={rootRef}>
      {filter ? (
        <span className="admin-filter-chip">
          <button
            aria-controls={open ? popoverId : undefined}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="admin-filter-chip-open"
            onClick={() => (open ? close() : openPopover())}
            ref={triggerRef}
            title={chipLabel}
            type="button"
          >
            <span className="admin-filter-chip-text">{chipLabel}</span>
          </button>
          <button
            aria-label={`Remove filter on ${filter.column}`}
            className="admin-filter-chip-remove"
            onClick={() => {
              returnFocusRef.current = true;
              onChange(null);
            }}
            type="button"
          >
            <X aria-hidden="true" size={13} />
          </button>
        </span>
      ) : (
        <button
          aria-controls={open ? popoverId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="admin-filter-add"
          onClick={() => (open ? close() : openPopover())}
          ref={triggerRef}
          type="button"
        >
          <Plus aria-hidden="true" size={13} />
          Filter
        </button>
      )}

      {open ? (
        <section aria-label="Filter rows" className="admin-filter-popover" id={popoverId} role="dialog">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              // The picker's UTC digits become the offset-bearing ISO string the
              // gateway parses, here and nowhere else.
              const value = control === "datetime" ? toIsoValue(draft.value) : draft.value;
              // A blank value is not a filter (§5.8). Keeping it produced a chip
              // that read as applied over an unfiltered table, and an empty
              // result that said "No rows match this filter" — and the picker
              // makes "open it, pick nothing, Apply" an easy gesture.
              onChange(draft.column && value !== "" ? { ...draft, value } : null);
              close();
            }}
            // Mid-switch the form still describes the table on screen while the
            // selection has already moved on, so applying it would send one
            // table's column against another's rows.
            inert={switching || undefined}
          >
            {/* Explicitly associated rather than wrapping: a <label> that wraps
                a <select> takes every option's text into its accessible name, so
                the control announces "Column None id email …". */}
            <label htmlFor={`${fieldId}-column`}>
              <span>Column</span>
            </label>
            <select
              id={`${fieldId}-column`}
              onChange={(event) => {
                const column = event.target.value;
                const type = typeOf(column);
                // Any operator can be stranded by a change of column, not only
                // a range one: `contains` is text-only and `from`/`to` need a
                // temporal or numeric column. A stranded operator would leave
                // the select showing a blank — its option is gone — and would
                // send a filter the gateway answers 400 to. `equals` is valid
                // for every type, so it is where a stranded one lands.
                const operator = supportsOperator(type, draft.operator) ? draft.operator : "equals";
                // The value survives a change of column — it is the one thing
                // here the reader typed — but only while the control stays the
                // same. Across a control boundary the two fields cannot hold
                // each other's spelling: a date picker has nothing to show for
                // `anna@`, a number field nothing for a uuid, and a true/false
                // choice nothing for either.
                const next = valueControlForType(type);
                const value = next === control ? draft.value : emptyValueFor(next);
                setDraft({ column, operator, value });
              }}
              value={draft.column}
            >
              <option value="">None</option>
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>

            {/* A select with one option is a control that cannot change
                anything, and `uuid`, `inet` and `boolean` columns all have
                exactly one legal operator. §5.8: state it instead. */}
            {operators.length > 1 ? (
              <>
                <label htmlFor={`${fieldId}-match`}>
                  <span>Match</span>
                </label>
                <select
                  id={`${fieldId}-match`}
                  onChange={(event) => setDraft({ ...draft, operator: event.target.value as AdminFilterOperator })}
                  value={draft.operator}
                >
                  {operators.map((operator) => (
                    <option key={operator} value={operator}>
                      {operatorLabels[operator]}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              // The explicit space is the same trap as the "Value UTC" label
              // below: JSX drops the whitespace between two elements, so the
              // flex `gap` separates these for the eye and nothing else — a
              // screen reader would read the sentence as "Matchis".
              <p className="admin-filter-fixed">
                <span>Match</span>{" "}
                <span className="admin-filter-fixed-value">{operatorLabels[draft.operator]}</span>
              </p>
            )}

            {/* Every timestamp this section prints is the server's own, which is
                UTC. So the picker is read as UTC and says so, in the field's own
                name — otherwise the digits in the column and the digits in the
                filter differ by the reader's offset, silently (§5.8). The
                explicit space is what keeps that name "Value UTC" rather than
                "ValueUTC": JSX drops the whitespace between two elements. */}
            <label htmlFor={`${fieldId}-value`}>
              <span>Value</span>{" "}
              {control === "datetime" ? <span className="admin-filter-unit">UTC</span> : null}
            </label>
            {control === "boolean" ? (
              <select
                id={`${fieldId}-value`}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                value={draft.value}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                id={`${fieldId}-value`}
                inputMode={control === "number" ? "decimal" : undefined}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                // `any`, not the default 1: the gateway parses a numeric filter
                // as a BigDecimal, and a `numeric(10,2)` column is filtered on
                // fractions the browser would otherwise call invalid.
                step={control === "number" ? "any" : undefined}
                type={control === "datetime" ? "datetime-local" : control === "number" ? "number" : "text"}
                value={draft.value}
              />
            )}

            <div className="admin-filter-actions">
              <button className="secondary-button" type="submit">
                Apply
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

/** What a field of this kind holds when nothing has been entered into it. */
function emptyValueFor(control: AdminValueControl): string {
  // A boolean has no meaningful empty state — the choice is the whole field —
  // so it opens on `true` rather than on a select showing nothing.
  return control === "boolean" ? "true" : "";
}

/** An applied filter's value as the field that edits it spells it. */
function toFieldValue(control: AdminValueControl, value: string): string {
  if (control === "datetime") return toPickerValue(value);
  // A hand-edited URL can carry anything; the two-option select can show only
  // these two, and a select with no matching option renders blank.
  if (control === "boolean") return value === "false" ? "false" : "true";
  return value;
}

/**
 * **This section is UTC** (§5.8). `datetime-local` has no offset of its own, so
 * something has to say which clock its digits are on, and the only defensible
 * answer here is the one the table prints: the server's, `Z`. Reading the field
 * as local wall time meant an admin looking at `2026-09-10T08:00:00Z` typed
 * 08:00 and filtered from 05:00Z, with both spellings on screen 20px apart.
 *
 * So these two never touch the local timezone in either direction, and they are
 * exact inverses of each other. They stay forgiving in one direction only: an
 * unreadable stored value opens the picker empty rather than throwing, while an
 * empty picker produces an empty value the caller already treats as "no filter".
 */
function toPickerValue(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return `${date}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

function toIsoValue(local: string): string {
  if (!local) return "";
  // The `Z` is the whole point: it makes the digits in the field the digits on
  // the wire, whatever the reader's own clock says.
  const at = new Date(`${local}Z`);
  if (Number.isNaN(at.getTime())) return "";
  // Without milliseconds (§5.8): the server does not need them, and `.000` eats
  // a quarter of the chip's width.
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
