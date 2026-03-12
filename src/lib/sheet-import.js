/**
 * src/lib/sheet-import.js
 *
 * Build-time event importer — two sources merged into one array:
 *
 *  1. Google Sheet  (SHEET_CSV_URL)
 *     Manual curation. Column C "Sponsored" = imported + featured at top.
 *     Column C "Live"      = imported as a regular event.
 *     Sheet always wins on dedup — any event ID in the sheet overrides the
 *     auto-discovered version entirely.
 *
 *  2. Eventbrite Search API  (EVENTBRITE_TOKEN)
 *     Auto-discovers all public events within 20mi of Daytona Beach center.
 *     Up to 150 events (3 pages × 50). Filtered to start >= today.
 *     Deduped against sheet by Eventbrite ID. Never marked sponsored.
 *
 * Coordinate resolution (per event, highest priority first):
 *   1. Eventbrite venue.address.latitude / longitude  (exact geocode from EB)
 *   2. Mapbox Geocoding API fallback when (0,0) or missing  (MAPBOX_ACCESS_TOKEN)
 *
 * Sheet column layout:
 *   A (col 0) — Eventbrite URL   (required)
 *   B (col 1) — Title override   (optional)
 *   C (col 2) — Status           ("Live" | "Sponsored")
 */

const CSV_TIMEOUT_MS = 12_000;
const API_TIMEOUT_MS =  8_000;
const GEO_TIMEOUT_MS =  5_000;
const SEARCH_PAGES   =  3;       // 3 pages × 50 = up to 150 auto-discovered events
const UA = "Mozilla/5.0 (compatible; GodoCityBot/1.0; +https://godocity.com)";

