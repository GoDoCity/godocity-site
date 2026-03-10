// src/content/config.ts
import { defineCollection, z } from "astro:content";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    title:       z.string(),
    description: z.string().optional(),
    pubDate:     z.coerce.date().optional(),
    author:      z.string().optional(),
    heroImage:   z.string().optional().transform(v => v === "" ? undefined : v),
    thumbnail:   z.string().optional().transform(v => v === "" ? undefined : v),
    tags:        z.array(z.string()).optional(),
    category:    z.string().optional(),
    subtopic:    z.string().optional(),
    sponsorTier: z.enum(["None", "Featured", "Spotlight", "Partner Highlight", "Local Guide"]).optional(),
    city:        z.string().optional(),
    featured:    z.boolean().optional(),
    map_locations: z.array(z.object({
      label:   z.string(),
      address: z.string().optional(),
      lat:     z.number().optional(),
      lng:     z.number().optional(),
    })).optional(),
  }),
});

const guides = defineCollection({
  type: "content",
  schema: z.object({
    city:      z.string(),
    title:     z.string(),
    intro:     z.string().optional(),
    category:  z.string().optional().default("City Guide"),
    author:    z.string().optional().default("Charles King"),
    role:      z.string().optional().default("Newsletter Editor"),
    pubDate:   z.coerce.date().optional(),
    heroImage: z.string().optional(),
    items: z.array(z.object({
      rank:   z.number().int().min(1).max(20),
      tag:    z.string().optional(),
      title:  z.string(),
      body:   z.string(),
      img:    z.string().optional().default(""),
      imgAlt: z.string().optional().default(""),
      href:   z.string().optional().default(""),
    })).min(1).max(20).optional(),
    map_locations: z.array(z.object({
      label:   z.string(),
      address: z.string().optional(),
      lat:     z.number().optional(),
      lng:     z.number().optional(),
    })).optional(),
    moreGuides: z.array(z.object({
      emoji: z.string(),
      label: z.string(),
      sub:   z.string(),
      href:  z.string(),
    })).optional(),
    // ── Reader Voting (Best Of series) ──────────────────────────────────
    // Set votingEnabled: true to activate the voting UI on a guide page.
    // votingStatus controls the display state of the voting widget:
    //   "closed"    → voting not yet open (default, no UI shown)
    //   "open"      → readers can submit a vote
    //   "tallying"  → polls closed, counting in progress
    //   "published" → winner announced, results shown
    votingEnabled: z.boolean().optional().default(false),
    votingStatus:  z.enum(["closed", "open", "tallying", "published"]).optional().default("closed"),
    votingDeadline: z.coerce.date().optional(),   // when "open" voting closes

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

// EVENTS — past events auto-hide via eventDate >= today filter in templates
const events = defineCollection({
  type: "content",
  schema: z.object({
    title:       z.string(),
    eventDate:   z.coerce.date(),
    endDate:     z.coerce.date().optional(),
    location:    z.string(),
    address:     z.string().optional(),
    city:        z.string().optional(),
    category:    z.string().optional(),
    description: z.string().optional(),
    url:         z.string().optional(),
    image:       z.string().optional(),
    featured:    z.boolean().optional().default(false),
    sponsored:   z.boolean().optional().default(false),
    lat:         z.number().optional(),
    lng:         z.number().optional(),
  }),
});

export const collections = { posts, guides, globalSponsors, events };
