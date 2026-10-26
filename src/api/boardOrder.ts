import type { BoardIssue } from "../domain/types";

/**
 * The order of the cards in a board column, and of `unplacedIssues` (DESIGN.md
 * §5.3; backend TAS-392, `BoardServiceImpl` at develop `be5085e5`):
 * `createdAt` from the oldest — a card with no readable `createdAt` after
 * every dated one — then `id` as a string, **whatever the type**. Before
 * TAS-392 the server read one type after another and this ranked TASK, BUG and
 * STORY first; with an open registry there is no type rank any more, and none
 * replaces it.
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
  const at = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
  if (Number.isNaN(at) !== Number.isNaN(bt)) return Number.isNaN(at) ? 1 : -1;
  if (!Number.isNaN(at) && at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
