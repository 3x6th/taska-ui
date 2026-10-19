/**
 * How a `viewLinkType` code off the wire is read — shared by the rest leg,
 * which reads every link row and `/meta`'s `linkViewTypes` through it, and by
 * the mock, which serves `linkViewTypes` as the gateway spells them and reads
 * them back the same way. One reading on both sides is the whole point: a row's
 * `BLOCKS` is looked up among dictionary codes stripped exactly as it was.
 */

/** The prefix the gateway's `.name()` leaves on every `IssueLinkViewType`. */
export const VIEW_LINK_TYPE_PREFIX = "ISSUE_LINK_VIEW_TYPE_";

/**
 * `viewLinkType` as the label helper reads it — see `toIssueLink` in
 * RestTaskaApi. The prefix comes off; the proto zero value
 * (`ISSUE_LINK_VIEW_TYPE_UNSPECIFIED`) and `UNRECOGNIZED`, which carries no
 * prefix at all, mean "no relation stated" and become `""`, as does anything
 * that is not a string.
 */
export function toViewLinkType(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.startsWith(VIEW_LINK_TYPE_PREFIX) ? value.slice(VIEW_LINK_TYPE_PREFIX.length) : value;
  return name === "UNSPECIFIED" || name === "UNRECOGNIZED" ? "" : name;
}
