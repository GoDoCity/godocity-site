export async function onRequest({ env, request }) {
  const url = new URL(request.url);

  // Decap may call /auth?provider=github&site_id=...
  // We always use GitHub, so ignore provider/site_id.
  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${url.origin}/callback`);
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
