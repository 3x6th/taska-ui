import mascotUrl from "../assets/mascot-not-found.webp";

/**
 * DESIGN.md §4.18: the melted Taska cube — cross eyes, tongue out, pooled on
 * the floor. Drawn outside the repository as a 3D render; the source frame is
 * kept at `docs/design/mascot-not-found-source.png` and is not shipped.
 *
 * The asset is imported rather than referenced from `public/` on purpose: the
 * Pages build runs with a non-empty `base` (vite.config.ts), and only the
 * import gets that prefix rewritten into the emitted URL.
 *
 * `alt=""` because the image is decorative — the heading and the sentence next
 * to it carry the whole message. An empty alt already drops the image from the
 * accessibility tree, so `aria-hidden` would be redundant. The width/height
 * attributes are the intrinsic ones and exist only to reserve the aspect ratio
 * before the file loads; the rendered size comes from `.notfound-mascot`.
 *
 * Known limitation (§4.18): the purple is baked into the pixels and does not
 * follow `--accent`. This is the one place in the UI where colour is not a
 * token, and changing the accent means redrawing the asset.
 */
export function NotFoundMascot() {
  return <img src={mascotUrl} className="notfound-mascot" alt="" width={720} height={346} />;
}
