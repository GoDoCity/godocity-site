/**
 * src/lib/sheet-import.js
 *
 * Build-time Google Sheet → Eventbrite API event importer.
 *
 * The sheet must be published to the web as CSV (File → Share → Publish to web → CSV).
 * Set the public CSV URL in Cloudflare env var: SHEET_CSV_URL
 * Set your Eventbrite Private Token in Cloudflare env var: EVENTBRITE_TOKEN
 *
 * Column layout (fixed indices):
 *   A (col 0) — Eventbrite URL        (required)
 *   B (col 1) — Title override        (optional — overrides Eventbrite API name)
 *   C (col 2) — Status                ("Live" to publish, "Sponsored" = Live + featured)
 *
 * Event data (title, dates, venue, coords, image, category) comes directly from
 * the Eventbrite REST API — no HTML scraping or geocoding required.
 *
 * Returns an array of event objects in the same shape as manual-events.json quickEntry[].
 */

const CSV_TIMEOUT_MS = 12_000;  // Google Sheets CSV fetch
const API_TIMEOUT_MS =  8_000;  // per-event Eventbrite API fetch
const UA = "Mozilla/5.0 (compatible; GodoCityBot/1.0; +https://godocity.com)";

/** Regex to extract Eventbrite numeric event ID from a URL */
const EB_ID_RE = /eventbrite\.com\/e\/[^/?#]+-(\d{5,})/i;

/**
 * Fetch the Google Sheet CSV and return parsed events via the Eventbrite API.
 * Never throws — errors are logged and an empty array is returned.
 *
 * @param {string} csvUrl           Public CSV export URL from Google Sheets.
 * @param {string} eventbriteToken  Eventbrite Private Token (EVENTBRITE_TOKEN env var).
 * @returns {Promise<object[]>}
 */
export async function importFromSheet(csvUrl, eventbriteToken = "") {
  if (!csvUrl) {
    console.log("[sheet-import] ERROR: SHEET_CSV_URL env var is not set — sheet import skipped");
    return [];
  }

  if (!eventbriteToken) {
    console.log("[sheet-import] WARNING: EVENTBRITE_TOKEN env var not set — API fetches will be skipped");
  }

  let text;
  try {
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
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

  /* Payload preview — diagnose login-page vs real CSV in Cloudflare build logs */
  console.log(`[sheet-import] Payload preview (first 100 chars): ${text.slice(0, 100).replace(/\n/g, "↵")}`);

  const rows = parseCsv(text);
  const events = [];
  let firstDataRow = true;

  /* Detect whether this sheet uses a Status column.
     If any cell in any non-heading row equals "live" or "sponsored" (case-insensitive),
     we're in Status-mode and only import rows with those values.                       */
  const hasStatusColumn = rows.some(row => {
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (cells.length === 0 || isHeadingRow(cells[0], cells)) return false;
    return cells.some(c => /^(live|sponsored)$/i.test(c));
  });

  for (const row of rows) {
    /* Skip blank rows */
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    /* Skip heading rows */
    const firstCell = cells[0];
    if (isHeadingRow(firstCell, cells)) continue;

    /* Log the first data row we attempt to parse */
    if (firstDataRow) {
      console.log(`[sheet-import] First data row: ${JSON.stringify(cells.slice(0, 4))}`);
      firstDataRow = false;
    }

    /* Status filter — only import rows marked "Live" or "Sponsored" when status column exists */
    if (hasStatusColumn && !cells.some(c => /^(live|sponsored)$/i.test(c))) continue;

    /* Sponsored flag — any cell contains exactly "Sponsored" */
    const isSponsored = cells.some(c => /^sponsored$/i.test(c));

    /* Scan all cells to find the Eventbrite URL (column-agnostic) */
    const url = cells.find(c => /^https?:\/\//i.test(c)) ?? null;
    if (!url) continue;

    const idMatch = url.match(EB_ID_RE);
    if (!idMatch) {
      console.log(`[sheet-import] Skipping non-Eventbrite URL: ${url}`);
      continue;
    }
    const eventbriteId = idMatch[1];

    /* Raw column values (fixed positions, before blank-filtering) */
    const rawCells = row.map(c => c.trim());

    /* Column B — sheet title override (takes priority over Eventbrite API name) */
    const colB = rawCells[1] ?? "";
    const titleOverride = colB && !/^https?:\/\//i.test(colB) && !/^(live|sponsored)$/i.test(colB) && colB.length > 1 ? colB : null;

    /* Fetch event data from Eventbrite REST API */
    const api = await fetchEventbriteAPI(eventbriteId, eventbriteToken);

    const title     = titleOverride ?? api.title ?? `Eventbrite Event ${eventbriteId}`;
    const eventDate = api.eventDate ?? null;

    if (!eventDate) {
      console.log(`[sheet-import] No date for "${title}" (${eventbriteId}) — skipping`);
      continue;
    }

    console.log(`[EVENTBRITE API] Successfully fetched '${title}' using private token`);

    events.push({
      title,
      eventDate,
      endDate:   api.endDate  ?? null,
      location:  api.location ?? "",
      city:      api.city     ?? "daytona beach",
      url,
      image:     api.image    ?? "/images/daytona-placeholder.jpg",
      category:  api.category ?? null,
      lat:       api.lat      ?? null,
      lng:       api.lng      ?? null,
      sponsored: isSponsored,
      source:    "eventbrite-sheet",
    });
  }

  const liveLabel = hasStatusColumn ? "Live/Sponsored " : "";
  console.log(`[sheet-import] SUCCESS: Found ${events.length} ${liveLabel}events in the Google Sheet`);
  return events;
}

/* ── Helpers ── */

/**
 * Fetch a single Eventbrite event via the REST API v3 and return a partial event object.
 * Expands: venue (for coords + location name), logo (for image), category (for tag).
 * Returns {} on any failure so the caller can skip gracefully.
 */
async function fetchEventbriteAPI(eventId, token) {
  if (!token) {
    console.log(`[sheet-import] Eventbrite API skipped for ${eventId} — no token`);
    return {};
  }
  try {
    const url = `https://www.eventbriteapi.com/v3/events/${eventId}/?expand=venue,logo,category`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`[sheet-import] Eventbrite API ${eventId} → HTTP ${res.status} ${res.statusText} — skipping`);
      return {};
    }

    const data = await res.json();
    const result = {};

    /* Title */
    if (data.name?.text) result.title = data.name.text;

    /* Dates — "local" field is already in the venue's timezone; slice to YYYY-MM-DD */
    if (data.start?.local) result.eventDate = data.start.local.slice(0, 10);
    if (data.end?.local) {
      const end = data.end.local.slice(0, 10);
      if (end !== result.eventDate) result.endDate = end;
    }

    /* Venue — name, city, and precise coordinates from Eventbrite's geocoder */
    if (data.venue) {
      result.location = data.venue.name ?? "";
      result.city     = (data.venue.address?.city ?? "daytona beach").toLowerCase();

      const lat = parseFloat(data.venue.address?.latitude  ?? "");
      const lng = parseFloat(data.venue.address?.longitude ?? "");
      /* Reject (0, 0) — the "null island" default for unresolved venues */
      if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
        result.lat = lat;
        result.lng = lng;
      }
    }

    /* Image — prefer full-resolution original, fall back to display URL */
    if (data.logo?.original?.url) result.image = data.logo.original.url;
    else if (data.logo?.url)      result.image = data.logo.url;

    /* Category */
    if (data.category?.name) result.category = data.category.name;

    return result;
  } catch (err) {
    console.log(`[sheet-import] Eventbrite API ${eventId} failed (${err?.message ?? err}) — skipping`);
    return {};
  }
}

/**
 * Returns true for rows that are clearly headings or label rows, not event data.
 * Catches: "GoDoDaytona Events", "URL", "Event", "Raw Text", "Status", etc.
 */
function isHeadingRow(firstCell, cells) {
  /* Single-cell rows with no URL are headings (sheet title, section labels) */
  if (cells.length === 1 && !/^https?:\/\//i.test(firstCell)) return true;
  /* Common column-header words */
  if (/^(url|event|title|name|raw\s*text|status|description|date)$/i.test(firstCell)) return true;
  /* Sheet title: "GoDoDaytona" anywhere in the first cell */
  if (/godo(daytona|city)/i.test(firstCell)) return true;
  return false;
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
