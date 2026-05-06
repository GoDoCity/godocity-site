import { defineConfig } from "astro/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Match Astro's slug normalization: remove apostrophes and curly single quotes
function normalizeSlug(s) {
  return s.replace(/['‘’]/g, "");
}

function generateRedirects() {
  return {
    name: "generate-redirects",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const postsDir = join(__dirname, "src/content/posts");
        const lines = [];

        // Posts in src/content/posts/daytona/ — slug = "daytona/<name>"
        const daytonaDir = join(postsDir, "daytona");
        if (existsSync(daytonaDir)) {
          const files = await readdir(daytonaDir);
          for (const file of files.sort()) {
            if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
            const slug = normalizeSlug(file.replace(/\.(mdx?)$/, ""));
            lines.push(`/daytona/${slug}/ /daytona/posts/${slug}/ 301`);
          }
        }

        // Root-level posts that have city: daytona in frontmatter
        const rootFiles = await readdir(postsDir);
        for (const file of rootFiles.sort()) {
          if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;
          const content = await readFile(join(postsDir, file), "utf-8");
          const match = content.match(/^---[\s\S]*?^---/m);
          if (!match) continue;
          const fm = match[0];
          if (!/^city\s*:\s*['"]?daytona['"]?\s*$/im.test(fm)) continue;
          const slug = normalizeSlug(file.replace(/\.(mdx?)$/, ""));
          lines.push(`/daytona/${slug}/ /daytona/posts/${slug}/ 301`);
        }

        if (lines.length > 0) {
          const outPath = fileURLToPath(new URL("_redirects", dir));
          await writeFile(outPath, lines.join("\n") + "\n", "utf-8");
          console.log(`[generate-redirects] Wrote ${lines.length} redirect rules → ${outPath}`);
        }
      },
    },
  };
}

export default defineConfig({
  site: "https://godocity.com",
  trailingSlash: "always",
  image: {
    service: {
      entrypoint: "astro/assets/services/noop"
    }
  },
  integrations: [generateRedirects()],
});
