import type { BoardIssue } from "../domain/types";

/**
 * The category whose columns the server orders by `updatedAt` (backend
 * TAS-525): `"DONE".equals(status.getCategory())` in the gateway's
 * `BoardServiceImpl`, compared as written — the category set is open
 * (TAS-173), and a category this build has no word for orders as the others.
 */
export const BOARD_DONE_CATEGORY = "DONE";

/** Whether a column of `category` is ordered — and continued — by `updatedAt`. */
export const isDoneCategory = (category: string | null | undefined) => category === BOARD_DONE_CATEGORY;

/** An instant, or `NaN` for a value that is not one — a missing one included. */
const instant = (value: string | null | undefined) => (value ? new Date(value).getTime() : NaN);

/** Ids as code units: the gateway compares `getId().toString()`, and PostgreSQL's `uuid` order is the same on lowercase text. */
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of a column that is not of category `DONE`, and of
 * `unplacedIssues` (DESIGN.md §5.3; backend TAS-392, kept by TAS-525,
 * `BoardServiceImpl.boardOrder(false)` at develop `e35e143e`): `createdAt`
 * from the oldest — a card with no readable `createdAt` after every dated one,
 * the server's `nullsLast` — then `id` ascending, **whatever the type**.
 * Before TAS-392 the server read one type after another and ranked TASK, BUG
 * and STORY first; with an open registry there is no type rank any more, and
 * none replaces it.
 *
 * `createdAt` is compared as an instant, not as text: two spellings of one
 * moment are one moment.
 */
export function compareByCreatedAt(a: Pick<BoardIssue, "createdAt" | "id">, b: Pick<BoardIssue, "createdAt" | "id">): number {
  const at = instant(a.createdAt);
  const bt = instant(b.createdAt);
  if (Number.isNaN(at) !== Number.isNaN(bt)) return Number.isNaN(at) ? 1 : -1;
  if (!Number.isNaN(at) && at !== bt) return at - bt;
  return byId(a.id, b.id);
}

/**
 * The order of a column of category `DONE` (DESIGN.md §5.3; backend TAS-525,
 * `BoardServiceImpl.boardOrder(true)` and issue-service's
 * `ORDER BY updated_at DESC, id DESC` at develop `e35e143e`): `updatedAt`
 * from the newest — a card with no readable `updatedAt` after every dated one,
 * `nullsLast` on the server too — then `id` **descending**. The cut, the
 * count and «Show more» follow it: the first page of a done column is what was
 * touched last, and its continuation is the cursor `afterUpdatedAt`/`afterId`.
 */
export function compareByUpdatedAt(a: Pick<BoardIssue, "updatedAt" | "id">, b: Pick<BoardIssue, "updatedAt" | "id">): number {
  const at = instant(a.updatedAt);
  const bt = instant(b.updatedAt);
  if (Number.isNaN(at) !== Number.isNaN(bt)) return Number.isNaN(at) ? 1 : -1;
  if (!Number.isNaN(at) && at !== bt) return bt - at;
  return byId(b.id, a.id);
}

/** What either order reads off a card. */
export type BoardOrderedIssue = Pick<BoardIssue, "createdAt" | "updatedAt" | "id">;

/**
 * The order of the cards of a column of `category` — the category the board
 * answer gave the column, which for a key two types share is the first
 * registry type's (backend TAS-525: "При общем ключе разных категорий порядок
 * колонки задаёт первый тип реестра проекта"). `DONE` is `compareByUpdatedAt`;
 * every other category, and «Outside their workflow» (`null`), is
 * `compareByCreatedAt`.
 *
 * One comparator for the two places that place a card without the server: the
 * mock's board and column page, and the board's optimistic move. Placing a
 * dropped card by anything else would make the re-read after a successful move
 * reorder it.
 */
export function boardIssueOrder(category: string | null | undefined): (a: BoardOrderedIssue, b: BoardOrderedIssue) => number {
  return isDoneCategory(category) ? compareByUpdatedAt : compareByCreatedAt;
}
