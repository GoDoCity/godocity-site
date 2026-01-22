export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const siteOrigin = url.origin;

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(`Missing code.\n\nFull URL:\n${url.toString()}`, {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenJson = await tokenRes.json();

  if (!tokenJson.access_token) {
    return new Response(`OAuth failed:\n${JSON.stringify(tokenJson, null, 2)}`, {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }

  // Decap expects access_token + token_type in the URL hash
  const redirectTo =
    `${siteOrigin}/admin/#access_token=${tokenJson.access_token}&token_type=Bearer`;

  return Response.redirect(redirectTo, 302);
}
