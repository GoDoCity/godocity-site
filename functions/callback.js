export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing OAuth code", { status: 400 });
  }

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

  const token = await tokenRes.json();

  if (!token.access_token) {
    return new Response(JSON.stringify(token), { status: 400 });
  }

  return Response.redirect(
    `${env.SITE_URL}/admin/#token=${token.access_token}`,
    302
  );
}
