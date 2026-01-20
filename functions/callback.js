export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code
    })
  });

  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    return new Response(JSON.stringify(tokenJson), { status: 400 });
  }

  return Response.redirect(
    `${url.origin}/admin/#token=${tokenJson.access_token}`,
    302
  );
}
