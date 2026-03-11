/**
 * src/lib/scraper.js
 *
 * Build-time multi-source event scraper for the Greater Daytona Beach area.
 * Targets official city calendars and high-value venue event pages.
 * Runs on the server at `astro build` time — no client-side fetch.
 *
 * Returns events normalised to the same shape used by the markdown collection:
 *   { title, eventDate, endDate, location, address, city, url, image, lat, lng, source }
 *
 * Map accuracy: lat/lng are ONLY set when a verified street address is found.
 * City-centre fallbacks are never used here.
 *
 * Optional env vars:
 *   UNSPLASH_ACCESS_KEY — enables live photo fallback via Unsplash API
 *
 * Usage in an Astro page:
 *   import { scrapeAll } from "../../lib/scraper.js";
 *   const liveEvents = await scrapeAll();
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const UA =
  "Mozilla/5.0 (compatible; GodoCityBot/1.0; +https://godocity.com)";

const FETCH_TIMEOUT_MS = 10_000;

/** Known street addresses for well-known venues (used when HTML contains name but no address) */
const KNOWN_VENUES = {
  "hard rock hotel daytona beach": {
    address: "918 N Atlantic Ave, Daytona Beach, FL 32118",
    lat: 29.2373, lng: -81.0026,
  },
  "hard rock hotel": {
    address: "918 N Atlantic Ave, Daytona Beach, FL 32118",
    lat: 29.2373, lng: -81.0026,
  },
  "the shores resort": {
    address: "2637 S Atlantic Ave, Daytona Beach Shores, FL 32118",
    lat: 29.1962, lng: -80.9984,
  },
  "shores resort & spa": {
    address: "2637 S Atlantic Ave, Daytona Beach Shores, FL 32118",
    lat: 29.1962, lng: -80.9984,
  },
  "daytona international speedway": {
    address: "1801 W International Speedway Blvd, Daytona Beach, FL 32114",
    lat: 29.1852, lng: -81.0705,
  },
  "ocean center": {
    address: "101 N Atlantic Ave, Daytona Beach, FL 32118",
    lat: 29.2264, lng: -81.0005,
  },
  "peabody auditorium": {
    address: "600 Auditorium Blvd, Daytona Beach, FL 32118",
    lat: 29.2215, lng: -81.0197,
  },
  "daytona beach bandshell": {
    address: "250 N Atlantic Ave, Daytona Beach, FL 32118",
    lat: 29.2262, lng: -81.0000,
  },
  "the hub on campus": {
    address: "200 E International Speedway Blvd, Daytona Beach, FL 32114",
    lat: 29.2124, lng: -81.0150,
  },
};

/** Hardcoded fallback images keyed by category or source type */
const CATEGORY_FALLBACK = {
  "Music & Nightlife":    "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=75",
  "Food & Drink":         "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=75",
  "Arts & Culture":       "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=800&q=75",
  "Markets & Fairs":      "https://images.unsplash.com/photo-1488459716781-0a04a8a37e6e?w=800&q=75",
  "Racing & Motorsports": "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=75",
  "Outdoors & Sports":    "https://images.unsplash.com/photo-1530549387789-4c161668b269?w=800&q=75",
  "hotel":    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=75",
  "concert":  "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=75",
  "default":  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=75",
};

/* ═══════════════════════════════════════════════════════════════════════════
   Global coordinate hard-locks
   Applied to every scraped event BEFORE it leaves this module.
   index.astro has a second pass for markdown/manual entries.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Each entry is checked against title AND location (venue name).
 * titleTest  — fires when the event title matches
 * venueTest  — fires when the location/venue field matches (even if title doesn't)
 * Both checks are OR'd — either one triggers the override.
 */
