/**
 * src/lib/cityConfigs.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every city this platform serves.
 *
 * HOW TO ADD A NEW CITY
 * ─────────────────────
 * 1. Add an entry to CITY_CONFIGS below.
 * 2. Add a matching  html[data-theme="your-theme-name"] { }  block to
 *    /public/styles/themes.css  with at minimum --brand1 and --accent set.
 *
 * That's it.  Base.astro, Header.astro, and every component that reads
 * var(--brand1) will inherit the right colour automatically.
 * No other files need touching.
 */

export const CITY_CONFIGS = {
  daytona: {
    /** URL slug — must match the folder name and [city] param */
    slug: "daytona",
    /** Human-readable city name used in headings and <title> tags */
    displayName: "Daytona Beach",
    /** Must match an  html[data-theme="…"]  block in /public/styles/themes.css */
    theme: "godo-blue",
    /** Primary brand colour — mirrors themes.css --brand1 for use in JS contexts */
    brand1: "#0077be",
    /** Lat/lng used as the default map centre on the events page */
    mapCenter: { lat: 29.2108, lng: -81.0228 },
    /**
     * All city/neighbourhood name strings that count as part of this region.
     * Kept in sync with GREATER_DAYTONA in src/lib/events.js.
     */
    regionCities: new Set([
      "daytona", "daytona beach",
      "ormond beach", "ormond",
      "port orange",
      "daytona beach shores",
      "south daytona",
      "holly hill",
      "new smyrna beach", "new smyrna",
      "flagler beach", "flagler",
      "deland", "edgewater",
    ]),
  },

  // ── Add new cities here ───────────────────────────────────────────────────

  asheville: {
    slug: "asheville",
    displayName: "Asheville",
    theme: "godo-green",
    brand1: "#2E7D32",
    accentColor: "#76FF03",
    mapCenter: { lat: 35.5951, lng: -82.5515 },
    regionCities: new Set([
      "asheville",
      "weaverville",
      "biltmore",
      "black mountain",
      "woodfin",
      "swannanoa",
      "arden",
    ]),
  },

  macon: {
    slug: "macon",
    displayName: "Macon",
    theme: "godo-cherry",
    brand1: "#A31545",
    accentColor: "#FF00FF",
    mapCenter: { lat: 32.8407, lng: -83.6324 },
    regionCities: new Set([
      "macon",
      "warner robins",
      "byron",
      "forsyth",
      "gray",
    ]),
  },

  jacksonville: {
    slug: "jacksonville",
    displayName: "Jacksonville",
    theme: "godo-teal",
    brand1: "#007B7F",
    mapCenter: { lat: 30.3322, lng: -81.6557 },
    regionCities: new Set([
      "jacksonville",
      "jacksonville beach",
      "neptune beach",
      "atlantic beach",
      "ponte vedra",
      "orange park",
      "fleming island",
      "st. augustine", "st augustine",
    ]),
  },

  sandiego: {
    slug: "sandiego",
    displayName: "San Diego",
    theme: "godo-pacific",
    brand1: "#006994",
    mapCenter: { lat: 32.7157, lng: -117.1611 },
    regionCities: new Set([
      "san diego",
      "chula vista",
      "la jolla",
      "mission valley",
      "el cajon",
      "santee",
      "oceanside",
      "carlsbad",
    ]),
  },
};

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Returns the full config object for a city slug, case-insensitive.
 * Returns null for unknown cities.
 * @param {string} slug
 * @returns {(typeof CITY_CONFIGS)[keyof typeof CITY_CONFIGS] | null}
 */
export function getCityConfig(slug) {
  return CITY_CONFIGS[String(slug ?? "").toLowerCase()] ?? null;
}

/**
 * Returns the CSS data-theme value for a given city slug.
 * Falls back to "clean-white" for unconfigured cities.
 * Used by Base.astro to set  html[data-theme="…"].
 * @param {string} slug
 * @returns {string}
 */
export function getThemeForCity(slug) {
  return getCityConfig(slug)?.theme ?? "clean-white";
}

/**
 * Returns the primary brand colour hex string for a city slug.
 * Useful in JS contexts where a CSS variable isn't accessible.
 * @param {string} slug
 * @returns {string}
 */
export function getBrand1ForCity(slug) {
  return getCityConfig(slug)?.brand1 ?? "#333333";
}

/**
 * Returns the human-readable display name for a city slug.
 * Falls back to the capitalised raw slug if unconfigured.
 * @param {string} slug
 * @returns {string}
 */
export function getDisplayName(slug) {
  const s = String(slug ?? "");
  return getCityConfig(slug)?.displayName ?? (s ? s[0].toUpperCase() + s.slice(1) : s);
}

/** All configured city slugs — useful for getStaticPaths() in dynamic routes. */
export const allCitySlugs = Object.keys(CITY_CONFIGS);
