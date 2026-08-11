import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AdminFilter, AdminFilterOperator } from "../../domain/types";
import { classifyColumnType, operatorsForType, supportsOperator } from "./columns";
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
  // A timestamp is parsed strictly server-side (`OffsetDateTime.parse`), so
  // `2026-01-01` and `2026-01-01T00:00` are both 400s. §5.8: the format is the
  // form's job, not something the admin is expected to remember — the picker
  // produces a local moment and the wire gets a full ISO-8601 with offset.
  const temporal = classifyColumnType(draftColumnType) === "TEMPORAL";

  const openPopover = () => {
    if (!filter) {
      setDraft({ column: "", operator: "equals", value: "" });
    } else {
      // While the popover is open the draft holds what the *fields* hold, so a
      // temporal filter comes back out of the URL as the picker's own local
      // spelling and returns to ISO on Apply. Converting on every keystroke
      // instead would fight the picker: a half-typed date parses to nothing,
      // and a controlled field reset to "" mid-entry cannot be typed into.
      const editable = classifyColumnType(typeOf(filter.column)) === "TEMPORAL";
      setDraft(editable ? { ...filter, value: toPickerValue(filter.value) } : filter);
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

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
            type="button"
          >
            <span className="admin-filter-chip-text">
              {filter.column} {operatorLabels[filter.operator]} {filter.value}
            </span>
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
              // The picker's local moment becomes the offset-bearing ISO string
              // the gateway parses, here and nowhere else.
              const value = temporal ? toIsoValue(draft.value) : draft.value;
              onChange(draft.column ? { ...draft, value } : null);
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
                // here the reader typed — except across the picker boundary,
                // where the two fields cannot hold each other's spelling: a
                // date picker has nothing to show for `anna@`, and a text field
                // would keep a moment the reader never typed.
                const picked = classifyColumnType(type) === "TEMPORAL";
                const wasPicked = classifyColumnType(typeOf(draft.column)) === "TEMPORAL";
                setDraft({ column, operator, value: picked === wasPicked ? draft.value : "" });
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

            <label htmlFor={`${fieldId}-value`}>
              <span>Value</span>
            </label>
            {/* A date is picked, not typed (§5.8). The server parses a
                timestamp strictly, so a free field would mean guessing the one
                spelling it accepts — and `2026-01-01` is a 400, not a lenient
                near-miss. Every other type keeps the plain field: those values
                are the table's own, and only the reader knows them. */}
            <input
              id={`${fieldId}-value`}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              type={temporal ? "datetime-local" : "text"}
              value={draft.value}
            />

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

/**
 * `datetime-local` speaks local wall-clock time with no offset; the gateway
 * parses `OffsetDateTime` and accepts nothing else. These two are the whole
 * translation, and they are deliberately forgiving in one direction only: an
 * unreadable stored value opens the picker empty rather than throwing, while an
 * empty picker produces an empty value the caller already treats as "no
 * filter".
 */
function toPickerValue(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function toIsoValue(local: string): string {
  if (!local) return "";
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}
