import type { CSSProperties } from "react";
import buildingAlpha from "../assets/mascot-building-alpha.webp";
import buildingLight from "../assets/mascot-building-light.webp";
import buildingShade from "../assets/mascot-building-shade.webp";
import buildingStatic from "../assets/mascot-building-static.webp";
import notFoundAlpha from "../assets/mascot-notfound-alpha.webp";
import notFoundLight from "../assets/mascot-notfound-light.webp";
import notFoundShade from "../assets/mascot-notfound-shade.webp";

/**
 * The Taska cube, composited from separated channels so that its purple follows
 * `--accent` instead of being baked into the pixels.
 *
 * §2.1 says the accent is swappable, and until now §4.18 carried the one
 * exception in the whole product: the mascot was a single flat render, so
 * changing the accent meant redrawing the asset. The owner re-rendered both
 * mascots as channels, which removes that exception rather than documenting it
 * again.
 *
 * The recipe — measured from the source frames, not guessed:
 *
 *   result = accent × shade + light,  clipped to alpha,  then `static` on top
 *
 * `shade` is white where the surface takes the accent unmodified and darker
 * where the form turns away (multiply); `light` is black everywhere except the
 * speculars and the logo mark (screen); `alpha` is the silhouette. Each channel
 * carries its own transparency, so nothing paints outside the figure even
 * though only the fill layer is masked.
 *
 * `static` exists only for the building mascot: the amber beacon, the pink
 * eraser and the pencil tip are the parts that must *not* follow the accent —
 * a warning light that changes colour with the theme stops being a warning
 * light.
 *
 * Assets are imported rather than referenced from `public/`: the Pages build
 * runs with a non-empty `base` (vite.config.ts) and only an import gets that
 * prefix rewritten into the emitted URL.
 *
 * Decorative in both uses — the heading and the sentence beside it carry the
 * message — so the whole stack is `aria-hidden`. There is no `<img>` and
 * therefore no `alt` to leave empty; hiding the container is what keeps four
 * layered `<span>`s from reaching the accessibility tree as nothing at all.
 */
const mascots = {
  "not-found": {
    alpha: notFoundAlpha,
    shade: notFoundShade,
    light: notFoundLight,
    static: undefined,
  },
  building: {
    alpha: buildingAlpha,
    shade: buildingShade,
    light: buildingLight,
    static: buildingStatic,
  },
} as const;

export type MascotName = keyof typeof mascots;

export function TaskaMascot({ name, className }: { name: MascotName; className?: string }) {
  const layers = mascots[name];
  // The URLs travel as custom properties so the blend modes, sizing and masking
  // stay in styles.css (§8) and only the file names live here.
  const style = {
    "--mascot-alpha": `url(${layers.alpha})`,
    "--mascot-shade": `url(${layers.shade})`,
    "--mascot-light": `url(${layers.light})`,
  } as CSSProperties;

  return (
    <span aria-hidden="true" className={className ? `mascot ${className}` : "mascot"} style={style}>
      <span className="mascot-fill" />
      <span className="mascot-shade" />
      <span className="mascot-light" />
      {layers.static ? (
        <span className="mascot-static" style={{ "--mascot-static": `url(${layers.static})` } as CSSProperties} />
      ) : null}
    </span>
  );
}
