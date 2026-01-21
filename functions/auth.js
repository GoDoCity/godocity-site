export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Optional: keep state to reduce CSRF risk
  const state = crypto.randomUUID();

  // IMPORTANT: callback must be the Pages Function callback route
  const redirectUri = `${url.origin}/callback`;

  const gh = new URL("https://github.com/login/oauth/authorize");
  gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  gh.searchParams.set("redirect_uri", redirectUri);
  gh.searchParams.set("scope", "repo");
  gh.searchParams.set("state", state);

  return Response.redirect(gh.toString(), 302);
}
