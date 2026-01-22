// /functions/callback.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
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

  // ✅ This is the IMPORTANT part:
  // Decap expects the popup to postMessage() the token to the opener.
  const siteOrigin = new URL(env.SITE_URL).origin;
  const payload = {
    token: tokenJson.access_token,
    provider: "github",
  };

  const html = `<!doctype html>
<html>
  <body>
    <script>
      (function() {
        var payload = ${JSON.stringify(payload)};
        // Decap listens for this exact message format:
        var msg = 'authorization:github:success:' + JSON.stringify(payload);
        if (window.opener) {
          window.opener.postMessage(msg, ${JSON.stringify(siteOrigin)});
        }
        window.close();
      })();
    </script>
    Logged in. You can close this window.
  </body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
