export async function onRequestGet({ request, env }) {
  const siteOrigin = new URL(request.url).origin;

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${siteOrigin}/callback`);
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
