/**
 * src/pages/daytona/posts.json.ts
 *
 * Static JSON feed of Daytona posts authored in the Sveltia CMS
 * (src/content/posts), emitted at build time to
 *   https://godocity-site.pages.dev/daytona/posts.json
 *
 * The GoDoDaytona newsletter builder (godoevents-site,
 * scripts/build-newsletter.ts) reads it each morning: the newest post marked
 * Featured with a recent pubDate leads the edition, with its headline,
 * description and hero image, linking back to its page here. Being in this
 * feed means the post is deployed, so the link always resolves.
 *
 * Same post filter and slug rules as daytona/posts/[...slug].astro, so `url`
 * is that page's real address. Image paths are absolutised to this origin.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const prerender = true;

const ORIGIN = "https://godocity-site.pages.dev";
const LIMIT = 50;

function absolutise(src: unknown): string | null {
  const s = String(src ?? "").trim();
  if (!s) return null;
  const abs = /^https?:\/\//i.test(s) ? s : `${ORIGIN}${s.startsWith("/") ? "" : "/"}${s}`;
  // Uploads keep their filenames ("GoDo Blueprint H.png"); email clients need %20.
  try {
    return encodeURI(decodeURI(abs));
  } catch {
    return encodeURI(abs);
  }
}

function isFeatured(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "yes" || s === "1";
}

function postDate(d: Record<string, any>): Date | null {
  const v = d.pubDate ?? d.date ?? d.published ?? d.updated;
  if (!v) return null;
  const date = new Date(v);
  return isNaN(date.getTime()) ? null : date;
}

export const GET: APIRoute = async () => {
  const posts = await getCollection("posts");
  const daytona = posts
    .filter((post) => {
      const city = String(post?.data?.city ?? "daytona").toLowerCase().trim();
      if (city === "daytona") return true;
      return typeof post?.id === "string" && post.id.startsWith("daytona/");
    })
    .map((post) => ({ post, date: postDate(post.data as Record<string, any>) }))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, LIMIT);

  const items = daytona.map(({ post, date }) => {
    const parts = post.slug.split("/");
    const slug = parts.length > 1 && parts[0] === "daytona" ? parts.slice(1).join("/") : post.slug;
    const d = post.data as Record<string, any>;
    return {
      id: post.id,
      slug,
      url: `${ORIGIN}/daytona/posts/${slug}/`,
      title: d.title,
      description: d.description ?? null,
      // Date-only CMS values ("2026-11-18") stay as that calendar day.
      pubDate: date ? date.toISOString().slice(0, 10) : null,
      author: d.author ?? null,
      category: d.category ?? null,
      sponsorTier: d.sponsorTier ?? null,
      featured: isFeatured(d.featured),
      heroImage: absolutise(d.heroImage ?? d.image ?? d.thumbnail),
    };
  });

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), posts: items }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
