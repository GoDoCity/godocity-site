/**
 * src/lib/events.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for event data at build time.
 *
 * importFromSheet() is called ONCE per build.  Node.js module caching turns
 * _promise into a true singleton: every page that imports this module shares
 * the same resolved result — no duplicate Eventbrite / Mapbox API calls.
 *
 * Consumers
 *   ArticleSidebar.astro         → getCityEvents(city)
 *   [city]/[topic]/index.astro   → getCityEvents(city)
 *   daytona/events/index.astro   → engine fetch directly (no sheet)
 *   daytona/index.astro          → engine fetch directly (no sheet)
 *
 * getCityEvents("daytona") is intercepted to use the live engine API;
 * all other city slugs still fall through to the Google Sheets singleton.
 */
import { importFromSheet } from "./sheet-import.js";
import { getCityConfig } from "./cityConfigs.js";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Build-time filesystem cache ───────────────────────────────────────────────
// Persists the fetch result to disk so parallel Astro workers (each with their
// own module scope) all hit the cache after the first worker writes it.
const _CACHE_FILE    = join(process.cwd(), ".astro", "events-build-cache.json");
const _CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutes — covers any single build

function _tryReadCache() {
  try {
    const age = Date.now() - statSync(_CACHE_FILE).mtimeMs;
    if (age < _CACHE_MAX_AGE) return JSON.parse(readFileSync(_CACHE_FILE, "utf-8"));
  } catch {}
  return null;
}
function _tryWriteCache(data) {
  try {
    mkdirSync(join(process.cwd(), ".astro"), { recursive: true });
    writeFileSync(_CACHE_FILE, JSON.stringify(data));
  } catch {}
}

// ── Hard global cutoff ────────────────────────────────────────────────────────
/**
 * Returns a YYYY-MM-DD date string for America/New_York, offset by `offsetDays`.
 * Forces EST/EDT so events don't disappear 4–5 hours early on a UTC server.
 */
function _estDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Yesterday in EST/EDT — events on or after this date always pass the date check. */
export const HARD_CUTOFF = _estDateStr(-1);

// ── Shared area set ───────────────────────────────────────────────────────────
export const GREATER_DAYTONA = new Set([
  "daytona", "daytona beach",
  "ormond beach", "ormond",
  "port orange",
  "daytona beach shores",
  "south daytona",
  "holly hill",
  "new smyrna beach", "new smyrna",
  "flagler beach", "flagler",
  "deland", "edgewater",
]);

// ── City display map ──────────────────────────────────────────────────────────
export const CITY_DISPLAY = {
  "daytona":               "Daytona Beach",
  "daytona beach":         "Daytona Beach",
  "ormond beach":          "Ormond Beach",
  "ormond":                "Ormond Beach",
  "port orange":           "Port Orange",
  "daytona beach shores":  "Daytona Beach Shores",
  "south daytona":         "South Daytona",
  "holly hill":            "Holly Hill",
  "new smyrna beach":      "New Smyrna Beach",
  "new smyrna":            "New Smyrna Beach",
  "flagler beach":         "Flagler Beach",
  "flagler":               "Flagler Beach",
  "deland":                "DeLand",
  "edgewater":             "Edgewater",
};

export function cityDisplayName(raw) {
  return CITY_DISPLAY[(raw ?? "").toLowerCase().trim()] ?? String(raw ?? "");
}

// ── Coordinate hard-fixes (centralised) ──────────────────────────────────────
const COORD_OVERRIDES = [
  { titleTest: /turkey run/i,
    lat: 29.1852, lng: -81.0705 },
  { titleTest: /bike week|main street/i,
    venueTest: /main street|the bank|dirty harry|boot hill|iron horse|main st\b/i,
    lat: 29.2235, lng: -81.0115 },
  { titleTest: /mindtravel/i,
    lat: 29.0258, lng: -80.9270 },
  { titleTest: /spring break/i,
    lat: 29.2373, lng: -81.0026 },
];

