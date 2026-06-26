/**
 * src/lib/getMergedCityEvents.ts
 *
 * Single source of truth for sidebar event data across every layout.
 *
 * Merges two sources in priority order:
 *   1. Sveltia CMS  — getCollection("events"), filtered to the city's regionCities
 *   2. Engine / sheet — getCityEvents(city) from events.js
 *
 * Rules applied here so no layout re-implements them:
 *   • featured:true  →  sponsored:true  (CMS normalisation)
 *   • CMS sponsored events prepend the feed
 *   • Title-based dedup prevents the same event appearing twice
 *
 * Usage in any .astro frontmatter:
 *   import { getMergedCityEvents } from "../lib/getMergedCityEvents.ts";
 *   const merged = await getMergedCityEvents(city);
 *   const sponsored = merged.filter(e => e.data.sponsored).slice(0, 5);
 *   const regular   = merged.filter(e => !e.data.sponsored).slice(0, 3);
 */

import { getCollection } from "astro:content";
import { getCityEvents  } from "./events.js";
import { getCityConfig  } from "./cityConfigs.js";

export async function getMergedCityEvents(city: string): Promise<any[]> {
  // ── 1. Engine / sheet events ────────────────────────────────────────
  const engineEvents: any[] = await getCityEvents(city);

  // ── 2. Sveltia CMS events ───────────────────────────────────────────
  let cmsEvents: any[] = [];
  try {
    const cityConfig   = getCityConfig(city);
    const regionCities: Set<string> =
      cityConfig?.regionCities ?? new Set([city.toLowerCase()]);

    const allLocal = await getCollection("events");
    cmsEvents = (allLocal as any[])
      .filter((e: any) => regionCities.has((e.data.city ?? "").toLowerCase().trim()))
      .map((e: any) => ({
        ...e,
        data: {
          ...e.data,
          // Normalise: featured CMS events are treated as sponsored in the feed
          sponsored: e.data.sponsored === true || e.data.featured === true,
        },
      }));
  } catch {
    // CMS unavailable at build time — fall back to engine-only gracefully
  }

  // ── 3. Merge & deduplicate by title ────────────────────────────────
  const seen = new Set<string>();
  return [
    ...cmsEvents.filter((e: any) =>  e.data.sponsored),   // CMS sponsored first
    ...cmsEvents.filter((e: any) => !e.data.sponsored),   // CMS regular second
    ...engineEvents,                                        // engine / sheet last
  ].filter((e: any) => {
    const key = (e.data.title ?? "").toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
