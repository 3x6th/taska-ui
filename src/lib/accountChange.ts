import type { QueryClient } from "@tanstack/react-query";
import { ME_QUERY_KEY } from "./ownAvatarLink";

/**
 * The account's reads that show its address (TAS-527, api-contract-guard §6,
 * art-director B16): `GET /users/me` — the top bar's menu, My profile, Settings
 * › Account, the picker's «Signed in as» — and the reader's notification
 * channels, whose Email row names the address too. Invalidated, so only what
 * is on screen is read again and the rest when it next is; the new address
 * comes from those answers and from nowhere else.
 */
export const NOTIFICATION_PREFERENCES_PREFIX = ["notification-preferences"] as const;

export function refreshAccountReads(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ME_QUERY_KEY });
  void client.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_PREFIX });
}
