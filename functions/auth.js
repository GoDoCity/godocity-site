export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);

  // GitHub MUST send the user back here
  redirect.searchParams.set("redirect_uri", `${env.SITE_URL}/callback`);

  // keep it simple; repo scope lets Decap write content
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
