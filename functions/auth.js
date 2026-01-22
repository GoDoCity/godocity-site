// /functions/auth.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // Decap will call /auth?provider=github&site_id=...&scope=repo
  // We can ignore most of it and force GitHub.
  const site = env.SITE_URL; // e.g. https://godocity-site.pages.dev

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${site}/callback`);

  // use whatever scope Decap asked for, default to repo
  redirect.searchParams.set("scope", url.searchParams.get("scope") || "repo");

  // state helps, not required but nice
  redirect.searchParams.set("state", crypto.randomUUID());

  return Response.redirect(redirect.toString(), 302);
}