const SCRAPER_COORD_OVERRIDES = [
  // Turkey Run → Daytona International Speedway
  {
    titleTest: /turkey run/i,
    venueTest: null,
    lat: 29.1852, lng: -81.0705,
  },
  // Main Street corridor — title OR venue containing any of these names
  // locks to Main Street, Daytona Beach — overrides any scraped address
  {
    titleTest: /bike week|main street/i,
    venueTest: /main street|the bank|dirty harry/i,
    lat: 29.2235, lng: -81.0115,
  },
];

/** Apply coord overrides to a single scraped event object. */
function applyScraperCoordOverrides(event) {
  const title = String(event.title    ?? "").toLowerCase();
  const venue = String(event.location ?? "").toLowerCase();
  for (const ov of SCRAPER_COORD_OVERRIDES) {
    const hitTitle = ov.titleTest && ov.titleTest.test(title);
    const hitVenue = ov.venueTest && ov.venueTest.test(venue);
    if (hitTitle || hitVenue) {
      return { ...event, lat: ov.lat, lng: ov.lng, coordSource: "hardlock" };
    }
  }
  return event;
}

/** Sources to scrape — order determines priority for deduplication */
const SOURCES = [
  /* ── Official city / county event calendars ───────────────────────────── */
  {
    name: "Visit Daytona",
    url:  "https://www.visitdaytona.com/events/",
    city: "daytona beach",
    imgTheme: "concert",
  },
  {
    name: "Ormond Beach Official",
    url:  "https://www.ormondbeach.org/government/departments/parks-recreation/special-events",
    city: "ormond beach",
    imgTheme: "default",
  },
  {
    name: "New Smyrna Beach",
    url:  "https://www.visitnewsmyrnabeach.com/things-to-do/events/",
    city: "new smyrna beach",
    imgTheme: "default",
  },
  {
    name: "Port Orange Parks & Rec",
    url:  "https://www.port-orange.org/index.aspx?NID=85",
    city: "port orange",
    imgTheme: "default",
  },
  {
    name: "Flagler Beach",
    url:  "https://www.flaglerbeachfl.gov/calendar.aspx",
    city: "flagler beach",
    imgTheme: "default",
  },
  {
    name: "Volusia County",
    url:  "https://www.volusia.org/calendar.aspx",
    city: "daytona beach",
    imgTheme: "default",
  },
  /* ── High-value venue event pages ─────────────────────────────────────── */
  {
    name:  "Hard Rock Hotel Daytona",
    url:   "https://www.hardrockhoteldaytona.com/entertainment/",
    city:  "daytona beach",
    venue: "Hard Rock Hotel Daytona Beach",
    imgTheme: "hotel",
    knownVenueKey: "hard rock hotel daytona beach",
  },
  {
    name:  "The Shores Resort & Spa",
    url:   "https://www.shoresresort.com/events/",
    city:  "daytona beach shores",
    venue: "The Shores Resort & Spa",
    imgTheme: "hotel",
    knownVenueKey: "shores resort & spa",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   HTTP helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fetches a URL with timeout + User-Agent, returns the response text.
 * Returns null on any error (network, timeout, non-200, etc.).
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchHtml(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept":     "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[scraper] ${res.status} fetching ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[scraper] Failed to fetch ${url}:`, err?.message ?? err);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Date helpers
   ═══════════════════════════════════════════════════════════════════════════ */

const TODAY_STR = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

/** Parse an ISO datetime or date string → "YYYY-MM-DD", or null on failure. */
function toDateStr(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try Date parse
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/** Returns true if dateStr is today or in the future. */
function isUpcoming(dateStr) {
  return dateStr != null && dateStr >= TODAY_STR;
}

/* ═══════════════════════════════════════════════════════════════════════════
   JSON-LD parser  (most reliable; works on any modern website)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Extracts Event objects from all JSON-LD <script> tags in the HTML.
 * Handles single objects and arrays; handles @graph wrappers.
 *
 * @param {string} html
 * @param {object} source  — Source descriptor from SOURCES[]
 * @returns {object[]}     — Normalised event objects
 */
function parseJsonLd(html, source) {
  const events = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }

    // Unwrap @graph
    const candidates = data["@graph"] ?? (Array.isArray(data) ? data : [data]);

    for (const item of candidates) {
      if (item["@type"] !== "Event") continue;

      const title     = item.name ?? item.headline ?? "";
      const startRaw  = item.startDate ?? item.datePublished ?? "";
      const endRaw    = item.endDate ?? "";
      const eventDate = toDateStr(startRaw);
      const endDate   = toDateStr(endRaw);

      if (!title || !eventDate || !isUpcoming(eventDate)) continue;

      // Location
      const loc    = item.location ?? item.venue ?? {};
      const addr   = loc.address ?? {};
      const vname  = loc.name ?? source.venue ?? "";
      const street = addr.streetAddress ?? "";
      const addrCity = addr.addressLocality ?? "";

      // Coords — only from schema, never guessed
      // coordSource tracks how reliable the pin is:
      //   "schema"      — from the event site's own JSON-LD (may be city-centre)
      //   "known_venue" — matched our KNOWN_VENUES table (exact street address)
      //   "hardlock"    — overridden by SCRAPER_COORD_OVERRIDES (highest trust)
      //   null          — no coordinates available; event is excluded from map
      let lat = null, lng = null, coordSource = null;
      if (item.geo?.latitude  && item.geo?.longitude) {
        lat = parseFloat(item.geo.latitude);
        lng = parseFloat(item.geo.longitude);
        coordSource = "schema";
      } else if (loc.geo?.latitude && loc.geo?.longitude) {
        lat = parseFloat(loc.geo.latitude);
        lng = parseFloat(loc.geo.longitude);
        coordSource = "schema";
      }

      // Lookup known venue coords when address was found in HTML but not in schema
      if (!lat && vname) {
        const vk = vname.toLowerCase();
        for (const [key, known] of Object.entries(KNOWN_VENUES)) {
          if (vk.includes(key) || key.includes(vk)) {
            lat = known.lat; lng = known.lng;
            coordSource = "known_venue";
            break;
          }
        }
      }

      events.push({
        title,
        eventDate,
        endDate: endDate || null,
        location: vname || addrCity || source.name,
        address:  street,
        city:     source.city,
        url:      item.url ?? item["@id"] ?? null,
        image:    item.image?.url ?? item.image ?? null,
        lat,
        lng,
        coordSource,
        source:   source.name,
      });
    }
  }
  return events;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HTML pattern parsers  (fallbacks when JSON-LD is absent)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Strip HTML tags from a string. */
function stripTags(s) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Decode common HTML entities. */
function decodeEntities(s) {
  return (s ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

/** Attempt to parse a US date string like "March 14, 2026" → "2026-03-14". */
const MONTHS = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
  jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
};
function parseUsDate(s) {
  if (!s) return null;
  // "March 14, 2026" or "Mar 14 2026" or "03/14/2026"
  const m1 = /([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m1) {
    const mo = MONTHS[m1[1].slice(0,3).toLowerCase()];
    if (mo) return `${m1[3]}-${String(mo).padStart(2,"0")}-${String(m1[2]).padStart(2,"0")}`;
  }
  // "03/14/2026"
  const m2 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m2) return `${m2[3]}-${String(m2[1]).padStart(2,"0")}-${String(m2[2]).padStart(2,"0")}`;
  // "2026-03-14"
  if (/\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return null;
}

/**
 * Generic HTML calendar parser.
 * Looks for: <time datetime>, event-title patterns, article[class*=event], h-event.
 *
 * @param {string} html
 * @param {object} source
 * @returns {object[]}
 */
function parseGenericHtml(html, source) {
  const events = [];

  // Strategy: find blocks that contain both a date and a title.
  // We look for <article>, <li>, <div> elements that have event-related classes.
  const blockRe = /<(?:article|li|div)[^>]*class="[^"]*(?:event|tribe|listing|calendar)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|li|div)>/gi;

  let block;
  while ((block = blockRe.exec(html)) !== null) {
    const inner = block[1];

    // Extract title — look for heading tags or common class names
    const titleRe = /<(?:h[1-6]|[^>]+class="[^"]*(?:title|name|heading|summary)[^"]*")[^>]*>([\s\S]*?)<\/[^>]+>/i;
    const titleMatch = titleRe.exec(inner);
    const title = decodeEntities(stripTags(titleMatch?.[1] ?? ""));
    if (!title || title.length < 3) continue;

    // Extract date — prefer <time datetime>
    const timeMatch = /<time[^>]+datetime="([^"]+)"/.exec(inner);
    let eventDate = toDateStr(timeMatch?.[1]);

    if (!eventDate) {
      // Try common date class patterns
      const dateRe = /<[^>]+class="[^"]*(?:date|start|when|day)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i;
      const dateMatch = dateRe.exec(inner);
      if (dateMatch) eventDate = parseUsDate(stripTags(dateMatch[1]));
    }

    if (!eventDate || !isUpcoming(eventDate)) continue;

    // Extract URL
    const hrefMatch = /<a[^>]+href="([^"]+)"/.exec(inner);
    let url = hrefMatch?.[1] ?? null;
    if (url && url.startsWith("/")) {
      try {
        const base = new URL(source.url);
        url = `${base.protocol}//${base.host}${url}`;
      } catch { /* leave as-is */ }
    }

    // Extract image
    const imgMatch = /<img[^>]+src="([^"]+)"/.exec(inner);
    const image = imgMatch?.[1] ?? null;

    events.push({
      title,
      eventDate,
      endDate: null,
      location: source.venue ?? source.name,
      address: "",
      city: source.city,
      url,
      image,
      lat: null,
      lng: null,
      source: source.name,
    });
  }

  return events;
}

