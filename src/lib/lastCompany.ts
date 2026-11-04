/**
 * `taska.lastCompany` (TAS-500, DESIGN.md §5.1): the last company this device
 * entered, as `{userId, companyId}`. **A hint and nothing more** — written on
 * entering a company, cleared on log out, and read only to pick a company for
 * a tab that has none yet. It never opens anything by itself and never moves a
 * tab that already has a company; the server still answers the entry.
 *
 * Keyed by the account it was written for, so a different person signing in
 * on the same device is not sent into the previous person's company.
 *
 * Storage that is missing or refuses access is never a throw: the hint is
 * simply absent.
 */
export const LAST_COMPANY_KEY = "taska.lastCompany";

interface LastCompany {
  userId: string;
  companyId: string;
}

function isLastCompany(value: unknown): value is LastCompany {
  if (typeof value !== "object" || value === null) return false;
  const { userId, companyId } = value as Record<string, unknown>;
  return typeof userId === "string" && userId !== "" && typeof companyId === "string" && companyId !== "";
}

/** The company this account last entered on this device, or `null`. */
export function readLastCompany(storage: Storage, userId: string): string | null {
  try {
    const raw = storage.getItem(LAST_COMPANY_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLastCompany(parsed) && parsed.userId === userId ? parsed.companyId : null;
  } catch {
    return null;
  }
}

export function writeLastCompany(storage: Storage, userId: string, companyId: string): void {
  try {
    storage.setItem(LAST_COMPANY_KEY, JSON.stringify({ userId, companyId } satisfies LastCompany));
  } catch {
    // Nowhere to keep it; a new tab simply asks.
  }
}

export function clearLastCompany(storage: Storage): void {
  try {
    storage.removeItem(LAST_COMPANY_KEY);
  } catch {
    // Nothing was kept.
  }
}
