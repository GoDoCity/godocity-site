/**
 * src/pages/daytona/events.json.ts
 *
 * Static JSON feed of Daytona events authored in the Sveltia CMS
 * (src/content/events/daytona/*.md). Emitted at build time to
 *   https://godocity-site.pages.dev/daytona/events.json
 *
 * The unified GoDoEVENTS hub (godoevents-site) fetches this at request time and
 * merges it into /daytona/events/, so publishing an event here goes live there
 * automatically on the next build. Shapes fields to what api.ts#fetchCmsEvents
 * expects; `sponsored: true` makes the event lead the ticker + GoDo Picks.
 *
 * Image paths are absolutised to this origin — the creatives live here, so a
 * bare "/images/..." would 404 against the godoevents-site domain.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { geocodeAddress } from "../../lib/geocode";

export const prerender = true;

const ORIGIN = "https://godocity-site.pages.dev";

/* Daytona geocode bias — proximity [lng, lat] + Volusia/Flagler bounding box. */
const DAYTONA_PROXIMITY: [number, number] = [-81.0228, 29.2108];
const DAYTONA_BBOX: [number, number, number, number] = [-82.5, 28.3, -80.3, 30.2];

function absolutise(src: string | undefined | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return `${ORIGIN}${src.startsWith("/") ? "" : "/"}${src}`;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export const GET: APIRoute = async () => {
  let events: any[] = [];
  try {
    const mapboxToken = import.meta.env.MAPBOX_ACCESS_TOKEN ?? "";
    const all = await getCollection("events");
    const daytona = all.filter((e: any) => (e.data.city ?? "").toLowerCase().trim() === "daytona");

    events = await Promise.all(daytona.map(async (e: any) => {
      /* Coordinates: manual lat/lng → geocoded address → null (hub falls back).
         Editors usually enter only an address, so geocode at build time so the
         hub can place the branded star pin at the venue instead of city-center. */
      let lat: number | null = e.data.lat ?? null;
      let lng: number | null = e.data.lng ?? null;
      if (lat == null || lng == null) {
        const parts = [e.data.location, e.data.address].map((s: any) => String(s ?? "").trim()).filter(Boolean);
        let query = parts.join(", ");
        if (query && !/\bfl\b|\bflorida\b/i.test(query)) query += ", Daytona Beach, FL";
        const geo = await geocodeAddress(query, mapboxToken, { proximity: DAYTONA_PROXIMITY, bbox: DAYTONA_BBOX });
        if (geo) { lat = geo.lat; lng = geo.lng; }
      }

      return {
        // Lowercase id so a mixed-case link never mismatches the lowercase slug.
        id:             `cms-${(e.slug.split("/").pop() ?? "").toLowerCase()}`,
        market_id:      "daytona",
        title:          e.data.title,
        description:    e.data.description ?? null,
        start_datetime: toIso(e.data.eventDate),
        end_datetime:   toIso(e.data.endDate),
        venue_name:     e.data.location ?? null,
        venue_address:  e.data.address ?? null,
        latitude:       lat,
        longitude:      lng,
        image_url:      absolutise(e.data.image),
        event_url:      e.data.url ?? null,
        category:       e.data.category ?? null,
        // Featured OR Sponsored/Spotlight → paid spotlight in the hub feed.
        sponsored:      e.data.isSponsored === true || e.data.featured === true,
      };
    }));
  } catch {
    // events collection empty / unavailable — emit an empty feed, never 500.
  }

  return new Response(JSON.stringify({ events }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Server-to-server today, but permit client-side reads too (e.g. sidebars).
      "access-control-allow-origin": "*",
    },
  });
};
