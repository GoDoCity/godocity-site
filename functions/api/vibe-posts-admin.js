/**
 * functions/api/vibe-posts-admin.js
 * Cloudflare Pages Function — Vibe Board approval queue. Used by the
 * "Vibe Board" tab on src/pages/daytona/vibe-check/admin.astro.
 *
 * Endpoint : GET  /api/vibe-posts-admin?status=pending|approved|rejected[&city=<slug>]
 *              → up to 200 posts (all columns, including private email),
 *                oldest first for pending, newest first otherwise.
 *            POST /api/vibe-posts-admin   (JSON: { id, status })
 *              → moves a post to approved / rejected / pending.
 * Auth     : Authorization: Bearer <ADMIN_TOKEN>
 *
 * Pages env: SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN (secrets), PUBLIC_SUPABASE_URL.
 */
import { checkAdminAuth, enc, jsonResponse, sb } from "../../src/lib/server/supabaseRest.js";

const STATUSES = new Set(["pending", "approved", "rejected"]);

export async function onRequestGet({ request, env }) {
  const denied = checkAdminAuth(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const city = (url.searchParams.get("city") || "").trim().toLowerCase();
  if (!STATUSES.has(status)) return jsonResponse({ ok: false, error: "Bad status." }, 400);

  const order = status === "pending" ? "created_at.asc" : "created_at.desc";
  let path = `vibe_posts?status=eq.${status}&select=*&order=${order}&limit=200`;
  if (city) path += `&city=eq.${enc(city)}`;

  try {
    const posts = await sb(env, path);
    return jsonResponse({ ok: true, status, posts });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = checkAdminAuth(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Body must be JSON." }, 400);
  }

  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ ok: false, error: "Bad id." }, 400);
  if (!STATUSES.has(status)) return jsonResponse({ ok: false, error: "Bad status." }, 400);

  try {
    const rows = await sb(env, `vibe_posts?id=eq.${enc(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status, reviewed_at: status === "pending" ? null : new Date().toISOString() }),
    });
    if (!rows?.length) return jsonResponse({ ok: false, error: "Post not found." }, 404);
    return jsonResponse({ ok: true, post: rows[0] });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
