export default {
  async fetch(request) {
    return new Response("GoDo Decap Auth Worker running", {
      headers: { "content-type": "text/plain" },
    });
  },
};
