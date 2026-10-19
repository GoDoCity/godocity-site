/**
 * src/lib/server/supabaseRest.js
 * Server-only helpers for Pages Functions that talk to Supabase's REST API
 * with the service-role key (bypasses RLS). Never import this from a page —
 * it is meant for functions/api/*, where `env` holds the secrets.
 *
 * Same contract as the helpers inlined in functions/api/vibe-admin.js.
 */

export function supabaseUrl(env) {
  return (env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
}

export function hasServiceRole(env) {
  return Boolean(env.SUPABASE_SERVICE_ROLE_KEY && supabaseUrl(env));
}

export async function sb(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Bearer ADMIN_TOKEN check. Returns a Response to send back, or null when OK. */
export function checkAdminAuth(request, env) {
  if (!env.ADMIN_TOKEN || !hasServiceRole(env)) {
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

export const enc = (v) => encodeURIComponent(v);

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
