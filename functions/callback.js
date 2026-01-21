export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // If GitHub sent an error, show it clearly
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const errorUri = url.searchParams.get("error_uri");
  if (error) {
    return new Response(
      `GitHub OAuth error:\n\nerror=${error}\nerror_description=${errorDescription}\nerror_uri=${errorUri}\n\nFull URL:\n${url.toString()}\n`,
      { status: 400, headers: { "content-type": "text/plain" } }
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(
      `Missing code.\n\nFull URL:\n${url.toString()}\n`,
      { status: 400, headers: { "content-type": "text/plain" } }
    );
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "GoDo-Decap-Auth",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    return new Response(
      `OAuth token exchange failed:\n${JSON.stringify(tokenJson, null, 2)}`,
      { status: 400, headers: { "content-type": "text/plain" } }
    );
  }

  return Response.redirect(`${url.origin}/admin/#token=${tokenJson.access_token}`, 302);
}
