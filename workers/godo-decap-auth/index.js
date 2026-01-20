export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Start OAuth
    if (url.pathname === "/auth") {
      const redirect = new URL("https://github.com/login/oauth/authorize");
      redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      redirect.searchParams.set("redirect_uri", `${url.origin}/callback`);
      redirect.searchParams.set("scope", "repo");
      return Response.redirect(redirect.toString(), 302);
    }

    // OAuth callback
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
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

      const redirectTo = `${env.SITE_ORIGIN}/admin/#token=${tokenJson.access_token}`;
      return Response.redirect(redirectTo, 302);
    }

    // Health check
    return new Response("GoDo Decap Auth Worker running", {
      headers: { "content-type": "text/plain" },
    });
  },
};