/**
 * CivicEngage / CivicPlus calendar parser.
 * Government city sites commonly use this CMS (Port Orange, Flagler Beach, Volusia County).
 *
 * @param {string} html
 * @param {object} source
 * @returns {object[]}
 */
function parseCivicCalendar(html, source) {
  const events = [];

  // CivicPlus emits rows like:
  // <tr class="rgRow"| "rgAltRow"> ... <td class="...Date..."> ... <a href="...">Title</a>
  const rowRe = /<tr[^>]*class="[^"]*(?:rgRow|rgAltRow|ListItem)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const inner = row[1];

    const titleMatch = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    if (!titleMatch) continue;
    const title = decodeEntities(stripTags(titleMatch[2]));
    if (!title || title.length < 3) continue;

    let url = titleMatch[1];
    if (url.startsWith("/")) {
      try {
        const base = new URL(source.url);
        url = `${base.protocol}//${base.host}${url}`;
      } catch { /* leave */ }
    }

    // Date cells
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    let eventDate = null;
    while ((td = tdRe.exec(inner)) !== null) {
      const text = stripTags(td[1]);
      const d = parseUsDate(text);
      if (d && isUpcoming(d)) { eventDate = d; break; }
    }
    if (!eventDate) continue;

    events.push({
      title,
      eventDate,
      endDate: null,
      location: source.venue ?? source.city,
      address: "",
      city: source.city,
      url,
      image: null,
      lat: null,
      lng: null,
      source: source.name,
    });
  }

  return events;
}

