import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://godocity.com",
  trailingSlash: "always",
  image: {
    service: {
      entrypoint: "astro/assets/services/noop"
    }
  },
});
