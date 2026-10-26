import type { BoardIssue } from "../domain/types";

/**
 * The order of the cards in a board column, and of `unplacedIssues` (DESIGN.md
 * §5.3; backend TAS-392, contract at develop `af41c322`): `createdAt` from the
 * oldest, then `id` — **whatever the type**. Before TAS-392 the server read one
 * type after another and this ranked TASK, BUG and STORY first; with an open
 * registry there is no type rank any more, and none replaces it.
 *
 * One comparator for the two places that place a card without the server: the
 * mock's board, and the board's optimistic move. Placing a dropped card by
 * anything else would make the re-read after a successful move reorder it.
 *
 * `createdAt` is compared as an instant, not as text: two spellings of one
 * moment are one moment. The ids are compared as code units.
 */
export function compareBoardIssues(
  a: Pick<BoardIssue, "createdAt" | "id">,
  b: Pick<BoardIssue, "createdAt" | "id">,
): number {
  const byCreated = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
