/**
 * The value of something the server did not tell us.
 *
 * An em dash is what this interface already says for that (AdminScreen's
 * `formatCell`); the word behind it is for the screen reader, which would
 * otherwise hear a bare "issues". It is deliberately not `0` and not blank:
 * both of those are claims about the thing being counted, where this is an
 * admission about the request.
 */
export function Unknown() {
  return (
    <>
      <span aria-hidden="true" className="unknown-value">
        —
      </span>
      <span className="visually-hidden">unknown</span>
    </>
  );
}

/**
 * The same slot while the answer is still on its way. §5.6 asks for a skeleton
 * rather than a spinner — and, more to the point, loading is not unknown: an em
 * dash on first paint would tell every visitor that a request which is going to
 * succeed has already failed.
 */
export function PendingValue() {
  return (
    <>
      <span aria-hidden="true" className="value-skeleton" />
      <span className="visually-hidden">loading</span>
    </>
  );
}
