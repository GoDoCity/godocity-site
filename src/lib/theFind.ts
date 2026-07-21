/**
 * src/lib/theFind.ts
 * Scope resolution for "The Find" product roundups.
 *
 * A roundup is either network-wide (renders on every city's /the-find/ feed)
 * or city-specific (renders only on its cityTag city). Legacy entries that
 * predate the `scope` field fall back to their `cityTag`/`city` value.
 */
export interface TheFindData {
  scope?: "network" | "city";
  cityTag?: string;
  city?: string;
  [key: string]: unknown;
}

/** True if a roundup should appear on the given city's feed. */
export function roundupInCity(data: TheFindData, city: string): boolean {
  const scope = data?.scope ?? "network";
  if (scope === "network") return true;
  const tag = String(data?.cityTag ?? data?.city ?? "").toLowerCase().trim();
  return tag === String(city ?? "").toLowerCase().trim();
}