function applyCoordOverrides(e) {
  const title = String(e.title ?? "");
  const venue = String(e.location ?? "");
  for (const ov of COORD_OVERRIDES) {
    if (ov.titleTest.test(title) || (ov.venueTest && ov.venueTest.test(venue))) {
      return { ...e, lat: ov.lat, lng: ov.lng };
    }
  }
  return e;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
/** True when the event date is >= yesterday (EST/EDT), or the event is sponsored. */
export function isStrictlyFuture(eventDateRaw, isSponsored = false) {
  if (isSponsored) return true;
  if (!eventDateRaw) return false;
  return String(eventDateRaw).split("T")[0] >= HARD_CUTOFF;
}

function dateSortKey(e) {
  const raw = e.data?.eventDate ?? e.eventDate ?? "";
  return String(raw).split("T")[0];
}

// ── Normalisation ─────────────────────────────────────────────────────────────
/**
 * Convert a raw sheet / Eventbrite-discovered event into the { slug, data }
 * shape that ArticleSidebar, the Events page, and the Home page all expect.
 * Coord overrides are applied here so they only need to be defined once.
 */
export function normalizeSheetEvent(raw) {
  const e    = applyCoordOverrides(raw);
  const city = String(e.city ?? "daytona beach").toLowerCase().trim();
  const titleSlug = String(e.title ?? "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return {
    slug: `${city.replace(/\s+/g, "-")}/sheet-${titleSlug}`,
    data: {
      title:     e.title     ?? "",
      eventDate: e.eventDate ?? "",
      endDate:   e.endDate   ?? null,
      location:  e.location  ?? "",
      city,
      url:       e.url       ?? null,
      image:     e.image     ?? null,
      category:  e.category  ?? null,
      lat:       e.lat       ?? null,
      lng:       e.lng       ?? null,
      sponsored: e.sponsored === true,
      proTip:    e.proTip    ?? null,
      source:    e.source    ?? "eventbrite-sheet",
    },
  };
}

// ── Daytona engine singleton (replaces Google Sheets for daytona city slug) ──
// Follows the same module-level singleton pattern as _promise below so the
// engine is fetched at most once per build regardless of how many pages call
// getCityEvents("daytona").

function _extractEngineCity(addr) {
  const lc = (addr ?? "").toLowerCase();
  if (lc.includes("ormond beach"))         return "ormond beach";
  if (lc.includes("port orange"))          return "port orange";
  if (lc.includes("daytona beach shores")) return "daytona beach shores";
  if (lc.includes("south daytona"))        return "south daytona";
  if (lc.includes("holly hill"))           return "holly hill";
  if (lc.includes("new smyrna beach"))     return "new smyrna beach";
  if (lc.includes("new smyrna"))           return "new smyrna beach";
  if (lc.includes("flagler beach"))        return "flagler beach";
  if (lc.includes("daytona"))             return "daytona beach";
  return "daytona beach";
}

function _engineHasFeatured(tags) {
  if (!tags) return false;
  try { const t = JSON.parse(tags); return Array.isArray(t) && t.includes("featured"); } catch { return false; }
}

/* Hosts that must never be a CTA destination — our own domains currently
   resolve to a parked placeholder, so an event_url pointing there dead-ends. */
const PLACEHOLDER_HOSTS = new Set([
  "godocity.com", "www.godocity.com",
  "godoevents.com", "www.godoevents.com",
]);

/**
 * Engine event_url → real external http(s) link, or null.
 * Rejects blanks, "#", non-http schemes, and our placeholder domains.
 * Callers decide the fallback (usually the Daytona official calendar).
 */
export function resolveEngineEventUrl(raw) {
  const url = (raw ?? "").trim();
  if (!url || url === "#") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (PLACEHOLDER_HOSTS.has(u.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

/* ── Unified events hub routing ──────────────────────────────────────────────
   Cities in ENGINE_CITIES are fully served by the live GoDoEVENTS engine:
   their "See all" links point at the unified hub and their sidebars render
   the live engine feed only. Add a city here when it migrates to the engine. */
export const ENGINE_CITIES = new Set(["daytona"]);
export const EVENTS_HUB_BASE = "https://godoevents-site.pages.dev";
export const ENGINE_API_BASE = "https://godoevents-engine.yellowcabking.workers.dev";

export function getEventsUrl(slug) {
  const s = String(slug ?? "").toLowerCase().trim();
  return ENGINE_CITIES.has(s) ? `${EVENTS_HUB_BASE}/${s}/events/` : `/${s}/events/`;
}

let _daytonaEnginePromise = null;

function _getDaytonaEngineEvents() {
  if (_daytonaEnginePromise !== null) return _daytonaEnginePromise;
  _daytonaEnginePromise = (async () => {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const res = await fetch(
        `${ENGINE_API_BASE}/api/events?market=daytona&limit=50&from=${encodeURIComponent(today.toISOString())}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const events = (json.events ?? []).map(e => ({
        slug: `daytona/engine-${e.id}`,
        data: {
          title:     e.title      ?? "Untitled Event",
          eventDate: e.start_datetime,
          endDate:   e.end_datetime  ?? null,
          location:  e.venue_name    ?? (e.venue_address?.split(",")[0] ?? ""),
          city:      _extractEngineCity(e.venue_address ?? ""),
          url:       resolveEngineEventUrl(e.event_url) ?? "https://www.daytonabeach.com/events/",
          image:     e.image_url || e.image_medium || null,
          lat:       e.latitude  ?? null,
          lng:       e.longitude ?? null,
          sponsored: _engineHasFeatured(e.partner_tags),
          proTip:    null,
          source:    `engine-${e.source ?? "unknown"}`,
        },
      }));
      // Sidebar guarantee: strictly upcoming, chronological by nearest date —
      // identical ordering to the unified events hub.
      const upcoming = events
        .filter(e => isStrictlyFuture(e.data.eventDate, e.data.sponsored === true))
        .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
      console.log(`[events] getCityEvents(daytona) → ${upcoming.length} live engine events`);
      return upcoming;
    } catch (err) {
      console.warn("[events] Daytona engine fetch failed:", err?.message ?? err);
      return [];
    }
  })();
  return _daytonaEnginePromise;
}

// ── Singleton fetch ───────────────────────────────────────────────────────────
let _promise = null;

/**
 * Calls importFromSheet() once per build process.
 * Node.js module caching guarantees _promise is the same object across every
 * import of this module — subsequent callers skip straight to .then().
 */
export function getRawSheetEvents() {
  if (_promise !== null) return _promise;

  // Filesystem cache — shared across Astro worker processes in the same build
  const cached = _tryReadCache();
  if (cached !== null) {
    console.log(`[events] Build cache hit (${cached.length} events)`);
    _promise = Promise.resolve(cached);
    return _promise;
  }

  const csvUrl      = import.meta.env.SHEET_CSV_URL          ?? "";
  const ebToken     = import.meta.env.EVENTBRITE_TOKEN        ?? "";
  const mapboxToken = import.meta.env.MAPBOX_ACCESS_TOKEN     ?? "";
  _promise = csvUrl
    ? importFromSheet(csvUrl, ebToken, mapboxToken)
        .then(data => { _tryWriteCache(data); return data; })
        .catch(err => {
          console.error("[events] importFromSheet failed:", err?.message ?? err);
          return [];
        })
    : Promise.resolve([]);
  return _promise;
}

// ── Pre-built consumer helpers ────────────────────────────────────────────────

/**
 * Normalised Greater-Daytona events strictly after HARD_CUTOFF, sorted by date.
 * Used by ArticleSidebar.astro and the home page sidebar.
 */
export async function getGreaterDaytonaEvents() {
  const raw = await getRawSheetEvents();
  return raw
    .filter(e => {
      const evCity = (e.city ?? "").toLowerCase().trim();
      return GREATER_DAYTONA.has(evCity) && isStrictlyFuture(e.eventDate, e.sponsored === true);
    })
    .map(normalizeSheetEvent)
    .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
}

/**
 * Normalised events for any city slug, filtered via cityConfigs.regionCities.
 * Falls back to a single-entry Set containing the raw slug for unconfigured cities.
 * @param {string} slug — matches a key in CITY_CONFIGS (e.g. "daytona", "asheville")
 */
export async function getCityEvents(slug) {
  // Daytona uses the live engine API — all other cities still use the sheet.
  if (String(slug ?? "").toLowerCase() === "daytona") {
    return _getDaytonaEngineEvents();
  }
  const config = getCityConfig(slug);
  const regionCities = config?.regionCities ?? new Set([String(slug ?? "").toLowerCase()]);
  const raw = await getRawSheetEvents();
  return raw
    .filter(e => {
      const evCity = (e.city ?? "").toLowerCase().trim();
      return regionCities.has(evCity) && isStrictlyFuture(e.eventDate, e.sponsored === true);
    })
    .map(normalizeSheetEvent)
    .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
}

/**
 * All normalised sheet events >= yesterday (any city), sorted by date.
 * Sponsored events are always included regardless of date.
 * Used by the Events page, which merges markdown / manual events on top.
 */
export async function getAllSheetEvents() {
  const raw = await getRawSheetEvents();
  return raw
    .filter(e => isStrictlyFuture(e.eventDate, e.sponsored === true))
    .map(normalizeSheetEvent)
    .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
}
