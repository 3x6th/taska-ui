import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AdminFilter } from "../../domain/types";
import { namedFilterChipLabel, namedFilterKey, type NamedFilterDef } from "./namedFilters";
import { toIsoValue, toPickerValue } from "./utcField";

interface AdminNamedFilterControlProps {
  filters: AdminFilter[];
  /** Every filter the section knows, which is what names an applied chip. */
  definitions: NamedFilterDef[];
  /**
   * The ones that may be *offered* now, when that is fewer than all — the
   * Outbox journal drops the ones whose column the server will not filter on
   * or the catalog marks sensitive. Defaults to every definition.
   */
  available?: NamedFilterDef[];
  /** The popover's accessible name: "Filter events", "Filter audit entries". */
  dialogLabel: string;
  /**
   * What is wrong with the filters *together*, once one is applied — a `from`
   * after a `to`, which neither value is wrong about alone. `null` when they
   * may be sent; otherwise the popover stays open and says why.
   */
  validate?: (filters: AdminFilter[]) => string | null;
  onChange: (filters: AdminFilter[]) => void;
}

/**
 * Named filters (DESIGN.md §5.8) — the Outbox journal's nine since TAS-167, and
 * the Audit log's eight since TAS-251. Instead of the Data section's column /
 * match / value: the table is known, so the useful pairings are known too, and
 * a `match` select whose answer is already decided is a control that cannot
 * change anything, which §5.8 rules out in the Data form as well. So the
 * popover offers filters *by name* and the only thing left to fill in is the
 * value.
 *
 * They combine as AND and each key appears at most once, because that is what
 * the gateway reads: a repeated key is one value there, so offering a second
 * `status.equals` would put a chip on screen that the wire silently drops.
 */
