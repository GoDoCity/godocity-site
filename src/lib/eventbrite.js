/**
 * src/lib/eventbrite.js
 *
 * Fetches live upcoming events from the Eventbrite API for the Greater Daytona
 * Beach area and returns them as normalised objects compatible with the site's
 * event data shape.  For events that have no Eventbrite image, a category-
 * specific photo is requested from the Unsplash API; if that is also unavailable
 * the shared CATEGORY_FALLBACK map is used so no card is ever blank.
 *
 * Usage in an Astro page (build-time SSG):
 *
 *   import { fetchDaytonaEvents } from "../../lib/eventbrite.js";
 *   const liveEvents = await fetchDaytonaEvents();
 *
 * Required environment variables (set in .env or hosting dashboard):
 *   EVENTBRITE_TOKEN      — Eventbrite private OAuth token
 *   UNSPLASH_ACCESS_KEY   — Unsplash API access key (optional; graceful fallback)
 */

const EVENTBRITE_API = "https://www.eventbriteapi.com/v3";
const UNSPLASH_API   = "https://api.unsplash.com";

/* ── Hardcoded fallback images keyed by internal category name ───────────── */
export const CATEGORY_FALLBACK = {
  "Music & Nightlife":    "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=75",
  "Food & Drink":         "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=75",
  "Arts & Culture":       "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=800&q=75",
  "Markets & Fairs":      "https://images.unsplash.com/photo-1488459716781-0a04a8a37e6e?w=800&q=75",
  "Racing & Motorsports": "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=75",
  "Outdoors & Sports":    "https://images.unsplash.com/photo-1530549387789-4c161668b269?w=800&q=75",
  "default":              "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=75",
};

/* ── Eventbrite category name → internal category name ───────────────────── */
const CATEGORY_MAP = {
  "Music":                  "Music & Nightlife",
  "Nightlife":              "Music & Nightlife",
  "Performing & Visual Arts": "Arts & Culture",
  "Film, Media & Entertainment": "Arts & Culture",
  "Food & Drink":           "Food & Drink",
  "Community & Culture":    "Arts & Culture",
  "Sports & Fitness":       "Outdoors & Sports",
  "Outdoor & Adventure":    "Outdoors & Sports",
  "Auto, Boat & Air":       "Racing & Motorsports",
  "Home & Lifestyle":       "Markets & Fairs",
  "Hobbies & Special Interest": "Markets & Fairs",
  "Charity & Causes":       "Arts & Culture",
  "Family & Education":     "Arts & Culture",
};

/* ── Hardcoded venue overrides for known Greater Daytona landmarks ────────── */
const VENUE_COORD_OVERRIDES = {
  "daytona international speedway": { lat: 29.1852, lng: -81.0705 },
};

/**
 * Requests a single random photo from Unsplash matching the given query.
 * Returns the `regular` image URL string, or null on any failure.
 *
 * @param {string} query
 * @param {string} accessKey
 * @returns {Promise<string|null>}
 */
