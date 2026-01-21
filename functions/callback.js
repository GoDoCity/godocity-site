export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing code.", { status: 400 });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenJson = await tokenRes.json();
  const token = tokenJson?.access_token;

  if (!token) {
    return new Response(`OAuth failed: ${JSON.stringify(tokenJson)}`, { status: 400 });
  }

  // Decap expects the popup to postMessage back to the opener window
  // and then close.
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Authenticating…</title></head>
  <body>
    <script>
      (function () {
        var msg = 'authorization:github:success:' + JSON.stringify({ token: ${JSON.stringify(token)} });
        if (window.opener) {
          window.opener.postMessage(msg, '*');
        }
        window.close();
      })();
    </script>
    <p>Authentication complete. You can close this window.</p>
  </body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