const EB_ID_RE = /eventbrite\.com\/e\/[^/?#]+-(\d{5,})/i;

/* Daytona Beach center — used for search radius and Mapbox proximity bias */
const DAYTONA_LAT =  29.2108;
const DAYTONA_LNG = -81.0228;

/**
 * Main entry point.
 *
 * @param {string} csvUrl          Public CSV export URL from Google Sheets.
 * @param {string} eventbriteToken Eventbrite Private Token.
 * @param {string} mapboxToken     Mapbox Access Token (geocode fallback).
 * @returns {Promise<object[]>}    Merged event array, sheet events first.
 */
export async function importFromSheet(csvUrl, eventbriteToken = "", mapboxToken = "") {
  if (!csvUrl) {
    console.log("[sheet-import] ERROR: SHEET_CSV_URL not set — import skipped");
    return [];
  }
  if (!eventbriteToken) {
    console.log("[sheet-import] WARNING: EVENTBRITE_TOKEN not set — API calls will fail");
  }

  // ── 1. Fetch and parse the Google Sheet CSV ────────────────────────────────
  let csvText;
  try {
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`[sheet-import] Sheet fetch → HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    csvText = await res.text();
  } catch (err) {
    console.log(`[sheet-import] Sheet fetch failed: ${err?.message ?? err}`);
    return [];
  }

  console.log(`[sheet-import] Payload preview: ${csvText.slice(0, 100).replace(/\n/g, "↵")}`);

  const rows = parseCsv(csvText);

  /* Detect whether a Status column ("Live" / "Sponsored") is in use */
  const hasStatusCol = rows.some(row => {
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (!cells.length || isHeadingRow(cells[0], cells)) return false;
    return cells.some(c => /^(live|sponsored)$/i.test(c));
  });

  /* Build sheetMeta: eventbriteId → { titleOverride, isSponsored, isLive, url } */
  const sheetMeta = new Map();
  let firstDataRow = true;

  for (const row of rows) {
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (!cells.length || isHeadingRow(cells[0], cells)) continue;

    if (firstDataRow) {
      console.log(`[sheet-import] First data row: ${JSON.stringify(cells.slice(0, 4))}`);
      firstDataRow = false;
    }

    const isLive      = hasStatusCol ? cells.some(c => /^(live|sponsored)$/i.test(c)) : true;
    const isSponsored = cells.some(c => /^sponsored$/i.test(c));

    const url = cells.find(c => /^https?:\/\//i.test(c)) ?? null;
    if (!url) continue;

    const idMatch = url.match(EB_ID_RE);
    if (!idMatch) { console.log(`[sheet-import] Skipping non-Eventbrite URL: ${url}`); continue; }

    const rawCells = row.map(c => c.trim());
    const colB = rawCells[1] ?? "";
    const titleOverride =
      colB && !/^https?:\/\//i.test(colB) && !/^(live|sponsored)$/i.test(colB) && colB.length > 1
        ? colB : null;

    sheetMeta.set(idMatch[1], { titleOverride, isSponsored, isLive, url });
  }

  // ── 2. Fetch Eventbrite API data for each Live sheet event ─────────────────
  const sheetEvents = [];

  for (const [id, meta] of sheetMeta) {
    if (!meta.isLive) continue;

    const api = await fetchEventbriteAPI(id, eventbriteToken);
    const title     = meta.titleOverride ?? api.title ?? `Eventbrite Event ${id}`;
    const eventDate = api.eventDate ?? null;

    if (!eventDate) {
      console.log(`[sheet-import] No date for "${title}" (${id}) — skipping`);
      continue;
    }

    const coords = await resolveVenueCoords(api._venue, mapboxToken, title);
    console.log(`[EVENTBRITE API] Successfully fetched '${title}' using private token`);

    sheetEvents.push(makeEvent({
      title,
      eventDate,
      endDate:   api.endDate  ?? null,
      location:  api.location ?? "",
      city:      api.city     ?? "daytona beach",
      url:       meta.url,
      image:     api.image    ?? "/images/daytona-placeholder.jpg",
      category:  api.category ?? null,
      lat:       coords?.lat  ?? null,
      lng:       coords?.lng  ?? null,
      sponsored: meta.isSponsored,
      source:    "eventbrite-sheet",
    }));
  }

  // ── 3. Auto-discover nearby events via Eventbrite Search API ──────────────
  const sheetIds      = new Set(sheetMeta.keys());
  const searchResults = await searchNearbyEvents(eventbriteToken);

  const discoveredEvents = [];
  for (const item of searchResults) {
    /* Sheet version always takes priority — skip if already in the sheet */
    if (sheetIds.has(item.id)) continue;

    const title     = item.name?.text ?? "Untitled Event";
    const eventDate = item.start?.local?.slice(0, 10) ?? null;
    if (!eventDate) continue;

    const endDateRaw = item.end?.local?.slice(0, 10);
    const endDate    = endDateRaw && endDateRaw !== eventDate ? endDateRaw : null;

    const coords = await resolveVenueCoords(item.venue, mapboxToken, title);

    let image = "/images/daytona-placeholder.jpg";
    if (item.logo?.original?.url) image = item.logo.original.url;
    else if (item.logo?.url)      image = item.logo.url;

    discoveredEvents.push(makeEvent({
      title,
      eventDate,
      endDate,
      location: item.venue?.name ?? "",
      city:     (item.venue?.address?.city ?? "daytona beach").toLowerCase(),
      url:      item.url ?? null,
      image,
      category: item.category?.name ?? null,
      lat:      coords?.lat ?? null,
      lng:      coords?.lng ?? null,
      sponsored: false,
      source:   "eventbrite-discovered",
    }));
  }

  console.log(
    `[sheet-import] SUCCESS: ${sheetEvents.length} sheet events + ` +
    `${discoveredEvents.length} auto-discovered`
  );
  /* Sheet events come first — they contain Sponsored entries that must lead */
  return [...sheetEvents, ...discoveredEvents];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function makeEvent({ title, eventDate, endDate, location, city, url, image, category, lat, lng, sponsored, source }) {
  return {
    title,
    eventDate,
    endDate:   endDate   ?? null,
    location:  location  ?? "",
    city:      city      ?? "daytona beach",
    url:       url       ?? null,
    image:     image     ?? "/images/daytona-placeholder.jpg",
    category:  category  ?? null,
    lat:       lat       ?? null,
    lng:       lng       ?? null,
    sponsored: !!sponsored,
    source,
  };
}

/**
 * Fetch a single event from the Eventbrite REST API v3.
 * Returns a partial object; _venue carries the raw venue for coord resolution.
 */
async function fetchEventbriteAPI(eventId, token) {
  if (!token) {
    console.log(`[sheet-import] API skipped for ${eventId} — no token`);
    return {};
  }
  try {
    const res = await fetch(
      `https://www.eventbriteapi.com/v3/events/${eventId}/?expand=venue,logo,category`,
      {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      console.log(`[sheet-import] API ${eventId} → HTTP ${res.status} — skipping`);
      return {};
    }
    const data   = await res.json();
    const result = {};

    if (data.name?.text) result.title = data.name.text;

    if (data.start?.local) result.eventDate = data.start.local.slice(0, 10);
    if (data.end?.local) {
      const end = data.end.local.slice(0, 10);
      if (end !== result.eventDate) result.endDate = end;
    }

    if (data.venue) {
      result._venue   = data.venue;
      result.location = data.venue.name ?? "";
      result.city     = (data.venue.address?.city ?? "daytona beach").toLowerCase();
    }

    if (data.logo?.original?.url) result.image = data.logo.original.url;
    else if (data.logo?.url)      result.image = data.logo.url;

    if (data.category?.name) result.category = data.category.name;

    return result;
  } catch (err) {
    console.log(`[sheet-import] API ${eventId} failed: ${err?.message ?? err}`);
    return {};
  }
}

/**
 * Search the Eventbrite API for public events within 20 miles of Daytona Beach.
 * Fetches up to SEARCH_PAGES pages (50 results each). Returns raw API event objects.
 */
async function searchNearbyEvents(token) {
  if (!token) {
    console.log("[sheet-import] Auto-discovery skipped — no Eventbrite token");
    return [];
  }

  /* ISO 8601 start of today (UTC) so we don't surface past events */
  const today = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const allEvents = [];

  for (let page = 1; page <= SEARCH_PAGES; page++) {
    try {
      const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
      url.searchParams.set("location.latitude",       String(DAYTONA_LAT));
      url.searchParams.set("location.longitude",      String(DAYTONA_LNG));
      url.searchParams.set("location.within",         "20mi");
      url.searchParams.set("expand",                  "venue,logo,category");
      url.searchParams.set("sort_by",                 "date");
      url.searchParams.set("start_date.range_start",  today);
      url.searchParams.set("page_size",               "50");
      url.searchParams.set("page",                    String(page));

      const res = await fetch(url.toString(), {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.log(`[sheet-import] Search page ${page} → HTTP ${res.status} — stopping`);
        break;
      }

      const data   = await res.json();
      const events = data.events ?? [];
      allEvents.push(...events);
      console.log(`[sheet-import] Search page ${page}: ${events.length} events found`);

      if (!data.pagination?.has_more_items) break;
    } catch (err) {
      console.log(`[sheet-import] Search page ${page} error: ${err?.message ?? err} — stopping`);
      break;
    }
  }

  console.log(`[sheet-import] Auto-discovery total: ${allEvents.length} events`);
  return allEvents;
}

/**
 * Resolve lat/lng for a venue object.
 * Priority: (1) Eventbrite venue coordinates → (2) Mapbox geocode fallback.
 *
 * @param {object|null} venue       Raw Eventbrite venue object.
 * @param {string}      mapboxToken Mapbox Access Token.
 * @param {string}      eventTitle  Used as last-resort geocode query.
 * @returns {{ lat: number, lng: number } | { lat: null, lng: null }}
 */
async function resolveVenueCoords(venue, mapboxToken, eventTitle = "") {
  if (!venue) return { lat: null, lng: null };

  /* 1. Prefer Eventbrite's own geocoded coordinates */
  const rawLat = parseFloat(venue.address?.latitude  ?? "");
  const rawLng = parseFloat(venue.address?.longitude ?? "");
  if (!isNaN(rawLat) && !isNaN(rawLng) && (rawLat !== 0 || rawLng !== 0)) {
    console.log(
      `[sheet-import] Venue coords for "${venue.name ?? "?"}" → ` +
      `${rawLat.toFixed(4)}, ${rawLng.toFixed(4)}`
    );
    return { lat: rawLat, lng: rawLng };
  }

  /* 2. Mapbox geocode fallback — build the most specific query available */
  if (!mapboxToken) {
    console.log(`[sheet-import] No coords for "${venue.name ?? eventTitle}" and no Mapbox token — pin omitted`);
    return { lat: null, lng: null };
  }

  const addrDisplay = venue.address?.localized_address_display ?? "";
  const venueName   = venue.name ?? "";
  const hasFL       = /\bfl\b|\bflorida\b/i.test(`${addrDisplay} ${venueName}`);

  const query = addrDisplay
    ? (hasFL ? addrDisplay : `${addrDisplay}, FL`)
    : venueName
    ? `${venueName}, Daytona Beach, FL`
    : eventTitle
    ? `${eventTitle}, Daytona Beach, FL`
    : null;

  if (!query) return { lat: null, lng: null };

  console.log(`[sheet-import] No venue coords — geocoding: "${query}"`);
  return (await geocode(query, mapboxToken)) ?? { lat: null, lng: null };
}

/**
 * Geocode a text query using the Mapbox Geocoding API, biased to the greater
 * Daytona Beach / Volusia County area. Returns { lat, lng } or null.
 */
async function geocode(query, mapboxToken) {
  if (!query || !mapboxToken) return null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?access_token=${mapboxToken}` +
      `&limit=1` +
      `&bbox=-82.5,28.3,-80.3,30.2` +           // Volusia + Flagler counties
      `&proximity=${DAYTONA_LNG},${DAYTONA_LAT}` + // bias toward Daytona center
      `&types=poi,address,place,neighborhood`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data    = await res.json();
    const feature = data.features?.[0];
    if (!feature) {
      console.log(`[sheet-import] Geocode: no result for "${query}"`);
      return null;
    }

    const [lng, lat] = feature.center;
    console.log(
      `[sheet-import] Geocoded "${query}" → ${lat.toFixed(4)}, ${lng.toFixed(4)} ` +
      `(${feature.place_name})`
    );
    return { lat, lng };
  } catch (err) {
    console.log(`[sheet-import] Geocode error for "${query}": ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Returns true for rows that are clearly headings or label rows, not event data.
 */
function isHeadingRow(firstCell, cells) {
  if (cells.length === 1 && !/^https?:\/\//i.test(firstCell)) return true;
  if (/^(url|event|title|name|raw\s*text|status|description|date)$/i.test(firstCell)) return true;
  if (/godo(daytona|city)/i.test(firstCell)) return true;
  return false;
}

/** Minimal CSV parser — handles double-quoted fields with internal commas. */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cols.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}
