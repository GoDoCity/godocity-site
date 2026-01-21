export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", `${url.origin}/callback`);
  redirect.searchParams.set("scope", "repo");

  return Response.redirect(redirect.toString(), 302);
}
