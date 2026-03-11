/**
 * src/lib/sheet-import.js
 *
 * Build-time Google Sheet → manual event importer.
 *
 * The sheet must be published to the web as CSV (File → Share → Publish to web → CSV).
 * Set the public CSV URL in Cloudflare env var: SHEET_CSV_URL
 *
 * Column layout (1-indexed):
 *   A (col 1) — Eventbrite URL  (required)
 *   B (col 2) — Override title  (optional, fills in if Eventbrite title isn't scraped)
 *   C (col 3) — eventDate       (YYYY-MM-DD, optional — Eventbrite page parse fills this)
 *   D (col 4) — city            (optional, defaults to "daytona beach")
 *   E (col 5) — lat             (optional)
 *   F (col 6) — lng             (optional)
 *
 * Returns an array of event objects in the same shape as manual-events.json quickEntry[].
 */

const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; GodoCityBot/1.0; +https://godocity.com)";

/** Regex to extract Eventbrite numeric event ID from a URL */
const EB_ID_RE = /eventbrite\.com\/e\/[^/?#]+-(\d{5,})/i;

/**
 * Fetch the Google Sheet CSV and return parsed events.
 * Never throws — errors are logged and an empty array is returned.
 *
 * @param {string} csvUrl  Public CSV export URL from Google Sheets.
 * @returns {Promise<object[]>}
 */
export async function importFromSheet(csvUrl) {
  if (!csvUrl) {
    console.log("[sheet-import] ERROR: SHEET_CSV_URL env var is not set — sheet import skipped");
    return [];
  }

  let text;
  try {
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`[sheet-import] ERROR: Could not reach the Sheet URL — HTTP ${res.status} ${res.statusText}`);
      return [];
    }
    text = await res.text();
  } catch (err) {
    console.log(`[sheet-import] ERROR: Could not reach the Sheet URL — ${err?.message ?? err}`);
    return [];
  }

  const rows = parseCsv(text);
  const events = [];

  for (const row of rows) {
    const url = (row[0] ?? "").trim();
    if (!url.startsWith("http")) continue;

    const idMatch = url.match(EB_ID_RE);
    if (!idMatch) {
      console.warn("[sheet-import] Skipping non-Eventbrite URL:", url);
      continue;
    }
    const eventbriteId = idMatch[1];

    /* Override columns from the sheet */
    const overrideTitle = (row[1] ?? "").trim() || null;
    const overrideDate  = (row[2] ?? "").trim() || null;
    const overrideCity  = (row[3] ?? "").trim() || null;
    const overrideLat   = parseFloat(row[4]) || null;
    const overrideLng   = parseFloat(row[5]) || null;

    /* Fetch og: metadata from the Eventbrite event page */
    const meta = await fetchEventbriteMeta(url, eventbriteId);

    const title = overrideTitle ?? meta.title ?? `Eventbrite Event ${eventbriteId}`;
    const eventDate = overrideDate ?? meta.eventDate ?? null;

    if (!eventDate) {
      console.warn(`[sheet-import] No date for "${title}" (${eventbriteId}) — skipping`);
      continue;
    }

    events.push({
      title,
      eventDate,
      endDate:   meta.endDate   ?? null,
      location:  meta.location  ?? "",
      city:      overrideCity   ?? meta.city ?? "daytona beach",
      url,
      image:     meta.image     ?? null,
      category:  meta.category  ?? null,
      lat:       overrideLat    ?? meta.lat ?? null,
      lng:       overrideLng    ?? meta.lng ?? null,
      sponsored: false,
      source:    "eventbrite-sheet",
    });
  }

  console.log(`[sheet-import] SUCCESS: Found ${events.length} event(s) in the Google Sheet`);
  return events;
}

/* ── Helpers ── */

/**
 * Fetch Eventbrite event page and extract og: metadata.
 * Returns a partial event object with whatever we could parse.
 */
async function fetchEventbriteMeta(url, eventbriteId) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[sheet-import] Eventbrite page ${eventbriteId} → ${res.status}`);
      return {};
    }
    const html = await res.text();
    return parseEventbritePage(html);
  } catch (err) {
    console.warn(`[sheet-import] Failed to fetch Eventbrite ${eventbriteId}:`, err?.message ?? err);
    return {};
  }
}

function parseEventbritePage(html) {
  const result = {};

  /* og:title */
  const titleM = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
               ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (titleM) result.title = decodeHtmlEntities(titleM[1]);

  /* og:image */
  const imgM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
             ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  if (imgM) result.image = imgM[1];

  /* JSON-LD — look for Event schema for date and location */
  const ldBlocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item["@type"] || !/event/i.test(String(item["@type"]))) continue;

        /* Start date */
        if (!result.eventDate && item.startDate) {
          result.eventDate = String(item.startDate).slice(0, 10);
        }
        /* End date */
        if (!result.endDate && item.endDate) {
          const end = String(item.endDate).slice(0, 10);
          if (end !== result.eventDate) result.endDate = end;
        }
        /* Location name */
        if (!result.location && item.location?.name) {
          result.location = item.location.name;
        }
        /* City */
        if (!result.city && item.location?.address?.addressLocality) {
          result.city = item.location.address.addressLocality.toLowerCase();
        }
        /* Geo */
        if (result.lat == null && item.location?.geo?.latitude) {
          const lat = parseFloat(item.location.geo.latitude);
          const lng = parseFloat(item.location.geo.longitude);
          if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
            result.lat = lat;
            result.lng = lng;
          }
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  return result;
}

/** Minimal CSV row parser — handles double-quoted fields with internal commas/newlines. */
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "";
    let inQuote = false;
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

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'");
}
