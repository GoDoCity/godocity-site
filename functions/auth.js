export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const redirectUrl = new URL("https://github.com/login/oauth/authorize");
  redirectUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);

  // IMPORTANT: use the current site origin (no env var)
  redirectUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);

  redirectUrl.searchParams.set("scope", "repo");

  // optional but recommended
  redirectUrl.searchParams.set("state", crypto.getRandomValues(new Uint8Array(12)).join(""));

  return Response.redirect(redirectUrl.toString(), 302);
}
