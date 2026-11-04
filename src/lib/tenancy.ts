/**
 * The B2B build flag (TAS-500): `VITE_TASKA_TENANTS=true` builds companies and
 * per-tab company sessions against the B2B blueprint in `docs/contract/b2b/`;
 * any other value, unset and empty included, is today's build — the one the
 * stand runs, which calls none of the blueprint's routes and keeps none of its
 * storage keys.
 *
 * Read here and nowhere else. `src/api/client.ts` hands it to whichever
 * implementation it builds; the implementations themselves take it as a
 * constructor option, so a unit test chooses the build it runs against rather
 * than inheriting it from the environment.
 *
 * Unsafe to turn on before TAS-316 and TAS-340 are deployed, not merely early:
 * a gateway that issues company sessions but does not scope its data routes
 * would show the same projects in every company's tab, and the UI cannot tell
 * (docs/ai/API-DIVERGENCE.md «TAS-500»).
 */
export const tenantsEnabled: boolean = import.meta.env.VITE_TASKA_TENANTS === "true";
