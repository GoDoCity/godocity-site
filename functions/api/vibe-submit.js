/**
 * functions/api/vibe-submit.js
 * Cloudflare Pages Function — accepts Vibe Board submissions from the modal on
 * src/pages/[city]/vibe/index.astro.
 *
 * Endpoint : POST /api/vibe-submit   (JSON)
 *   { city, first_name, last_name, email, category, message,
 *     "bot-field" }
 *
 * Every submitter is added to the newsletter list: the modal's fine print
 * tells them so ("…and to receive the weekly GoDo<City> newsletter"), so
 * newsletter_opt_in is always stored as true to record that sign-up.
 *
 * Every row is inserted as status = 'pending' with the service-role key; the
 * public anon key cannot insert, so this is the only way in. Editors approve
 * from /daytona/vibe-check/admin/ (functions/api/vibe-posts-admin.js).
 *
 * Optional side effects (no-op when the env vars are missing):
 *   BEEHIIV_API_KEY + BEEHIIV_PUBLICATION_ID → subscribe the submitter
 *   RESEND_API_KEY                           → notify the desk of a new post
 *
 * Pages env: SUPABASE_SERVICE_ROLE_KEY (secret), PUBLIC_SUPABASE_URL.
 */
import { allCitySlugs, getDisplayName } from "../../src/lib/cityConfigs.js";
import { VIBE_LIMITS, vibeCategory } from "../../src/lib/vibeBoard.js";
import { hasServiceRole, jsonResponse, sb } from "../../src/lib/server/supabaseRest.js";

/* Notification target — same desk inbox as submit.js / submit-tip.js */
const NOTIFY_EMAIL = "yellowcabking@msn.com";

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body must be JSON." }, 400);
  }

  /* Honeypot — silent accept so bots think they succeeded */
  if (d["bot-field"]) return jsonResponse({ ok: true });

  const post = {
    city:              clean(d.city).toLowerCase(),
    first_name:        clean(d.first_name),
    last_name:         clean(d.last_name),
    email:             clean(d.email).toLowerCase(),
    category:          clean(d.category),
    message:           String(d.message ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    newsletter_opt_in: true,  // disclosed in the modal fine print — see header
  };

  const problem = validate(post);
  if (problem) return jsonResponse({ ok: false, error: problem }, 400);

  if (!hasServiceRole(env)) {
    console.error("[vibe-submit] SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL not configured");
    return jsonResponse({ ok: false, error: "Submissions are temporarily unavailable." }, 503);
  }

  try {
    await sb(env, "vibe_posts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(post),
    });
  } catch (err) {
    console.error("[vibe-submit] insert failed:", err?.message ?? err);
    return jsonResponse({ ok: false, error: "Couldn't save your post — please try again." }, 502);
  }

  // Side effects never fail the submission.
  await Promise.allSettled([
    subscribe(env, post.email),
    notifyDesk(env, post),
  ]);

  return jsonResponse({ ok: true });
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function validate(p) {
  if (!allCitySlugs.includes(p.city)) return "Unknown city.";
  if (!p.first_name || !p.last_name) return "Please enter your first and last name.";
  if (p.first_name.length > VIBE_LIMITS.name || p.last_name.length > VIBE_LIMITS.name) return "Name is too long.";
  if (p.email.length > VIBE_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return "Please enter a valid email address.";
  if (!vibeCategory(p.category)) return "Please choose a category.";
  if (p.message.length < VIBE_LIMITS.messageMin) return `Your message needs at least ${VIBE_LIMITS.messageMin} characters.`;
  if (p.message.length > VIBE_LIMITS.messageMax) return `Please keep your message under ${VIBE_LIMITS.messageMax} characters.`;
  return null;
}

async function subscribe(env, email) {
  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUBLICATION_ID) {
    console.log("[vibe-submit] Newsletter sign-up (Beehiiv not configured — add manually):", email);
    return;
  }
  const res = await fetch(
    `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUBLICATION_ID}/subscriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        reactivate_existing: true,
        send_welcome_email: true,
        utm_source: "vibe-board",
      }),
    }
  );
  if (!res.ok) console.warn("[vibe-submit] Beehiiv subscribe error:", res.status, await res.text().catch(() => ""));
}

async function notifyDesk(env, p) {
  if (!env.RESEND_API_KEY) return;
  const cat = vibeCategory(p.category);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "GoDoCity <onboarding@resend.dev>",
      to: [NOTIFY_EMAIL],
      subject: `New Vibe Board post awaiting review (${getDisplayName(p.city)})`,
      html: `<p><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong> · ${esc(cat?.label)} · ${esc(getDisplayName(p.city))}</p>
             <p style="white-space:pre-line">${esc(p.message)}</p>
             <p>Review it at <a href="https://godocity-site.pages.dev/daytona/vibe-check/admin/">the Vibe admin</a> → Vibe Board.</p>`,
    }),
  });
  if (!res.ok) console.warn("[vibe-submit] Resend error:", res.status, await res.text().catch(() => ""));
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
