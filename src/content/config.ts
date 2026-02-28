// src/content/config.ts
// ─────────────────────────────────────────────────────────────────────────────
// Astro Content Collection schemas for GoDo City
//
// ADD THIS FILE if you don't have one yet, or MERGE the `guides` block
// into your existing defineCollection calls if you already have a config.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { defineCollection, z } from "astro:content";

/* ── Existing posts collection (keep whatever you already have) ────────── */
const posts = defineCollection({
  type: "content",
  schema: z.object({
    title:       z.string(),
    description: z.string().optional(),
    pubDate:     z.coerce.date().optional(),
    author:      z.string().optional(),
    heroImage:   z.string().optional(),
    tags:        z.array(z.string()).optional(),
    category:    z.string().optional(),
    city:        z.string().optional(),
    featured:    z.boolean().optional(),
  }),
});

/* ── Guides collection ─────────────────────────────────────────────────── */
const guides = defineCollection({
  type: "content",
  schema: z.object({

    /* Required */
    city:     z.string(),          // "daytona" — used in URL and breadcrumb
    title:    z.string(),          // "The 10 Best Restaurants in Daytona Beach"
    intro:    z.string(),          // Lead paragraph shown in hero

    /* Optional meta */
    category: z.string().optional().default("City Guide"),
    author:   z.string().optional().default("Charles King"),
    role:     z.string().optional().default("Newsletter Editor"),
    pubDate:  z.coerce.date().optional(),
    heroImage:z.string().optional(), // optional banner image above the list

    /* The ranked list — each item is one entry */
    items: z.array(
      z.object({
        rank:   z.number().int().min(1).max(20),
        tag:    z.string().optional(),          // "Fine Dining", "Seafood" …
        title:  z.string(),
        body:   z.string(),
        img:    z.string().optional().default(""),
        imgAlt: z.string().optional().default(""),
        href:   z.string().optional().default(""),
      })
    ).min(1).max(20),

    /* "See More Guides" footer cards — override per guide if needed */
    moreGuides: z.array(
      z.object({
        emoji: z.string(),
        label: z.string(),
        sub:   z.string(),
        href:  z.string(),
      })
    ).optional(),

    /* ── Local sponsor — overrides globalSponsors when defined ────────────
       Sell this slot to a Daytona restaurant, realtor, or event sponsor.
       It appears between list item #3 and #4 on every guide page.
    ── */
    localSponsor: z.object({
      brand:    z.string(),                          // "Joe's Crab Shack"
      tagline:  z.string(),                          // "Fresh off the boat, every day."
      body:     z.string(),                          // 1–2 sentence description
      logo:     z.string().optional(),               // "/images/sponsors/joes-logo.png"
      img:      z.string().optional(),               // "/images/sponsors/joes-hero.jpg"
      imgAlt:   z.string().optional().default(""),
      ctaText:  z.string().optional().default("Learn more"),
      ctaHref:  z.string(),
    }).optional(),

  }),
});

export const collections = { posts, guides, globalSponsors };

/* ─────────────────────────────────────────────────────────────────────────────
   globalSponsors collection
   ─────────────────────────────────────────────────────────────────────────────
   File path:  src/content/globalSponsors/[campaign-name].md
   Example:    src/content/globalSponsors/nike-spring-2026.md

   HOW PRIORITY WORKS:
     1. Guide has `localSponsor:` in its frontmatter → local wins, global ignored
     2. No localSponsor → most recent active globalSponsors entry is shown
     3. No active global sponsors → sponsor slot is hidden (no empty space)

   ROTATION: To swap campaigns, set `active: false` on the old file and
   create a new file. The template always picks the newest active entry.
─────────────────────────────────────────────────────────────────────────────── */
const globalSponsors = defineCollection({
  type: "content",
  schema: z.object({
    active:      z.boolean().default(true),       // false = paused, hidden everywhere
    brand:       z.string(),                      // "Nike"
    tagline:     z.string(),                      // "Just Do It — Daytona style."
    body:        z.string(),                      // 1–2 sentence sponsor message
    logo:        z.string().optional(),           // "/images/sponsors/nike-logo.svg"
    img:         z.string().optional(),           // "/images/sponsors/nike-daytona.jpg"
    imgAlt:      z.string().optional().default(""),
    ctaText:     z.string().optional().default("Learn more"),
    ctaHref:     z.string(),                      // destination URL
    pubDate:     z.coerce.date().optional(),      // used to pick newest-first
  }),
});
