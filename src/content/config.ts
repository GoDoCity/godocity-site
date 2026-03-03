// src/content/config.ts
// ─────────────────────────────────────────────────────────────────────────────
// Astro Content Collection schemas for GoDoCity
//
// ORDER MATTERS: every `const` must be defined before the export block.
// JavaScript/TypeScript `const` declarations are NOT hoisted — referencing
// `globalSponsors` in the export before it is defined causes the
// "Cannot access before initialization" build error.
//
// Correct order: imports → posts → guides → globalSponsors → export
// ─────────────────────────────────────────────────────────────────────────────

// 1. IMPORTS
import { defineCollection, z } from "astro:content";


// 2. POSTS (News & Articles)
//    File path:  src/content/posts/[city]/[slug].md
//    Template:   src/pages/[city]/[slug].astro
const posts = defineCollection({
  type: "content",
  schema: z.object({
    title:       z.string(),
    description: z.string().optional(),
    pubDate:     z.coerce.date().optional(),
    author:      z.string().optional(),
    heroImage:   z.string().optional().transform(v => v === "" ? undefined : v),
    tags:        z.array(z.string()).optional(),
    category:    z.string().optional(),
    city:        z.string().optional(),
    featured:    z.boolean().optional(),
  }),
});


// 3. GUIDES (City Listicles — "Best of" format)
//    File path:  src/content/guides/[city]/[slug].md
//    Template:   src/pages/[city]/guides/[slug].astro
//
//    NOTE: `intro` and `items` are optional so that non-listicle hub pages
//    (live.md, play.md, work.md) pass schema validation without an items array.
//    getStaticPaths filters to only build pages that have items defined.
const guides = defineCollection({
  type: "content",
  schema: z.object({

    // Required — drives the URL segment and breadcrumb
    city:  z.string(),
    title: z.string(),

    // Optional — present on listicles, absent on hub pages
    intro: z.string().optional(),

    // Optional meta
    category:  z.string().optional().default("City Guide"),
    author:    z.string().optional().default("Charles King"),
    role:      z.string().optional().default("Newsletter Editor"),
    pubDate:   z.coerce.date().optional(),
    heroImage: z.string().optional(),

    // Ranked list items — optional so hub pages pass validation
    items: z.array(
      z.object({
        rank:   z.number().int().min(1).max(20),
        tag:    z.string().optional(),
        title:  z.string(),
        body:   z.string(),
        img:    z.string().optional().default(""),
        imgAlt: z.string().optional().default(""),
        href:   z.string().optional().default(""),
      })
    ).min(1).max(20).optional(),

    // "See More Guides" footer cards — can be overridden per guide
    moreGuides: z.array(
      z.object({
        emoji: z.string(),
        label: z.string(),
        sub:   z.string(),
        href:  z.string(),
      })
    ).optional(),

    // Local sponsor — overrides globalSponsors for THIS guide only.
    // Appears between list items #3 and #4.
    // All inner fields are optional so a partially-filled draft doesn't crash.
    localSponsor: z.object({
      brand:   z.string().optional().default(""),
      tagline: z.string().optional().default(""),
      body:    z.string().optional().default(""),
      logo:    z.string().optional(),
      img:     z.string().optional(),
      imgAlt:  z.string().optional().default(""),
      ctaText: z.string().optional().default("Learn more"),
      ctaHref: z.string().optional().default(""),
    }).optional(),

  }),
});


// 4. GLOBAL SPONSORS (Network-wide campaigns — Nike, etc.)
//    File path:  src/content/globalSponsors/[campaign-name].md
//    Example:    src/content/globalSponsors/nike-spring-2026.md
//
//    HOW PRIORITY WORKS:
//      1. Guide has `localSponsor:` in frontmatter  → local wins, global ignored
//      2. No localSponsor                           → newest active global runs
//      3. No active global sponsors                 → slot hidden, no whitespace
//
//    ROTATION: set `active: false` on old campaign, create new file with a
//    later pubDate. Templates always pick the newest entry where active: true.
//
//    All string fields are optional with defaults so a campaign missing any
//    field doesn't break the build — it just renders with empty text.
const globalSponsors = defineCollection({
  type: "content",
  schema: z.object({
    active:  z.boolean().default(true),
    brand:   z.string().optional().default(""),
    tagline: z.string().optional().default(""),
    body:    z.string().optional().default(""),
    logo:    z.string().optional(),
    img:     z.string().optional(),
    imgAlt:  z.string().optional().default(""),
    ctaText: z.string().optional().default("Learn more"),
    ctaHref: z.string().optional().default(""),
    pubDate: z.coerce.date().optional(),
  }),
});


// 5. EXPORT — must come AFTER all three const declarations above.
//    Referencing any of these variables before their `const` line is
//    a temporal dead zone error: "Cannot access X before initialization".
export const collections = {
  posts,
  guides,
  globalSponsors,
};
