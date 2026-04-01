/**
 * src/lib/sheet-import.js
 *
 * Build-time event importer — two sources merged into one array:
 *
 *  1. Google Sheet  (SHEET_CSV_URL)
 *     Manual curation. Column B "Sponsored" = imported + featured at top.
 *     Column B "Live"      = imported as a regular event.
 *     Column D (col 3)     = explicit address override — geocoded via Mapbox,
 *                            overrides ALL other coordinate sources.
 *     Sheet always wins on dedup — any event ID in the sheet overrides the
 *     auto-discovered version entirely.
 *
 *     Non-Eventbrite events (major festivals, speedway races, etc.) are also
 *     supported: leave Column A empty and put the event URL in Column G.
 *     The script will import the row using Column G as the "Learn More" link,
 *     Column H for the featured image (with og:image fetch fallback), and
 *     Column I for a human-readable multi-day display string (e.g. "May 7-10").
 *
 *  2. Eventbrite Destination Search API  (EVENTBRITE_TOKEN)
 *     Auto-discovers all public events within 25mi of Daytona Beach center
 *     using /v3/destination/events/.
 *     Up to 150 events (3 pages × 50). Filtered to start >= today.
 *     Deduped against sheet by Eventbrite ID. Never marked sponsored.
 *
 * Coordinate resolution (per event, highest priority first):
 *   1. Column D address override in Google Sheet  (geocoded via Mapbox)
 *   2. Eventbrite venue.address.latitude / longitude  (exact geocode from EB)
 *      — REJECTED if (0,0) or within a Water Zone (Halifax River / Atlantic Ocean)
 *   3. Mapbox Geocoding API fallback  (MAPBOX_ACCESS_TOKEN)
 *      — Query is "VenueName Daytona Beach, FL" for water-zone rescues
 *
 * Sheet column layout:
 *   A (col  0) — Eventbrite URL        (optional — leave empty for non-EB events)
 *   B (col  1) — Status                ("Live" | "Sponsored")
 *   C (col  2) — Date Override         Plain text sort date; overrides Eventbrite date
 *   D (col  3) — Location / Address    Address string; overrides venue geocode
 *   E (col  4) — Image Override        Optional image URL for Eventbrite events
 *   F (col  5) — Title Override        Optional title override
 *   G (col  6) — Manual URL            Non-Eventbrite "Learn More" link
 *                                       (used when Column A has no valid Eventbrite ID)
 *   H (col  7) — Manual Image URL      Featured image for non-Eventbrite events
 *                                       (falls back to og:image scrape of Col G URL)
 *   I (col  8) — Display Date          Human-readable multi-day label shown on event
 *                                       cards, e.g. "May 7-10". Column C is still used
 *                                       for calendar sorting.
 */

const CSV_TIMEOUT_MS = 12_000;
const API_TIMEOUT_MS =  8_000;
const GEO_TIMEOUT_MS =  5_000;
const SEARCH_PAGES   =  3;       // 3 pages × 50 = up to 150 auto-discovered events

/* Eventbrite category IDs included in auto-discovery searches.
 * Focuses results on leisure/community events relevant to a city guide.
 * IDs: 103 Music, 105 Performing & Visual Arts, 108 Sports & Fitness,
 *      109 Travel & Outdoor, 110 Food & Drink, 113 Community & Culture,
 *      115 Family & Education, 116 Seasonal & Holiday, 118 Auto/Boat/Air,
 *      119 Hobbies & Special Interest */
const DISCOVERY_CATEGORY_IDS = [
  "103",  // Music
  "105",  // Performing & Visual Arts
  "108",  // Sports & Fitness
  "109",  // Travel & Outdoor
  "110",  // Food & Drink
  "113",  // Community & Culture
  "115",  // Family & Education
  "116",  // Seasonal & Holiday
  "118",  // Auto, Boat & Air
  "119",  // Hobbies & Special Interest
].join(",");
const UA = "Mozilla/5.0 (compatible; GodoCityBot/1.0; +https://godocity.com)";

