export default {
  async fetch() {
    return new Response("Auth worker active", {
      headers: { "content-type": "text/plain" },
    });
  },
};
