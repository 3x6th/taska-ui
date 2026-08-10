import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AdminFilter, AdminFilterOperator } from "../../domain/types";
import { isRangeOperator, isTemporal } from "./columns";
import { filterOperators, operatorLabels } from "./urlState";

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
  const [draft, setDraft] = useState<AdminFilter>({ column: "", operator: "eq", value: "" });
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

  // `from`/`to` are cast to a timestamp server-side, so offering them on a text
  // column produces a database error the UI cannot explain rather than an empty
  // result. The catalog states each column's type, so only offer the range
  // operators where they can actually work.
  const draftColumnType = typeOf(draft.column);
  const operators = filterOperators.filter(
    (operator) => !isRangeOperator(operator) || isTemporal(draftColumnType),
  );

  const openPopover = () => {
    setDraft(filter ?? { column: "", operator: "eq", value: "" });
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
              onChange(draft.column ? draft : null);
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
                // Moving from a timestamp column to a text one strands the
                // operator on a value the new column cannot take, and the
                // select would show a blank because the option is gone.
                const operator = isRangeOperator(draft.operator) && !isTemporal(type) ? "eq" : draft.operator;
                setDraft({ ...draft, column, operator });
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
            <input
              id={`${fieldId}-value`}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
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
