/**
 * functions/api/submit-tip.js
 * Cloudflare Pages Function — handles community "Submit a Tip & Story" POSTs
 * from src/pages/[city]/connect.astro.
 *
 * Endpoint : POST /api/submit-tip
 * Contract : mirrors /api/submit (submit.js) — reads request.text() as
 *            application/x-www-form-urlencoded, honeypot-guards `bot-field`,
 *            and emails the desk via Resend. No npm packages (Workers runtime).
 *
 * Expected fields: tip-name, tip-email, tip-subject, tip-story
 */

/* Notification target — hard-coded, same as submit.js */
const NOTIFY_EMAIL = "yellowcabking@msn.com";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.text();
    const params = new URLSearchParams(body);
    const d = Object.fromEntries(params.entries());

    /* Honeypot — silent accept so bots think they succeeded */
    if (d["bot-field"]) {
      return ok();
    }

    /* Required field check */
    if (!d["tip-name"] || !d["tip-email"] || !d["tip-subject"] || !d["tip-story"]) {
      return jsonResponse({ ok: false, error: "Missing required fields." }, 400);
    }

    /* Basic email sanity — reject obvious garbage before we email the desk */
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d["tip-email"])) {
      return jsonResponse({ ok: false, error: "Invalid email address." }, 400);
    }

    console.log("[submit-tip] New tip:", JSON.stringify({
      name:    d["tip-name"],
      email:   d["tip-email"],
      subject: d["tip-subject"],
    }, null, 2));

    /* Email via Resend — key bound from Cloudflare env */
    const resendKey = env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn("[submit-tip] RESEND_API_KEY not set in Cloudflare environment");
    } else {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            from:     "GoDoCity <onboarding@resend.dev>",
            to:       [NOTIFY_EMAIL],
            reply_to: d["tip-email"],
            subject:  `New Community Tip: ${d["tip-subject"]}`,
            html:     buildEmailHtml(d),
          }),
        });
        if (!emailRes.ok) {
          const errText = await emailRes.text().catch(() => "");
          console.warn("[submit-tip] Resend error:", emailRes.status, errText);
        } else {
          console.log("[submit-tip] Email sent to", NOTIFY_EMAIL);
        }
      } catch (emailErr) {
        console.warn("[submit-tip] Email send failed:", emailErr?.message ?? emailErr);
      }
    }

    return ok();
  } catch (err) {
    console.error("[submit-tip] Unexpected error:", err?.message ?? err);
    return jsonResponse({ ok: false, error: "Internal server error." }, 500);
  }
}

/* ── Helpers (identical contract to submit.js) ── */

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

/* Escape user-supplied text before embedding in the notification HTML */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(d) {
  const row = (label, val) =>
    val ? `<tr><td style="padding:6px 12px;font-weight:700;white-space:nowrap;color:#555;vertical-align:top;">${label}</td><td style="padding:6px 12px;">${esc(val)}</td></tr>` : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
        <tr>
          <td style="background:#0077be;padding:20px 28px;">
            <span style="font-size:20px;font-weight:900;color:#fff;">GoDoCity — New Community Tip</span>
          </td>
        </tr>
        <tr><td style="padding:20px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${row("Subject", d["tip-subject"])}
            ${row("From",    d["tip-name"])}
            ${row("Email",   d["tip-email"])}
            ${row("Tip",     d["tip-story"])}
          </table>
        </td></tr>
        <tr><td style="padding:12px 28px 24px;font-size:12px;color:#999;">
          Submitted via the GoDoCity "Submit a Tip &amp; Story" form.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}
