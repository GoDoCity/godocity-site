export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const siteUrl = env.SITE_URL;

  if (!siteUrl) {
    return new Response(
      "SITE_URL is missing. Add it in Cloudflare Pages -> Settings -> Variables and Secrets (Production).",
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }

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

  // Decap expects these exact hash keys:
  const redirectTo =
    `${siteUrl}/admin/#access_token=${tokenJson.access_token}&token_type=bearer`;

  return Response.redirect(redirectTo, 302);
}

