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
    city:        z.string().optional(),
    featured:    z.boolean().optional(),
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
    moreGuides: z.array(z.object({
      emoji: z.string(),
      label: z.string(),
      sub:   z.string(),
      href:  z.string(),
    })).optional(),
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
  }),
});

export const collections = { posts, guides, globalSponsors, events };
