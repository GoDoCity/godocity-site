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
 *   ArticleSidebar.astro      → getGreaterDaytonaEvents()
 *   daytona/events/index.astro → getAllSheetEvents()
 *   daytona/index.astro        → getGreaterDaytonaEvents()
 */
import { importFromSheet } from "./sheet-import.js";

// ── Hard global cutoff ────────────────────────────────────────────────────────
/** Events whose date is on or before this YYYY-MM-DD string are excluded everywhere. */
export const HARD_CUTOFF = "2026-03-16";

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
/** True only when the event date is strictly after HARD_CUTOFF. */
export function isStrictlyFuture(eventDateRaw) {
  if (!eventDateRaw) return false;
  return String(eventDateRaw).split("T")[0] > HARD_CUTOFF;
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
      source:    e.source    ?? "eventbrite-sheet",
    },
  };
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
  const csvUrl      = import.meta.env.SHEET_CSV_URL          ?? "";
  const ebToken     = import.meta.env.EVENTBRITE_TOKEN        ?? "";
  const mapboxToken = import.meta.env.MAPBOX_ACCESS_TOKEN     ?? "";
  _promise = csvUrl
    ? importFromSheet(csvUrl, ebToken, mapboxToken).catch(err => {
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
      return GREATER_DAYTONA.has(evCity) && isStrictlyFuture(e.eventDate);
    })
    .map(normalizeSheetEvent)
    .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
}

/**
 * All normalised sheet events strictly after HARD_CUTOFF (any city), sorted by date.
 * Used by the Events page, which merges markdown / manual events on top.
 */
export async function getAllSheetEvents() {
  const raw = await getRawSheetEvents();
  return raw
    .filter(e => isStrictlyFuture(e.eventDate))
    .map(normalizeSheetEvent)
    .sort((a, b) => (dateSortKey(a) < dateSortKey(b) ? -1 : dateSortKey(a) > dateSortKey(b) ? 1 : 0));
}
