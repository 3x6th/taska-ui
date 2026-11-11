/**
 * The two words this UI has for an account the server marked deleted
 * (TAS-529, DESIGN.md §4.4 and §6) — the only two, in one module so that no
 * surface can invent a third («Former user», «[deleted]», «Unknown»).
 *
 * They are the UI's own, never read off the wire: a marked person arrives with
 * no name to print (the mappers drop whatever the server put there), and an
 * unmarked person who happens to be called «Deleted user» is a name like any
 * other — nothing here is ever compared with a string the server sent.
 *
 * - `DELETED_USER` stands where a name stands: a name slot, a meta list item,
 *   an avatar's `title` and `aria-label`. Never split into words — a chip's
 *   first-name rule would print «Deleted».
 * - `DELETED_USER_IN_SENTENCE` is the object of a sentence this UI composes:
 *   «Anna Ivanova assigned a deleted user», «… logged on Jun 15 by a deleted
 *   user», «Invited by a deleted user». No sentence opens with a deleted
 *   person: their rows offer nothing to act on.
 */
export const DELETED_USER = "Deleted user";
export const DELETED_USER_IN_SENTENCE = "a deleted user";
