export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // Always use the live origin the user is on (prevents undefined SITE_URL)
  const siteOrigin = url.origin;

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${siteOrigin}/callback`);
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
