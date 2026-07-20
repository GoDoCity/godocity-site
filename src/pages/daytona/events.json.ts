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

export const prerender = true;

const ORIGIN = "https://godocity-site.pages.dev";

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
    const all = await getCollection("events");
    events = all
      .filter((e: any) => (e.data.city ?? "").toLowerCase().trim() === "daytona")
      .map((e: any) => ({
        id:             `cms-${e.slug.split("/").pop()}`,
        market_id:      "daytona",
        title:          e.data.title,
        description:    e.data.description ?? null,
        start_datetime: toIso(e.data.eventDate),
        end_datetime:   toIso(e.data.endDate),
        venue_name:     e.data.location ?? null,
        venue_address:  e.data.address ?? null,
        image_url:      absolutise(e.data.image),
        event_url:      e.data.url ?? null,
        category:       e.data.category ?? null,
        // Featured OR Sponsored/Spotlight → paid spotlight in the hub feed.
        sponsored:      e.data.isSponsored === true || e.data.featured === true,
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