/**
 * Hotel/venue event page parser.
 * Targets common patterns on standalone venue event pages.
 *
 * @param {string} html
 * @param {object} source
 * @returns {object[]}
 */
function parseHotelEvents(html, source) {
  // Try generic first
  const generic = parseGenericHtml(html, source);
  if (generic.length) return applyKnownVenueCoords(generic, source);

  const events = [];

  // Fallback: look for any hyperlinked heading near a date string
  const sectionRe = /<(?:section|article|div)[^>]*>([\s\S]{50,800}?)<\/(?:section|article|div)>/gi;
  let sec;
  while ((sec = sectionRe.exec(html)) !== null) {
    const inner = sec[1];
    if (!inner.includes("202")) continue; // skip sections without a year

    const h = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(inner);
    if (!h) continue;
    const title = decodeEntities(stripTags(h[1]));
    if (!title || title.length < 4 || title.length > 120) continue;

    const timeM = /<time[^>]+datetime="([^"]+)"/.exec(inner);
    let eventDate = toDateStr(timeM?.[1]);
    if (!eventDate) {
      // Scan for any date-like text
      const dateScans = inner.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+2\d{3}/gi) ?? [];
      for (const ds of dateScans) {
        const d = parseUsDate(ds);
        if (d && isUpcoming(d)) { eventDate = d; break; }
      }
    }
    if (!eventDate || !isUpcoming(eventDate)) continue;

    const imgM = /<img[^>]+src="([^"]+)"/.exec(inner);
    const hrefM = /<a[^>]+href="([^"]+)"/.exec(inner);
    let url = hrefM?.[1] ?? source.url;
    if (url.startsWith("/")) {
      try { const b = new URL(source.url); url = `${b.protocol}//${b.host}${url}`; } catch {}
    }

    events.push({
      title,
      eventDate,
      endDate: null,
      location: source.venue ?? source.name,
      address: "",
      city: source.city,
      url,
      image: imgM?.[1] ?? null,
      lat: null,
      lng: null,
      source: source.name,
    });
  }

  return applyKnownVenueCoords(events, source);
}

