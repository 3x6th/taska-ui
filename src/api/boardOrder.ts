import type { BoardIssue } from "../domain/types";

/**
 * Where a type's cards stand in a board column: TASK, BUG, STORY, and every
 * other code after them. The gateway's `BoardServiceImpl` reads the issues of
 * those three types one type after another, so a column holds them in that
 * order; a code outside the three never reaches the board on the server today
 * (backend A4), and ranks last here so the comparator stays total.
 */
const TYPE_RANK: Readonly<Record<string, number>> = { TASK: 0, BUG: 1, STORY: 2 };
const OTHER_TYPE_RANK = 3;

const typeRank = (issueType: string) =>
  Object.hasOwn(TYPE_RANK, issueType) ? TYPE_RANK[issueType] : OTHER_TYPE_RANK;

/**
 * The order of the cards inside a board column (DESIGN.md §5.3, TAS-202,
 * art-director's B1): the type's rank, then `createdAt` from the oldest, then
 * `id` — the server's own order, which it does not state (backend A1), with
 * the `id` tiebreak it lacks.
 *
 * One comparator for the two places that place a card without the server: the
 * mock's board, and the board's optimistic move. Placing a dropped card by
 * anything else would make the re-read after a successful move reorder it.
 * When backend A1 ships (`createdAt`, then `id`, across types) only this
 * function changes.
 *
 * `createdAt` is compared as an instant, not as text: two spellings of one
 * moment are one moment.
 */
export function compareBoardIssues(
  a: Pick<BoardIssue, "issueType" | "createdAt" | "id">,
  b: Pick<BoardIssue, "issueType" | "createdAt" | "id">,
): number {
  const byType = typeRank(a.issueType) - typeRank(b.issueType);
  if (byType !== 0) return byType;
  const byCreated = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
