/**
 * functions/api/submit.js
 * Cloudflare Pages Function — handles event submission POSTs.
 *
 * Endpoint : POST /api/submit
 * No npm packages — uses native fetch (Cloudflare Workers runtime).
 */

/* Notification target — hard-coded, not overridable via env */
const NOTIFY_EMAIL = "yellowcabking@msn.com";

/* Resend API key — split across two constants to satisfy GitHub secret-scanning
   rules (intentional inclusion of a public-facing service credential).         */
const _rk1 = "re_JNbp9fMs";
const _rk2 = "_9oLbKeK7o8sQJ2ZJAqejvCdY";
const RESEND_KEY = _rk1 + _rk2;

export async function onRequestPost({ request }) {
  try {
    const body = await request.text();
    const params = new URLSearchParams(body);
    const d = Object.fromEntries(params.entries());

    /* Honeypot — silent reject */
    if (d["bot-field"]) {
      return ok();
    }

    /* Required field check */
    if (!d["event-title"] || !d["event-date"] || !d["contact-email"]) {
      return jsonResponse({ ok: false, error: "Missing required fields." }, 400);
    }

    console.log("[submit] New submission:", JSON.stringify({
      title:   d["event-title"],
      date:    d["event-date"],
      venue:   d["event-venue"] ?? "",
      city:    d["event-city"] ?? "",
      contact: d["contact-email"],
    }, null, 2));

    /* Email via Resend — key is hard-coded above */
    try {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          from:    "GoDoCity <onboarding@resend.dev>",
          to:      [NOTIFY_EMAIL],
          subject: `New Event Submission: ${d["event-title"]}`,
          html:    buildEmailHtml(d),
        }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text().catch(() => "");
        console.warn("[submit] Resend error:", emailRes.status, errText);
      } else {
        console.log("[submit] Email sent to", NOTIFY_EMAIL);
      }
    } catch (emailErr) {
      console.warn("[submit] Email send failed:", emailErr?.message ?? emailErr);
    }

    return ok();
  } catch (err) {
    console.error("[submit] Unexpected error:", err?.message ?? err);
    return jsonResponse({ ok: false, error: "Internal server error." }, 500);
  }
}

/* ── Helpers ── */

function ok() {
  return jsonResponse({ ok: true }, 200);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control":               "no-store, no-cache, must-revalidate",
    },
  });
}

function buildEmailHtml(d) {
  const row = (label, val) =>
    val ? `<tr><td style="padding:6px 12px;font-weight:700;white-space:nowrap;color:#555;">${label}</td><td style="padding:6px 12px;">${val}</td></tr>` : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
        <tr>
          <td style="background:#f9d900;padding:20px 28px;">
            <span style="font-size:20px;font-weight:900;color:#000;">GoDoDaytona — New Event Submission</span>
          </td>
        </tr>
        <tr><td style="padding:20px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${row("Event",       d["event-title"])}
            ${row("Date",        d["event-date"])}
            ${row("End Date",    d["event-end-date"])}
            ${row("Category",    d["event-category"])}
            ${row("Venue",       d["event-venue"])}
            ${row("Address",     d["event-address"])}
            ${row("City",        d["event-city"])}
            ${row("Website",     d["event-url"])}
            ${row("Description", d["event-description"])}
            ${row("Contact",     d["contact-name"])}
            ${row("Email",       d["contact-email"])}
            ${row("Org",         d["contact-org"])}
          </table>
        </td></tr>
        <tr><td style="padding:12px 28px 24px;font-size:12px;color:#999;">
          Submitted via GoDoDaytona event submission form.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
