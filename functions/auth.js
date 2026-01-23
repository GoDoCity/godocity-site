export async function onRequestGet({ env }) {
  // MUST come from Cloudflare Pages env var
  const siteUrl = env.SITE_URL;

  if (!siteUrl) {
    return new Response(
      "SITE_URL is missing. Add it in Cloudflare Pages -> Settings -> Variables and Secrets (Production).",
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${siteUrl}/callback`);
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
