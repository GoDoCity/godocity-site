export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

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
    return new Response(`OAuth failed: ${JSON.stringify(tokenJson)}`, { status: 400 });
  }

  // Send token back to Decap Admin
  return Response.redirect(`${url.origin}/admin/#token=${tokenJson.access_token}`, 302);
}

