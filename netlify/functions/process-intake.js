/**
 * netlify/functions/submit-event.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the "Submit an Event" form POST with zero external npm packages.
 * Uses native Node 20 fetch (no nodemailer, no dependencies).
 *
 * EMAIL SETUP (one-time, 5 minutes):
 *   1. Go to https://resend.com  →  create free account (3 000 emails/month)
 *   2. Get your API key from the Resend dashboard
 *   3. In Netlify → Site Settings → Environment Variables, add:
 *        RESEND_API_KEY   =  re_xxxxxxxxxxxxxxxx
 *        NOTIFY_EMAIL     =  yellowcabking@msn.com  (already the default)
 *   4. Re-deploy — email will arrive for every new submission.
 *
 * WITHOUT the env var: the submission is still logged in Netlify Function
 * logs (Netlify dashboard → Functions → submit-event → Logs) and the user
 * always gets redirected to /submit-success/.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NOTIFY_EMAIL_DEFAULT = "yellowcabking@msn.com";

export const handler = async (event) => {
  /* Only accept POST */
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  /* Parse URL-encoded form body — native in Node 20 */
  const params = new URLSearchParams(event.body ?? "");
  const d = Object.fromEntries(params.entries());

  /* Honeypot — silent success if bot fills hidden field */
  if (d["bot-field"]) {
    return ok();
  }

  /* Validate minimum required fields */
  if (!d["event-title"] || !d["event-date"] || !d["contact-email"]) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Missing required fields." }),
    };
  }

  /* ── Log submission — always visible in Netlify Function logs ── */
  console.log("[submit-event] New submission received:", JSON.stringify({
    title:    d["event-title"],
    date:     d["event-date"],
    endDate:  d["event-end-date"]     || null,
    venue:    d["event-venue"]        || null,
    city:     d["event-city"]         || null,
    category: d["event-category"]     || null,
    url:      d["event-url"]          || null,
    contact:  d["contact-name"]       || null,
    email:    d["contact-email"],
    org:      d["contact-org"]        || null,
  }, null, 2));

  /* ── Email notification via Resend (free tier, native fetch, no packages) ── */
  const resendKey = process.env.RESEND_API_KEY;
  const notifyTo  = process.env.NOTIFY_EMAIL ?? NOTIFY_EMAIL_DEFAULT;

  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          from:    "GoDoDaytona <onboarding@resend.dev>",
          to:      [notifyTo],
          subject: `[Event Submission] ${d["event-title"]}`,
          html:    buildEmailHtml(d),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[submit-event] Resend error:", err);
      } else {
        console.log(`[submit-event] Email sent to ${notifyTo}`);
      }
    } catch (err) {
      /* Never let email failure block the form success */
      console.error("[submit-event] Email send failed:", err.message);
    }
  } else {
    console.log(
      "[submit-event] RESEND_API_KEY not configured. " +
      "Submission logged above. See function header for setup instructions."
    );
  }

  return ok();
};

function ok() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
}

function row(label, value) {
  if (!value) return "";
  return `
    <tr>
      <td style="font-weight:700;padding:6px 14px 6px 0;color:#666;
                 white-space:nowrap;vertical-align:top;font-size:13px">${label}</td>
      <td style="padding:6px 0;color:#111;font-size:14px">${value}</td>
    </tr>`;
}

function buildEmailHtml(d) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif">
  <div style="max-width:580px;margin:32px auto;background:#fff;
              border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1)">

    <div style="background:#f9d900;padding:20px 28px">
      <h1 style="margin:0;font-size:20px;font-weight:900;color:#000">
        New Event Submission
      </h1>
      <p style="margin:4px 0 0;font-size:13px;color:#333">
        Received via GoDoDaytona
      </p>
    </div>

    <div style="padding:24px 28px">
      <p style="margin:0 0 16px;font-size:11px;font-weight:900;
                text-transform:uppercase;letter-spacing:.08em;color:#999">
        Event Details
      </p>
      <table style="width:100%;border-collapse:collapse">
        ${row("Title",       d["event-title"])}
        ${row("Start Date",  d["event-date"])}
        ${row("End Date",    d["event-end-date"])}
        ${row("Category",    d["event-category"])}
        ${row("Venue",       d["event-venue"])}
        ${row("City",        d["event-city"])}
        ${row("URL",         d["event-url"] ? `<a href="${d["event-url"]}">${d["event-url"]}</a>` : "")}
        ${row("Description", d["event-description"])}
      </table>

      <p style="margin:20px 0 8px;font-size:11px;font-weight:900;
                text-transform:uppercase;letter-spacing:.08em;color:#999;
                border-top:1px solid #eee;padding-top:20px">
        Submitted By
      </p>
      <table style="width:100%;border-collapse:collapse">
        ${row("Name",  d["contact-name"])}
        ${row("Email", d["contact-email"] ? `<a href="mailto:${d["contact-email"]}">${d["contact-email"]}</a>` : "")}
        ${row("Org",   d["contact-org"])}
      </table>
    </div>

    <div style="background:#fafafa;padding:16px 28px;border-top:1px solid #eee">
      <p style="margin:0;font-size:12px;color:#999">
        To publish: copy the event data to
        <code>src/data/manual-events.json</code> → <code>quickEntry[]</code>
        and push to deploy.
      </p>
    </div>

  </div>
</body></html>`;
}
