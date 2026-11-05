import type { CompanyMarker } from "../lib/companyRestrictions";

/**
 * §4.34's state marker where it is not a control (TAS-512): the board's bar
 * and the profile menu. The word is drawn on the `read-only` recipe of §5.8;
 * before it, visually hidden, «{Company} is», so it reads as a sentence.
 * Without colour — the word carries the meaning (§7).
 */
export function CompanyMarkerWord({ company, marker }: { company: string | null; marker: CompanyMarker }) {
  return (
    <span className="company-marker">
      <span className="visually-hidden">{`${company ?? "This company"} is `}</span>
      {marker}
    </span>
  );
}
