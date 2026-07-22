/**
 * src/lib/geocode.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Build-time forward geocoding via the Mapbox Geocoding API, for CMS events that
 * editors publish with only an `address` string (no manual lat/lng).
 *
 * Returns { lat, lng } or null. Results are cached per query for the duration of
 * a build so the same venue is never looked up twice. When no token is present
 * (e.g. local dev) or the request fails, it returns null so callers can fall
 * back cleanly to a city-center pin.
 *
 * Mirrors the proven geocoder in sheet-import.js, generalised so any city can
 * pass its own proximity bias / bounding box.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeOpts {
  /** Bias results toward this point. Mapbox order: [lng, lat]. */
  proximity?: [number, number];
  /** Restrict results to this box: [minLng, minLat, maxLng, maxLat]. */
  bbox?: [number, number, number, number];
}

const GEO_TIMEOUT_MS = 6000;

/* Module-level cache — persists across pages within a single build. */
const _cache = new Map<string, LatLng | null>();

export async function geocodeAddress(
  query: string | null | undefined,
  token: string | null | undefined,
  opts: GeocodeOpts = {}
): Promise<LatLng | null> {
  const q = String(query ?? "").trim();
  if (!q || !token) return null;

  const cacheKey = q.toLowerCase();
  if (_cache.has(cacheKey)) return _cache.get(cacheKey) ?? null;

  try {
    let url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?access_token=${token}` +
      `&limit=1` +
      `&types=poi,address,place,neighborhood`;
    if (opts.bbox) url += `&bbox=${opts.bbox.join(",")}`;
    if (opts.proximity) url += `&proximity=${opts.proximity[0]},${opts.proximity[1]}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) });
    if (!res.ok) {
      _cache.set(cacheKey, null);
      return null;
    }

    const data: any = await res.json();
    const feature = data?.features?.[0];
    if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) {
      _cache.set(cacheKey, null);
      return null;
    }

    const [lng, lat] = feature.center as [number, number];
    const result: LatLng = { lat, lng };
    _cache.set(cacheKey, result);
    return result;
  } catch {
    _cache.set(cacheKey, null);
    return null;
  }
}