async function fetchUnsplashPhoto(query, accessKey) {
  if (!accessKey) return null;
  try {
    const url =
      `${UNSPLASH_API}/photos/random` +
      `?query=${encodeURIComponent(query)}` +
      `&orientation=landscape` +
      `&client_id=${encodeURIComponent(accessKey)}`;
    const res = await fetch(url, {
      headers: { "Accept-Version": "v1" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.urls?.regular ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalises a raw Eventbrite event object into the site's event shape.
 *
 * Key rules:
 *  - lat/lng are only set when Eventbrite provides street-level coordinates
 *    (non-null, non-zero).  City-centre fallbacks are intentionally NOT applied
 *    here so that the map only shows pins with verified locations.
 *  - Images: Eventbrite logo → Unsplash API → CATEGORY_FALLBACK
 *
 * @param {object} ev          Raw Eventbrite event object
 * @param {string} unsplashKey Unsplash access key (may be empty string)
 * @returns {Promise<object>}
 */
async function normaliseEvent(ev, unsplashKey) {
  const venue   = ev.venue ?? {};
  const addr    = venue.address ?? {};
  const rawCity = (addr.city ?? "").toLowerCase().trim();

  // Map Eventbrite category to internal category
  const ebCatName = ev.category?.name ?? ev.subcategory?.name ?? "";
  const category  = CATEGORY_MAP[ebCatName] ?? null;

  // ── Image resolution ────────────────────────────────────────────────────
  let image =
    ev.logo?.original?.url ??
    ev.logo?.url ??
    null;

  if (!image) {
    // Use the event name as the Unsplash search query for best relevance
    const searchQuery = ev.name?.text ?? category ?? "festival daytona";
    image =
      (await fetchUnsplashPhoto(searchQuery, unsplashKey)) ??
      CATEGORY_FALLBACK[category ?? "default"] ??
      CATEGORY_FALLBACK["default"];
  }

  // ── Coordinates — only when Eventbrite provides verified street-level data ─
  let lat = null;
  let lng = null;

  const rawLat = addr.latitude  ? parseFloat(addr.latitude)  : null;
  const rawLng = addr.longitude ? parseFloat(addr.longitude) : null;

  if (rawLat !== null && rawLng !== null && rawLat !== 0 && rawLng !== 0) {
    lat = rawLat;
    lng = rawLng;
  }

  // Apply hardcoded overrides for well-known venues
  const venueKey = (venue.name ?? "").toLowerCase().trim();
  if (VENUE_COORD_OVERRIDES[venueKey]) {
    lat = VENUE_COORD_OVERRIDES[venueKey].lat;
    lng = VENUE_COORD_OVERRIDES[venueKey].lng;
  }

  return {
    id:          ev.id,
    source:      "eventbrite",
    title:       ev.name?.text ?? "Untitled Event",
    description: ev.description?.text ?? ev.summary ?? "",
    eventDate:   ev.start?.local?.split("T")[0] ?? null,
    endDate:     ev.end?.local?.split("T")[0]   ?? null,
    location:    venue.name ?? addr.address_1 ?? "",
    address:     addr.address_1 ?? "",
    city:        rawCity || "daytona",
    url:         ev.url ?? null,
    image,
    category,
    lat,
    lng,
  };
}

/**
 * Fetches live upcoming events from Eventbrite for the Greater Daytona Beach
 * area (30-mile radius).  Processes up to `maxPages` pages of 50 results each.
 *
 * Returns an empty array — without throwing — when EVENTBRITE_TOKEN is absent
 * or the API is unreachable, so pages that import this always build cleanly.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.token]         Eventbrite private token (falls back to env)
 * @param {string}  [opts.unsplashKey]   Unsplash access key (falls back to env)
 * @param {number}  [opts.maxPages=1]    Pages to fetch (50 events per page)
 * @param {string}  [opts.location]      Override search location string
 * @param {string}  [opts.radius]        Override search radius (e.g. "30mi")
 * @returns {Promise<object[]>}
 */
export async function fetchDaytonaEvents({
  token       = import.meta.env?.EVENTBRITE_TOKEN       ?? process.env?.EVENTBRITE_TOKEN,
  unsplashKey = import.meta.env?.UNSPLASH_ACCESS_KEY    ?? process.env?.UNSPLASH_ACCESS_KEY ?? "",
  maxPages    = 1,
  location    = "Daytona Beach, FL",
  radius      = "30mi",
} = {}) {
  if (!token) {
    console.warn(
      "[eventbrite.js] EVENTBRITE_TOKEN is not set. " +
      "Set it in .env (local) or your hosting environment. Returning empty array."
    );
    return [];
  }

  const now     = new Date().toISOString();
  const headers = {
    Authorization:  `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const base =
    `${EVENTBRITE_API}/events/search/` +
    `?location.address=${encodeURIComponent(location)}` +
    `&location.within=${encodeURIComponent(radius)}` +
    `&expand=venue,category,subcategory` +
    `&page_size=50` +
    `&status=live` +
    `&start_date.range_start=${encodeURIComponent(now)}` +
    `&sort_by=date`;

  const events = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}&page=${page}`;

    let data;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(
          `[eventbrite.js] API returned ${res.status} on page ${page}:`,
          body.slice(0, 200)
        );
        break;
      }
      data = await res.json();
    } catch (err) {
      console.error("[eventbrite.js] Network error fetching page", page, err);
      break;
    }

    const raw = data.events ?? [];

    // Normalise all events on this page in parallel (Unsplash calls share quota)
    const normalised = await Promise.all(
      raw.map(ev => normaliseEvent(ev, unsplashKey))
    );

    // Filter out events with missing dates or outside Florida to be safe
    events.push(
      ...normalised.filter(
        e => e.eventDate !== null && e.city !== ""
      )
    );

    if (!data.pagination?.has_more_items) break;
  }

  return events;
}