const EB_ID_RE = /eventbrite\.com\/e\/[^/?#]+-(\d{5,})/i;

/* Daytona Beach center — used for search radius and Mapbox proximity bias */
const DAYTONA_LAT =  29.2108;
const DAYTONA_LNG = -81.0228;

/**
 * Water Zone bounding boxes — Daytona Beach area.
 * Coordinates that fall inside these boxes are treated as bad/ocean defaults
 * and trigger a Mapbox venue-name geocode instead.
 *
 *   Halifax River / Intracoastal Waterway:
 *     Runs N–S through the heart of Daytona, lng ≈ -81.035 to -81.012.
 *   Atlantic Ocean (east of barrier island):
 *     Anything east of ~lng -80.995 at these latitudes is open water.
 *
 * Note: The barrier island itself (hotels, beach venues) sits between the two
 * zones (lng ≈ -81.012 to -80.995) and is intentionally NOT flagged.
 */
const WATER_ZONES = [
  { minLat: 29.10, maxLat: 29.50, minLng: -81.035, maxLng: -81.012 }, // Halifax River
  { minLat: 29.10, maxLat: 29.50, minLng: -80.995, maxLng: -80.850 }, // Atlantic Ocean
];

function isInWaterZone(lat, lng) {
  if (lat === 0 && lng === 0) return true; // null-island / Eventbrite default
  return WATER_ZONES.some(z =>
    lat >= z.minLat && lat <= z.maxLat &&
    lng >= z.minLng && lng <= z.maxLng
  );
}

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

  /*
   * Sheet column layout (fixed positions):
   *   A  (col  0) — Eventbrite URL        (optional — leave empty for non-EB events)
   *   B  (col  1) — Status                "Live" | "Sponsored"
   *   C  (col  2) — Date Override         Plain text sort date; overrides Eventbrite date
   *   D  (col  3) — Location / Address    Address string; overrides venue geocode
   *   E  (col  4) — Image Override        Optional image URL for Eventbrite events
   *   F  (col  5) — Title Override        Optional title override
   *   G  (col  6) — Manual URL            Non-Eventbrite "Learn More" link
   *   H  (col  7) — Manual Image URL      Featured image for non-Eventbrite events
   *   I  (col  8) — Display Date          Human-readable label for event cards
   *                                        e.g. "May 7-10" (Col C still used for sorting)
   */

  /* Build sheetMeta: eventbriteId → { ... } for Eventbrite-backed rows.
     Build manualMeta: Array<{ ... }>           for non-Eventbrite rows (Col G URL). */
  const sheetMeta  = new Map();
  const manualMeta = [];
  let firstDataRow = true;

  for (const row of rows) {
    const rawCells = row.map(c => c.trim());
    if (!rawCells.some(Boolean)) continue;                          // skip blank rows
    if (isHeadingRow(rawCells[0], rawCells.filter(Boolean))) continue;

    if (firstDataRow) {
      console.log(`[sheet-import] First data row: ${JSON.stringify(rawCells.slice(0, 7))}`);
      firstDataRow = false;
    }

    /* Col A — Eventbrite URL (optional) */
    const ebUrl    = rawCells[0] ?? "";
    const idMatch  = ebUrl.match(EB_ID_RE);
    const hasEbId  = !!idMatch;

    /* Col G — Manual URL for non-Eventbrite events */
    const manualUrl   = rawCells[6] ?? "";
    const hasManualUrl = /^https?:\/\//i.test(manualUrl);

    /* Skip rows that have neither a valid Eventbrite ID nor a manual URL */
    if (!hasEbId && !hasManualUrl) {
      if (ebUrl) console.log(`[sheet-import] Skipping row — no valid Eventbrite ID or manual URL: "${ebUrl}"`);
      continue;
    }

    /* Col B — Status */
    const statusCell  = rawCells[1] ?? "";
    const isLive      = /^(live|sponsored)$/i.test(statusCell);
    const isSponsored = /^sponsored$/i.test(statusCell);

    /* Col C — Date Override (plain-text date; empty = use Eventbrite date for EB events) */
    const dateOverride = rawCells[2] || null;

    /* Col D — Location / Address Override */
    const addressOverride = rawCells[3] || null;

    /* Col E — Image Override (Eventbrite events; must look like a URL) */
    const imageOverride = (rawCells[4] && /^https?:\/\//i.test(rawCells[4]))
      ? rawCells[4] : null;

    /* Col F — Title Override */
    const titleOverride = rawCells[5] || null;

    /* Col H — Manual Image URL (non-Eventbrite events; image link ending in common extensions
       or any https URL accepted — og:image is fetched as fallback if this is empty) */
    const manualImageUrl = (rawCells[7] && /^https?:\/\//i.test(rawCells[7]))
      ? rawCells[7] : null;

    /* Col I — Display Date (human-readable multi-day label, e.g. "May 7-10") */
    const displayDate = rawCells[8] || null;

    if (hasEbId) {
      /* ── Eventbrite-backed row ── */
      if (addressOverride) {
        console.log(`[sheet-import] Col-D address override for event ${idMatch[1]}: "${addressOverride}"`);
      }
      sheetMeta.set(idMatch[1], {
        titleOverride, isSponsored, isLive,
        url: ebUrl,
        addressOverride, dateOverride, imageOverride,
        displayDate,
      });
    } else {
      /* ── Non-Eventbrite row (manual event) ── */
      manualMeta.push({
        titleOverride, isSponsored, isLive,
        manualUrl,
        addressOverride, dateOverride,
        manualImageUrl,
        displayDate,
      });
    }
  }

  // ── 2. Fetch Eventbrite API data for each Live sheet event ─────────────────
  const sheetEvents = [];

  for (const [id, meta] of sheetMeta) {
    /* ── Diagnostic: log every non-live row so missing events are traceable ── */
    if (!meta.isLive) {
      console.log(`[sheet-import] SKIP ${id} (${meta.url}): status not Live/Sponsored`);
      continue;
    }

    const api = await fetchEventbriteAPI(id, eventbriteToken);

    /* null = event definitively gone from Eventbrite — drop entirely */
    if (api === null) {
      console.log(`[sheet-import] DROP ${id}: event not found on Eventbrite — removed from build`);
      continue;
    }

    const title = meta.titleOverride ?? api.title ?? `Eventbrite Event ${id}`;

    /* ── Resolve event date — 3-tier with fallbacks, NEVER skip Live/Sponsored ── */
    let eventDate = null;

    if (meta.dateOverride) {
      eventDate = parseOverrideDate(meta.dateOverride);
      if (!eventDate) {
        // Override was set but unparseable — warn loudly; fall through to API date
        console.log(
          `[sheet-import] WARN ${id} "${title}": Col-C override "${meta.dateOverride}" ` +
          `could not be parsed — falling back to Eventbrite API date. Fix the date format.`
        );
      }
    }

    if (!eventDate) {
      // No override (or override failed) — use the API date if available
      if (api.eventDate) {
        // Compare against today in EST so events don't disappear 4–5 h early on a UTC server
        const todayEst = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        if (api.eventDate < todayEst) {
          // Event date is strictly before today in EST — skip it.
          // Add a Date Override in Col C to keep a recurring event in the feed.
          console.log(
            `[sheet-import] SKIP ${id} "${title}": Eventbrite date ${api.eventDate} is before ` +
            `today (${todayEst} EST) and no Date Override was set in Col C — excluded from feed.`
          );
          continue;
        } else {
          eventDate = api.eventDate + "T12:00:00.000Z";
        }
      }
    }

    if (!eventDate) {
      // No date from any source (API error + no override) — still include the event
      const fallback = new Date();
      fallback.setUTCHours(12, 0, 0, 0);
      eventDate = fallback.toISOString();
      console.log(
        `[sheet-import] WARN ${id} "${title}": no date available (API may have failed, ` +
        `no Col-C override set) — using today as fallback. Add a Date Override in Col C.`
      );
    }

    const coords = await resolveVenueCoords(api._venue, mapboxToken, title, meta.addressOverride);
    console.log(`[sheet-import] OK ${id} "${title}" → ${eventDate}`);

    sheetEvents.push(makeEvent({
      title,
      eventDate,
      displayDate: meta.displayDate ?? null,
      endDate:   api.endDate  ?? null,
      location:  api.location ?? "",
      city:      api.city     ?? "daytona beach",
      url:       meta.url,
      image:     meta.imageOverride ?? api.image ?? "/images/daytona-placeholder.jpg",
      category:  api.category ?? null,
      lat:       coords?.lat  ?? null,
      lng:       coords?.lng  ?? null,
      sponsored: meta.isSponsored,
      proTip:    null,
      source:    "eventbrite-sheet",
    }));
  }

  // ── 2b. Process non-Eventbrite (manual) sheet rows ────────────────────────
  for (const meta of manualMeta) {
    if (!meta.isLive) {
      console.log(`[sheet-import] SKIP manual event "${meta.manualUrl}": status not Live/Sponsored`);
      continue;
    }

    const title = meta.titleOverride ?? "Untitled Event";

    /* Date: Col C override required; warn + use today as fallback if missing */
    let eventDate = null;
    if (meta.dateOverride) {
      eventDate = parseOverrideDate(meta.dateOverride);
      if (!eventDate) {
        console.log(
          `[sheet-import] WARN manual "${title}": Col-C override "${meta.dateOverride}" ` +
          `could not be parsed — falling back to today. Fix the date format.`
        );
      }
    }

    if (!eventDate) {
      const fallback = new Date();
      fallback.setUTCHours(12, 0, 0, 0);
      eventDate = fallback.toISOString();
      console.log(
        `[sheet-import] WARN manual "${title}": no Col-C date set — using today as fallback. ` +
        `Add a date override in Col C.`
      );
    }

    /* Skip past events (same EST-aware logic as Eventbrite events) */
    const todayEstNow = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const sortDateStr = eventDate.slice(0, 10);
    if (sortDateStr < todayEstNow) {
      console.log(
        `[sheet-import] SKIP manual "${title}": date ${sortDateStr} is before ` +
        `today (${todayEstNow} EST) — excluded from feed.`
      );
      continue;
    }

    /* Image: Col L → og:image scrape of Col G URL → placeholder */
    let image = meta.manualImageUrl;
    if (!image) {
      console.log(`[sheet-import] Col H empty for manual "${title}" — fetching og:image from ${meta.manualUrl}`);
      image = await fetchOgImage(meta.manualUrl);
      if (image) {
        console.log(`[sheet-import] og:image for "${title}": ${image}`);
      } else {
        console.log(`[sheet-import] No og:image found for "${title}" — using placeholder`);
        image = "/images/daytona-placeholder.jpg";
      }
    }

    /* Geocode: Col D address override → Mapbox lookup by title */
    const coords = await resolveVenueCoords(null, mapboxToken, title, meta.addressOverride);
    console.log(`[sheet-import] OK manual "${title}" → ${eventDate}`);

    sheetEvents.push(makeEvent({
      title,
      eventDate,
      displayDate: meta.displayDate ?? null,
      endDate:   null,
      location:  meta.addressOverride ?? "",
      city:      "daytona beach",
      url:       meta.manualUrl,
      image,
      category:  null,
      lat:       coords?.lat ?? null,
      lng:       coords?.lng ?? null,
      sponsored: meta.isSponsored,
      proTip:    null,
      source:    "manual-sheet",
    }));
  }

  // ── 3. Auto-discover nearby events via Eventbrite Destination Search API ───
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

    /* No Column E override for auto-discovered events */
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

  /* ── 4. Expiry filter — hide events whose date is before today in EST ─────────
     Uses America/New_York so events stay visible until midnight EST (not midnight
     UTC), preventing events from vanishing 4–5 hours early on a UTC server.    */
  const todayEst = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  function isExpired(eventDate) {
    const dateStr = (eventDate || "").slice(0, 10); // "YYYY-MM-DD"
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    // Event is expired only when its calendar day has fully passed in EST
    return dateStr < todayEst;
  }

  const allMerged = [...sheetEvents, ...discoveredEvents];
  const liveEvents = allMerged.filter(e => {
    if (isExpired(e.eventDate)) {
      console.log(`[sheet-import] EXPIRED (>6h past end): "${e.title}" (${e.eventDate}) — hidden`);
      return false;
    }
    return true;
  });

  console.log(
    `[sheet-import] SUCCESS: ${sheetEvents.length} sheet events + ` +
    `${discoveredEvents.length} auto-discovered → ${liveEvents.length} after expiry filter`
  );
  /* Sheet events come first — they contain Sponsored entries that must lead */
  return liveEvents;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Given a 1-based month and 1-based day, return an ISO string at noon UTC.
 * If that date is already more than 1 day in the past, bump to next year
 * (handles short-form overrides like "MAR 28" or "6/10" without a year).
 */
function inferYear(month, day) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // If the date already passed (yesterday or earlier), assume next year
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (candidate < yesterday) {
    return new Date(Date.UTC(year + 1, month - 1, day, 12, 0, 0)).toISOString();
  }
  return candidate.toISOString();
}

/** Month abbreviation → 1-based number, covers 3-char prefixes of any case. */
const MONTH_ABBR = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

/**
 * Parse a plain-text date override from Col C into an ISO string (noon UTC).
 *
 * Supported formats (case-insensitive):
 *   • YYYY-MM-DD          e.g. "2026-03-28"
 *   • M/D/YYYY            e.g. "3/28/2026"   (Google Sheets default export)
 *   • M/D/YY              e.g. "3/28/26"
 *   • M/D                 e.g. "6/10"        (year inferred)
 *   • MMM D               e.g. "MAR 28"      (year inferred)
 *   • Month D, YYYY       e.g. "March 28, 2026"
 */
function parseOverrideDate(text) {
  if (!text) return null;
  const t = text.trim();

  // 1. ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return t + "T12:00:00.000Z";
  }

  // 2. M/D/YYYY — explicit 4-digit year (Google Sheets auto-format)
  const us4 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us4) {
    const [, mm, dd, yyyy] = us4;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T12:00:00.000Z`;
  }

  // 3. M/D/YY — 2-digit year (e.g. "6/10/26")
  const us2y = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (us2y) {
    const [, mm, dd, yy] = us2y;
    const yyyy = 2000 + parseInt(yy, 10);
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T12:00:00.000Z`;
  }

  // 4. M/D — no year, e.g. "6/10" — infer year
  const us0y = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (us0y) {
    return inferYear(parseInt(us0y[1], 10), parseInt(us0y[2], 10));
  }

  // 5. "MAR 28" / "Mar 28" / "MARCH 28" — month name/abbrev + day, no year
  const monDay = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (monDay) {
    const abbr = monDay[1].slice(0, 3).toLowerCase();
    const day  = parseInt(monDay[2], 10);
    if (MONTH_ABBR[abbr]) return inferYear(MONTH_ABBR[abbr], day);
  }

  // 6. "28 MAR" / "28 March" — day-first format
  const dayMon = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/i);
  if (dayMon) {
    const abbr = dayMon[2].slice(0, 3).toLowerCase();
    const day  = parseInt(dayMon[1], 10);
    if (MONTH_ABBR[abbr]) {
      if (dayMon[3]) {
        const yyyy = parseInt(dayMon[3], 10);
        return new Date(Date.UTC(yyyy, MONTH_ABBR[abbr] - 1, day, 12)).toISOString();
      }
      return inferYear(MONTH_ABBR[abbr], day);
    }
  }

  // 7. Plain English with year: "March 28, 2026" / "Mar 28 2026" — V8 handles these
  const d = new Date(t);
  if (!isNaN(d.getTime())) {
    d.setUTCHours(12, 0, 0, 0);
    return d.toISOString();
  }

  console.log(`[sheet-import] WARN: unrecognised date override format: "${text}"`);
  return null;
}

