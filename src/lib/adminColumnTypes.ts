/**
 * How the read-only admin API groups a column's type (`DbColumnType` in the
 * gateway) when it decides what a filter on that column may say and how the
 * value is parsed.
 *
 * This lives in `lib/` rather than beside the screen because two layers need
 * the same answer from the same table: the console decides which operators and
 * which value control to offer, and `MockTaskaApi` has to compare and sort the
 * way the gateway does — numerically for a number, as an instant for a
 * timestamp. Two copies of this map would be two chances to disagree with the
 * backend, and the mock is what the e2e suite runs against.
 */
export type AdminColumnClass = "TEXT" | "TEMPORAL" | "NUMERIC" | "BOOLEAN" | "OTHER";

/**
 * The catalog states `information_schema.columns.data_type` verbatim, and the
 * gateway matches it **exactly** against this list, lowercased — not as a
 * substring. So `character varying` is text and `character varying[]` is not,
 * which is the difference between a filter that works and a 400.
 */
const COLUMN_CLASS_BY_TYPE = new Map<string, AdminColumnClass>([
  ["text", "TEXT"],
  ["character varying", "TEXT"],
  ["varchar", "TEXT"],
  ["character", "TEXT"],
  ["char", "TEXT"],
  ["name", "TEXT"],
  ["citext", "TEXT"],
  ["timestamp with time zone", "TEMPORAL"],
  ["timestamp without time zone", "TEMPORAL"],
  ["date", "TEMPORAL"],
  ["time with time zone", "TEMPORAL"],
  ["time without time zone", "TEMPORAL"],
  ["integer", "NUMERIC"],
  ["bigint", "NUMERIC"],
  ["smallint", "NUMERIC"],
  ["numeric", "NUMERIC"],
  ["decimal", "NUMERIC"],
  ["real", "NUMERIC"],
  ["double precision", "NUMERIC"],
  ["serial", "NUMERIC"],
  ["bigserial", "NUMERIC"],
  ["smallserial", "NUMERIC"],
  ["boolean", "BOOLEAN"],
]);

/**
 * The class the gateway will put this column in. A type it has never heard of —
 * `uuid`, `jsonb`, `bytea`, an absent type, a domain type from a later
 * migration — is `OTHER` on purpose: fewer operators is the safe direction,
 * because offering one the server rejects turns a filter into a 400 the reader
 * cannot act on.
 */
export function classifyColumnType(type?: string): AdminColumnClass {
  if (!type) return "OTHER";
  return COLUMN_CLASS_BY_TYPE.get(type.trim().toLowerCase()) ?? "OTHER";
}
