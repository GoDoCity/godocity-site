/**
 * functions/api/vibe-admin.js
 * Cloudflare Pages Function — admin view + manual adjustment of Vibe Check
 * vote counts. Used by src/pages/daytona/vibe-check/admin.astro.
 *
 * Endpoint : GET  /api/vibe-admin?poll=<pollId>&option=<label>&option=<label>…
 *              → real vote counts per option, summed offsets, displayed totals,
 *                and the full adjustment log for the poll.
 *            POST /api/vibe-admin   (JSON: { poll_id, option_label, delta, note })
 *              → appends one offset row to vibe_check_adjustments.
 * Auth     : Authorization: Bearer <ADMIN_TOKEN>
 *
 * Real votes (vibe_check_votes) are never modified — every change is a logged
 * +/- row in vibe_check_adjustments; "undo" is just the opposite offset.
 * Talks to Supabase's REST API with fetch (no npm packages, Workers runtime).
 *
 * Pages env (Settings → Environment variables):
 *   SUPABASE_SERVICE_ROLE_KEY  secret — bypasses RLS for the adjustment insert
 *   ADMIN_TOKEN                secret — shared admin password for this endpoint
 *   PUBLIC_SUPABASE_URL        already set for the build; SUPABASE_URL overrides
 */

export async function onRequestGet({ request, env }) {
  const denied = checkAuth(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const pollId = (url.searchParams.get("poll") || "").trim();
  const options = url.searchParams.getAll("option").map((o) => o.trim()).filter(Boolean);
  if (!pollId) return jsonResponse({ ok: false, error: "Missing ?poll=" }, 400);

  try {
    const adjustments = await sb(env, `vibe_check_adjustments?poll_id=eq.${enc(pollId)}&select=*&order=created_at.desc`);

    const offsets = {};
    for (const a of adjustments) {
      offsets[a.option_label] = (offsets[a.option_label] ?? 0) + a.delta;
    }

    // Count per option with exact HEAD counts so totals aren't capped by the
    // REST API's max-rows limit. Include any label that only appears in offsets.
    const labels = [...new Set([...options, ...Object.keys(offsets)])];
    const real = {};
    await Promise.all(labels.map(async (label) => {
      real[label] = await sbCount(env, `vibe_check_votes?question_text=eq.${enc(pollId)}&option_selected=eq.${enc(label)}`);
    }));
    const realTotal = await sbCount(env, `vibe_check_votes?question_text=eq.${enc(pollId)}`);

    const displayed = {};
    for (const label of labels) {
      displayed[label] = Math.max(0, (real[label] ?? 0) + (offsets[label] ?? 0));
    }

    return jsonResponse({
      ok: true,
      poll_id: pollId,
      options: labels,
      real,
      real_total: realTotal,
      offsets,
      displayed,
      displayed_total: Object.values(displayed).reduce((a, b) => a + b, 0),
      adjustments,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = checkAuth(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body must be JSON." }, 400);
  }

  const pollId = String(body.poll_id ?? "").trim();
  const optionLabel = String(body.option_label ?? "").trim();
  const delta = Number(body.delta);
  const note = String(body.note ?? "").trim().slice(0, 500) || null;

  if (!pollId || !optionLabel) {
    return jsonResponse({ ok: false, error: "poll_id and option_label are required." }, 400);
  }
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) {
    return jsonResponse({ ok: false, error: "delta must be a non-zero whole number." }, 400);
  }

  try {
    const [row] = await sb(env, "vibe_check_adjustments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ poll_id: pollId, option_label: optionLabel, delta, note }),
    });
    return jsonResponse({ ok: true, adjustment: row });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */

function checkAuth(request, env) {
  if (!env.ADMIN_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY || !supabaseUrl(env)) {
    return jsonResponse({ ok: false, error: "Admin endpoint is not configured." }, 503);
  }
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }
  return null;
}

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < eb.length; i++) diff |= (ea[i] ?? 0) ^ eb[i];
  return diff === 0;
}

/* ── Supabase REST helpers ────────────────────────────────────────────────── */

function supabaseUrl(env) {
  return (env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
}

function sbHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sb(env, path, init = {}) {
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders(env, init.headers),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbCount(env, path) {
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/${path}&select=*`, {
    method: "HEAD",
    headers: sbHeaders(env, { Prefer: "count=exact" }),
  });
  if (!res.ok) throw new Error(`Supabase count ${res.status}`);
  // Content-Range: "0-24/57" or "*/0"
  const total = (res.headers.get("Content-Range") || "").split("/")[1];
  return Number(total) || 0;
}

const enc = (v) => encodeURIComponent(v);

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