function makeEvent({ title, eventDate, displayDate, endDate, location, city, url, image, category, lat, lng, sponsored, proTip, source }) {
  return {
    title,
    eventDate,
    displayDate: displayDate ?? null,   // Human-readable label for multi-day events (e.g. "May 7-10")
    endDate:   endDate   ?? null,
    location:  location  ?? "",
    city:      city      ?? "daytona beach",
    url:       url       ?? null,
    image:     image     ?? "/images/daytona-placeholder.jpg",
    category:  category  ?? null,
    lat:       lat       ?? null,
    lng:       lng       ?? null,
    sponsored: !!sponsored,
    proTip:    proTip    ?? null,
    source,
  };
}

/**
 * Fetch a single event from the Eventbrite REST API v3.
 *
 * Returns:
 *   - A partial event object on success (_venue carries the raw venue).
 *   - null  when the event definitively does not exist (404, deleted,
 *           unpublished, or Eventbrite error code). The caller MUST drop
 *           that sheet row so "Event Not Found" entries never reach the site.
 *   - {}    on transient failures (network timeout, no token) so the row
 *           is still included using whatever overrides are available.
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

    /* 404 / 403 / 410 = event gone or never existed — hard drop */
    if (res.status === 404 || res.status === 403 || res.status === 410) {
      console.log(`[sheet-import] DROP ${eventId} → HTTP ${res.status} (event not found / removed)`);
      return null;
    }

    if (!res.ok) {
      /* Other HTTP errors (5xx, rate-limit 429) — transient, keep the row */
      console.log(`[sheet-import] API ${eventId} → HTTP ${res.status} — transient error, keeping row`);
      return {};
    }

    /* Check Eventbrite's own error payload (200 OK with error body) */
    const data = await res.json();
    if (data.error) {
      /* "NOT_FOUND", "EVENT_DELETED", "ARGUMENTS_ERROR", etc. */
      const isGone = /not.?found|deleted|does.?not.?exist/i.test(data.error + " " + (data.error_description ?? ""));
      if (isGone) {
        console.log(`[sheet-import] DROP ${eventId} → EB error "${data.error}" (${data.error_description ?? ""})`);
        return null;
      }
      console.log(`[sheet-import] API ${eventId} → EB error "${data.error}" — keeping row`);
      return {};
    }
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
 * Search for public events within 25 miles of Daytona Beach using the
 * Eventbrite Destination Events API (/v3/destination/events/).
 * Fetches up to SEARCH_PAGES pages (50 results each). Returns raw API event objects.
 */