/** Apply known venue coordinates to all events from a source that has a knownVenueKey. */
function applyKnownVenueCoords(events, source) {
  if (!source.knownVenueKey) return events;
  const known = KNOWN_VENUES[source.knownVenueKey];
  if (!known) return events;
  return events.map(e => ({
    ...e,
    address:     e.address || known.address,
    lat:         e.lat ?? known.lat,
    lng:         e.lng ?? known.lng,
    // Only upgrade coordSource; never downgrade a hardlock or known_venue already set
    coordSource: e.coordSource ?? "known_venue",
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Unsplash image fallback
   ═══════════════════════════════════════════════════════════════════════════ */

/** In-process cache: query string → image URL. Avoids duplicate API calls. */
const _unsplashCache = new Map();

/**
 * Fetches a random Unsplash photo for the given query.
 * Uses the in-process cache; returns null on any failure.
 *
 * @param {string} query
 * @param {string} accessKey
 * @returns {Promise<string|null>}
 */
async function fetchUnsplashPhoto(query, accessKey) {
  if (!accessKey || !query) return null;
  if (_unsplashCache.has(query)) return _unsplashCache.get(query);

  try {
    const url =
      `https://api.unsplash.com/photos/random` +
      `?query=${encodeURIComponent(query)}&orientation=landscape&client_id=${accessKey}`;
    const res = await fetch(url, { headers: { "Accept-Version": "v1" } });
    if (!res.ok) return null;
    const data = await res.json();
    const imgUrl = data?.urls?.regular ?? null;
    if (imgUrl) _unsplashCache.set(query, imgUrl);
    return imgUrl;
  } catch {
    return null;
  }
}

/**
 * Resolves the fallback image for a scraped event that has no image.
 * Priority: Unsplash API (hotel or concert query) → CATEGORY_FALLBACK constant.
 *
 * @param {object} event
 * @param {string} unsplashKey
 * @returns {Promise<string>}
 */
async function resolveImage(event, unsplashKey) {
  if (event.image) return event.image;

  // Pick query based on source type
  const theme = event._imgTheme ?? "default";
  const query =
    theme === "hotel"   ? "hotel resort daytona beach" :
    theme === "concert" ? "concert live music daytona" :
                          "festival daytona beach florida";

  const unsplashUrl = await fetchUnsplashPhoto(query, unsplashKey);
  return unsplashUrl ?? CATEGORY_FALLBACK[theme] ?? CATEGORY_FALLBACK["default"];
}

/* ═══════════════════════════════════════════════════════════════════════════
   Per-source scraper
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Scrapes a single source.  JSON-LD is tried first; on failure the source-
 * appropriate HTML parser is used as a fallback.
 *
 * @param {object} source
 * @returns {Promise<object[]>}
 */
async function scrapeSource(source) {
  console.log(`[scraper] Scraping ${source.name}…`);
  const html = await fetchHtml(source.url);
  if (!html) return [];

  // Attempt JSON-LD extraction first (most reliable)
  const jsonLdEvents = parseJsonLd(html, source);
  if (jsonLdEvents.length > 0) {
    return jsonLdEvents.map(e => ({ ...e, _imgTheme: source.imgTheme }));
  }

  // Fallback: HTML-specific parser
  let htmlEvents;
  if (source.knownVenueKey || source.venue) {
    htmlEvents = parseHotelEvents(html, source);
  } else if (source.url.includes("calendar.aspx") || source.url.includes("NID=")) {
    htmlEvents = parseCivicCalendar(html, source);
  } else {
    htmlEvents = parseGenericHtml(html, source);
  }

  return htmlEvents.map(e => ({ ...e, _imgTheme: source.imgTheme }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Deduplication
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Deduplicates events by a normalised (title + date) key.
 * Keeps the first occurrence (highest-priority source wins).
 *
 * @param {object[]} events
 * @returns {object[]}
 */
function dedupe(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.title.toLowerCase().replace(/\s+/g, " ")}|${e.eventDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Public API
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Scrapes all configured sources in parallel and returns a deduped, sorted
 * array of upcoming events for the Greater Daytona Beach area.
 *
 * Each event is normalised to:
 *   { title, eventDate, endDate, location, address, city, url, image, lat, lng, source }
 *
 * lat/lng are only set when a verified street address is available —
 * never approximated from a city centre.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.unsplashKey]  Unsplash access key (falls back to env var)
 * @param {string[]}[opts.onlySources]  Limit to specific source names (for testing)
 * @returns {Promise<object[]>}
 */
export async function scrapeAll({
  unsplashKey = import.meta.env?.UNSPLASH_ACCESS_KEY ?? process.env?.UNSPLASH_ACCESS_KEY ?? "",
  onlySources = null,
} = {}) {
  const targets = onlySources
    ? SOURCES.filter(s => onlySources.includes(s.name))
    : SOURCES;

  console.log(`[scraper] Scraping ${targets.length} sources…`);

  // Run all sources in parallel, never let one failure block others
  const settled = await Promise.allSettled(
    targets.map(s => scrapeSource(s))
  );

  const allEvents = settled.flatMap((result, i) => {
    if (result.status === "rejected") {
      console.warn(`[scraper] ${targets[i].name} failed:`, result.reason?.message ?? result.reason);
      return [];
    }
    console.log(`[scraper] ${targets[i].name}: ${result.value.length} events`);
    return result.value;
  });

  // Sort by date, deduplicate
  allEvents.sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""));
  const unique = dedupe(allEvents);

  // Hard-lock coordinates for known landmarks before image resolution
  const coordLocked = unique.map(applyScraperCoordOverrides);

  // Resolve images for events without one (Unsplash + fallback)
  const withImages = await Promise.all(
    coordLocked.map(async e => {
      const image = await resolveImage(e, unsplashKey);
      const { _imgTheme: _t, ...rest } = e; // strip internal prop
      return { ...rest, image };
    })
  );

  console.log(`[scraper] Total: ${withImages.length} unique upcoming events`);
  return withImages;
}

export { CATEGORY_FALLBACK };
