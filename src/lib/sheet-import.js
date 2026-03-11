/**
 * src/lib/sheet-import.js
 *
 * Build-time Google Sheet → manual event importer.
 *
 * The sheet must be published to the web as CSV (File → Share → Publish to web → CSV).
 * Set the public CSV URL in Cloudflare env var: SHEET_CSV_URL
 *
 * Column layout is flexible — every cell in each row is scanned:
 *   • A cell starting with https://www.eventbrite.com → the event URL
 *   • Any other https:// cell → event URL (non-Eventbrite URLs are logged and skipped)
 *   • Rows where all cells are blank, or the first cell is a heading like
 *     "GoDoDaytona Events" / "URL" / "Event" → skipped automatically
 *
 * Returns an array of event objects in the same shape as manual-events.json quickEntry[].
 */

const CSV_TIMEOUT_MS  = 12_000;  // Google Sheets CSV fetch
const PAGE_TIMEOUT_MS =  5_000;  // per-event Eventbrite page fetch (avoid 504)
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
     If any cell in any non-heading row equals "live" (case-insensitive),
     we're in Status-mode and only import rows marked Live.              */
  const hasStatusColumn = rows.some(row => {
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (cells.length === 0 || isHeadingRow(cells[0], cells)) return false;
    return cells.some(c => /^live$/i.test(c));
  });

  for (const row of rows) {
    /* Skip blank rows */
    const cells = row.map(c => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    /* Skip heading rows — single-cell titles, or column-header rows */
    const firstCell = cells[0];
    if (isHeadingRow(firstCell, cells)) continue;

    /* Log the first data row we attempt to parse */
    if (firstDataRow) {
      console.log(`[sheet-import] First data row: ${JSON.stringify(cells.slice(0, 4))}`);
      firstDataRow = false;
    }

    /* Status filter — only import rows marked "Live" when the sheet uses that column */
    if (hasStatusColumn && !cells.some(c => /^live$/i.test(c))) continue;

    /* Scan all cells to find the Eventbrite URL (column-agnostic) */
    const url = cells.find(c => /^https?:\/\//i.test(c)) ?? null;
    if (!url) continue;

    const idMatch = url.match(EB_ID_RE);
    if (!idMatch) {
      console.log(`[sheet-import] Skipping non-Eventbrite URL: ${url}`);
      continue;
    }
    const eventbriteId = idMatch[1];

    /* Fetch og: metadata from the Eventbrite event page */
    const meta = await fetchEventbriteMeta(url, eventbriteId);

    const title = meta.title ?? `Eventbrite Event ${eventbriteId}`;
    const eventDate = meta.eventDate ?? null;

    if (!eventDate) {
      console.log(`[sheet-import] No date for "${title}" (${eventbriteId}) — skipping`);
      continue;
    }

    /* Column D (index 3 in the raw row) — explicit image URL takes priority over og:image.
       Any https:// value that is NOT the Eventbrite event URL is treated as the thumbnail. */
    const rawCells  = row.map(c => c.trim());
    const colDValue = rawCells[3] ?? "";
    const sheetImage =
      colDValue.startsWith("https://") && colDValue !== url ? colDValue : null;
    const image = sheetImage ?? meta.image ?? "/images/daytona-placeholder.jpg";

    events.push({
      title,
      eventDate,
      endDate:   meta.endDate   ?? null,
      location:  meta.location  ?? "",
      city:      meta.city      ?? "daytona beach",
      url,
      image,
      category:  meta.category  ?? null,
      lat:       meta.lat       ?? null,
      lng:       meta.lng       ?? null,
      sponsored: false,
      source:    "eventbrite-sheet",
    });
  }

  const liveLabel = hasStatusColumn ? "Live " : "";
  console.log(`[sheet-import] SUCCESS: Found ${events.length} ${liveLabel}events in the Google Sheet`);
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
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`[sheet-import] Eventbrite page ${eventbriteId} → ${res.status} — skipping`);
      return {};
    }
    const html = await res.text();
    return parseEventbritePage(html);
  } catch (err) {
    console.log(`[sheet-import] Eventbrite ${eventbriteId} timed out or failed (${err?.message ?? err}) — skipping`);
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
        /* Geo intentionally omitted — Eventbrite JSON-LD coords are unreliable.
           Pin location is set exclusively by COORD_OVERRIDES in events/index.astro. */
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  return result;
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

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'");
}
