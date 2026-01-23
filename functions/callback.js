function renderBody(status, content) {
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script>
      (function () {
        function receiveMessage(message) {
          // Send the result back to the Decap opener window
          window.opener.postMessage(
            'authorization:github:${status}:' + JSON.stringify(${JSON.stringify(content)}),
            message.origin
          );
          window.removeEventListener("message", receiveMessage, false);
          window.close();
        }

        window.addEventListener("message", receiveMessage, false);
        // Tell Decap we're ready
        window.opener.postMessage("authorizing:github", "*");
      })();
    </script>
  </body>
</html>`;
  return html;
}

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
      "content-type": "application/json",
      "user-agent": "cf-pages-oauth",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const result = await tokenRes.json();

  if (result.error || !result.access_token) {
    return new Response(renderBody("error", result), {
      status: 401,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  }

  // This is what Decap expects
  return new Response(
    renderBody("success", { token: result.access_token, provider: "github" }),
    { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }
  );
}