async function searchNearbyEvents(token) {
  if (!token) {
    console.log("[sheet-import] Auto-discovery skipped — no Eventbrite token");
    return [];
  }

  /* Start of today in EST so we include all events that occur today (not just future hours) */
  const todayEstDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const today = todayEstDate + "T00:00:00";

  const allEvents = [];

  for (let page = 1; page <= SEARCH_PAGES; page++) {
    try {
      const url = new URL("https://www.eventbriteapi.com/v3/destination/events/");
      url.searchParams.set("latitude",              String(DAYTONA_LAT));
      url.searchParams.set("longitude",             String(DAYTONA_LNG));
      url.searchParams.set("distance",              "25mi");
      url.searchParams.set("expand",                "venue,logo,category");
      url.searchParams.set("sort_by",               "date");
      url.searchParams.set("start_date.range_start", today);
      url.searchParams.set("categories",            DISCOVERY_CATEGORY_IDS);
      url.searchParams.set("page_size",             "50");
      url.searchParams.set("page",                  String(page));

      const res = await fetch(url.toString(), {
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.log(`[sheet-import] Destination search page ${page} → HTTP ${res.status} — stopping`);
        break;
      }

      const data   = await res.json();
      const events = data.events ?? [];
      allEvents.push(...events);
      console.log(`[sheet-import] Destination search page ${page}: ${events.length} events found`);

      if (!data.pagination?.has_more_items) break;
    } catch (err) {
      console.log(`[sheet-import] Destination search page ${page} error: ${err?.message ?? err} — stopping`);
      break;
    }
  }

  console.log(`[sheet-import] Auto-discovery total: ${allEvents.length} events`);
  return allEvents;
}

/**
 * Resolve lat/lng for a venue object.
 *
 * Priority:
 *   1. addressOverride (Column E) — geocoded via Mapbox, absolute authority.
 *   2. Eventbrite venue coordinates — accepted only when outside Water Zones.
 *   3. Mapbox geocode fallback:
 *      - Water-zone rescue: "VenueName Daytona Beach, FL"
 *      - Missing-coords fallback: best available address string.
 *
 * @param {object|null} venue           Raw Eventbrite venue object.
 * @param {string}      mapboxToken     Mapbox Access Token.
 * @param {string}      eventTitle      Used as last-resort geocode query.
 * @param {string|null} addressOverride Column E value — overrides everything.
 * @returns {{ lat: number, lng: number } | { lat: null, lng: null }}
 */
async function resolveVenueCoords(venue, mapboxToken, eventTitle = "", addressOverride = null) {
  // ── 0. Column E address override — absolute authority ─────────────────────
  if (addressOverride) {
    if (!mapboxToken) {
      console.log(`[sheet-import] Col-E override "${addressOverride}" ignored — no Mapbox token`);
      return { lat: null, lng: null };
    }
    console.log(`[sheet-import] Col-E override → geocoding: "${addressOverride}"`);
    return (await geocode(addressOverride, mapboxToken)) ?? { lat: null, lng: null };
  }

  // ── 1. Eventbrite venue coordinates — accept only when outside Water Zones ─
  const rawLat = parseFloat(venue?.address?.latitude  ?? "");
  const rawLng = parseFloat(venue?.address?.longitude ?? "");
  const hasCoords = !isNaN(rawLat) && !isNaN(rawLng);

  if (hasCoords && !isInWaterZone(rawLat, rawLng)) {
    console.log(
      `[sheet-import] Venue coords for "${venue?.name ?? "?"}" → ` +
      `${rawLat.toFixed(4)}, ${rawLng.toFixed(4)}`
    );
    return { lat: rawLat, lng: rawLng };
  }

  if (hasCoords && isInWaterZone(rawLat, rawLng)) {
    console.log(
      `[sheet-import] Water-zone pin (${rawLat.toFixed(4)}, ${rawLng.toFixed(4)}) ` +
      `for "${venue?.name ?? eventTitle}" — falling back to Mapbox venue-name search`
    );
  }

  // ── 2. Mapbox geocode fallback ─────────────────────────────────────────────
  if (!mapboxToken) {
    console.log(
      `[sheet-import] No usable coords for "${venue?.name ?? eventTitle}" ` +
      `and no Mapbox token — pin omitted`
    );
    return { lat: null, lng: null };
  }

  const venueName   = venue?.name ?? "";
  const addrDisplay = venue?.address?.localized_address_display ?? "";
  const hasFL       = /\bfl\b|\bflorida\b/i.test(`${addrDisplay} ${venueName}`);

  let query;
  if (hasCoords && isInWaterZone(rawLat, rawLng)) {
    /* Water-zone rescue: search by venue name + city for best accuracy */
    query = venueName
      ? `${venueName} Daytona Beach, FL`
      : eventTitle
      ? `${eventTitle}, Daytona Beach, FL`
      : null;
  } else {
    /* No coordinates at all: use the best available address string */
    query = addrDisplay
      ? (hasFL ? addrDisplay : `${addrDisplay}, FL`)
      : venueName
      ? `${venueName}, Daytona Beach, FL`
      : eventTitle
      ? `${eventTitle}, Daytona Beach, FL`
      : null;
  }

  if (!query) return { lat: null, lng: null };

  console.log(`[sheet-import] No valid venue coords — geocoding: "${query}"`);
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
 * Attempt to scrape the og:image meta tag from a public web page.
 * Used as a fallback image source for non-Eventbrite events when no image
 * URL is provided in Column L. Returns null on any failure.
 *
 * @param {string} pageUrl  The public URL to fetch.
 * @returns {Promise<string|null>}
 */
async function fetchOgImage(pageUrl) {
  if (!pageUrl) return null;
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Match both attribute orderings: property before content, and content before property
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns true for rows that are clearly headings or label rows, not event data.
 */
function isHeadingRow(firstCell, cells) {
  if (cells.length === 1 && !/^https?:\/\//i.test(firstCell)) return true;
  if (/^(url|event|title|name|raw\s*text|status|description|date|address)$/i.test(firstCell)) return true;
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
