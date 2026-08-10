import { TaskaMascot } from "./TaskaMascot";

/**
 * DESIGN.md §4.18: the melted Taska cube — cross eyes, tongue out, pooled on
 * the floor. Drawn outside the repository as a 3D render; the channel sources
 * are kept at `docs/design/mascot-channels/` and are not shipped.
 *
 * It is no longer a single baked frame. §4.18 used to record that the purple
 * did not follow `--accent` and that changing the accent meant redrawing the
 * asset; the mascot is now composited from channels (see TaskaMascot), so that
 * limitation is gone rather than merely written down.
 */
export function NotFoundMascot() {
  return <TaskaMascot className="notfound-mascot" name="not-found" />;
}