export function AdminNamedFilterControl({
  filters,
  definitions,
  available = definitions,
  dialogLabel,
  validate,
  onChange,
}: AdminNamedFilterControlProps) {
  const errorId = useId();
  const fieldId = useId();
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** The wire key being edited, or `null` while adding a new filter. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; value: string }>({ key: "", value: "" });
  /** Why Apply was refused, said in the popover until the draft changes. */
  const [problem, setProblem] = useState<string | null>(null);
  // Removing a filter unmounts the cross that was clicked, and with it the
  // focus — the keyboard would land on <body> (§7). A ref, not state: this is a
  // note to the next commit and nothing renders differently for it.
  const returnFocusRef = useRef(false);

  useEffect(() => {
    // Waits for the render where the filter is actually gone: removal goes
    // through the URL, which lands a commit after the click.
    if (!returnFocusRef.current) return;
    returnFocusRef.current = false;
    addRef.current?.focus();
  }, [filters]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      addRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const applied = new Set(filters.map((filter) => namedFilterKey(filter)));
  const offered = available.filter(
    // Already applied ones are not offered again — except the one being edited,
    // which has to stay in its own select or the field would show a blank.
    (definition) => !applied.has(namedFilterKey(definition)) || namedFilterKey(definition) === editing,
  );
  const definitionOf = (key: string) => offered.find((candidate) => namedFilterKey(candidate) === key);
  const drafted = definitionOf(draft.key);

  const openToAdd = () => {
    const first = offered[0];
    if (!first) return;
    setEditing(null);
    setDraft({ key: namedFilterKey(first), value: emptyValueFor(first) });
    setProblem(null);
    setOpen(true);
  };

  const openToEdit = (filter: AdminFilter) => {
    const key = namedFilterKey(filter);
    const definition = definitions.find((candidate) => namedFilterKey(candidate) === key);
    setEditing(key);
    setProblem(null);
    // While the popover is open the draft holds what the *field* holds, so a
    // timestamp comes out of the URL as the picker's own spelling and returns
    // to ISO on Apply.
    setDraft({
      key,
      value: definition?.control === "datetime" ? toPickerValue(filter.value) : filter.value,
    });
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    // Forgotten here, the next "+ Filter" would open on the filter that was
    // last edited — which is applied already, and which the select is only
    // allowed to offer while it is the one being edited.
    setEditing(null);
    addRef.current?.focus();
  };

  const apply = () => {
    if (!drafted) return close();
    const value = drafted.control === "datetime" ? toIsoValue(draft.value) : draft.value.trim();
    const key = namedFilterKey(drafted);
    // Everything except the key being written and the one being replaced, in
    // the order the reader applied them.
    const kept = filters.filter((filter) => {
      const existing = namedFilterKey(filter);
      return existing !== key && existing !== editing;
    });
    // A blank value is not a filter (§5.8) — and clearing the field of an
    // applied one is how it is taken off from inside the popover.
    const next = value === "" ? kept : [...kept, { column: drafted.column, operator: drafted.operator, value }];
    // Refused here rather than sent: a value the server would turn away — or
    // answer with a fault — is the form's to catch, and the popover stays open
    // on it so the reader can correct what they typed.
    const valueProblem = value === "" || !drafted.check ? null : drafted.check(value);
    const refusal = valueProblem ?? validate?.(next) ?? null;
    if (refusal !== null) {
      setProblem(refusal);
      return;
    }
    onChange(next);
    close();
  };

  const remove = (filter: AdminFilter) => {
    returnFocusRef.current = true;
    const key = namedFilterKey(filter);
    onChange(filters.filter((candidate) => namedFilterKey(candidate) !== key));
  };

  return (
    <div className="admin-filter admin-named-filter" ref={rootRef}>
      {filters.map((filter) => {
        const label = namedFilterChipLabel(definitions, filter);
        return (
          <span className="admin-filter-chip" key={namedFilterKey(filter)}>
            <button
              aria-controls={open ? popoverId : undefined}
              aria-expanded={open && editing === namedFilterKey(filter)}
              aria-haspopup="dialog"
              className="admin-filter-chip-open"
              onClick={() => (open && editing === namedFilterKey(filter) ? close() : openToEdit(filter))}
              // The chip truncates by width, so the whole of it stays in
              // `title` and in the accessible name: a truncation the value
              // cannot be read back out of is lost data, not saved space (§5.8).
              title={label}
              type="button"
            >
              <span className="admin-filter-chip-text">{label}</span>
            </button>
            <button
              aria-label={`Remove filter ${label}`}
              className="admin-filter-chip-remove"
              onClick={() => remove(filter)}
              type="button"
            >
              <X aria-hidden="true" size={13} />
            </button>
          </span>
        );
      })}

      {/* Gone only when every one is applied — a button that can add nothing is
          worse than no button. */}
      {offered.some((definition) => !applied.has(namedFilterKey(definition))) ? (
        <button
          aria-controls={open ? popoverId : undefined}
          aria-expanded={open && editing === null}
          aria-haspopup="dialog"
          className="admin-filter-add"
          onClick={() => (open && editing === null ? close() : openToAdd())}
          ref={addRef}
          type="button"
        >
          <Plus aria-hidden="true" size={13} />
          Filter
        </button>
      ) : null}

      {open ? (
        <section aria-label={dialogLabel} className="admin-filter-popover" id={popoverId} role="dialog">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            {/* Explicitly associated rather than wrapping: a <label> that wraps
                a <select> takes every option's text into its accessible name. */}
            <label htmlFor={`${fieldId}-filter`}>
              <span>Filter</span>
            </label>
            <select
              id={`${fieldId}-filter`}
              onChange={(event) => {
                const next = definitionOf(event.target.value);
                // The value cannot survive a change of filter here: a date
                // picker has nothing to show for `FAILED`, a number field
                // nothing for a uuid, and a four-option select nothing for
                // either.
                setDraft({ key: event.target.value, value: next ? emptyValueFor(next) : "" });
                setProblem(null);
              }}
              value={draft.key}
            >
              {offered.map((definition) => (
                <option key={namedFilterKey(definition)} value={namedFilterKey(definition)}>
                  {definition.label}
                </option>
              ))}
            </select>

            {/* No Match field anywhere in this section: the operator is part of
                the filter's name. */}
            <label htmlFor={`${fieldId}-value`}>
              <span>Value</span>{" "}
              {/* Every timestamp this section prints is the server's own, which
                  is UTC, so the picker says which clock its digits are on — the
                  explicit space is what keeps this name "Value UTC" rather than
                  "ValueUTC". */}
              {drafted?.control === "datetime" || drafted?.control === "date" ? (
                <span className="admin-filter-unit">UTC</span>
              ) : null}
            </label>
            {drafted?.control === "select" ? (
              <select
                id={`${fieldId}-value`}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                value={draft.value}
              >
                {(drafted.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-describedby={problem ? errorId : undefined}
                aria-invalid={problem ? true : undefined}
                id={`${fieldId}-value`}
                inputMode={drafted?.control === "integer" ? "numeric" : undefined}
                // Attempts is a counter: whole numbers, never below zero. The
                // gateway parses it as a number and answers 400 for anything
                // else, so the field is what keeps that 400 from happening.
                min={drafted?.control === "integer" ? 0 : undefined}
                onChange={(event) => {
                  setDraft({ ...draft, value: event.target.value });
                  setProblem(null);
                }}
                step={drafted?.control === "integer" ? 1 : undefined}
                type={
                  drafted?.control === "datetime"
                    ? "datetime-local"
                    : drafted?.control === "date"
                      ? "date"
                      : drafted?.control === "integer"
                        ? "number"
                        : "text"
                }
                value={draft.value}
              />
            )}
            {/* Mounted only with something to say, and announced when it
                appears: the reader pressed Apply and nothing closed, so the
                reason is the next thing they need to hear. */}
            {problem ? (
              <p className="admin-filter-problem" id={errorId} role="alert">
                {problem}
              </p>
            ) : null}

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
 * What a field of this kind holds before anything is entered. A select has no
 * meaningful empty state — the choice is the whole field — so it opens on its
 * first option, in the lifecycle order §5.8 lists them in, and the popover
 * therefore always shows exactly what Apply will do.
 */
function emptyValueFor(definition: NamedFilterDef): string {
  return definition.control === "select" ? (definition.options?.[0] ?? "") : "";
}
