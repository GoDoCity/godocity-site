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
  type: 'content',
  schema: z.object({
    title: z.string(),
    topic: z.enum(['Live', 'Work', 'Play']),
    featured: z.boolean().default(false),
    showToC: z.boolean().default(true),
    image: z.string().optional(),
    description: z.string(),
    date: z.date().or(z.string()).transform((val) => new Date(val)),
  }),
});

// Legacy city-specific ranked-list guides (e.g. "Best Restaurants in Daytona")
// Stored under src/content/cityGuides/[city]/[slug].md
const cityGuides = defineCollection({
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
    section:   z.string().optional(),
    description: z.string().optional(),
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
    votingEnabled:  z.boolean().optional().default(false),
    votingStatus:   z.enum(["closed", "open", "tallying", "published"]).optional().default("closed"),
    votingDeadline: z.coerce.date().optional(),
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

// DIY GUIDES — multi-city via `cities` array; rendered by DiyPill.astro
// Intro: 2-paragraph minimum, 200-word maximum (enforced at schema level).
const diy = defineCollection({
  type: "content",
  schema: z.object({
    title:    z.string(),
    intro:    z.string()
      .refine(
        (v) => v.split(/\s+/).filter(Boolean).length <= 200,
        { message: "Intro must be 200 words or fewer." }
      )
      .refine(
        (v) => v.split(/\n\n+/).filter(Boolean).length >= 2,
        { message: "Intro must have at least 2 paragraphs (separated by a blank line)." }
      ),
    // Accept either a multiline string (new CMS textarea) or a YAML array (legacy).
    // Both are normalised to string[] before reaching the component.
    materials: z.union([
      z.string().min(1),
      z.array(z.string()).min(1),
    ]).transform((v) => Array.isArray(v) ? v : v.split("\n").map((s) => s.trim()).filter(Boolean)),
    steps: z.union([
      z.string().min(1),
      z.array(z.string()).min(1),
    ]).transform((v) => Array.isArray(v) ? v : v.split("\n").map((s) => s.trim()).filter(Boolean)),
    community_note: z.string().optional(),
    // Topic determines which nav pill feed the article appears in
    topic:          z.enum(["Clean", "Paint", "Repair", "Decorate", "Build", "Craft"]).optional(),
    // Cities this guide deploys to — e.g. ["daytona", "orlando", "904"]
    cities:         z.array(z.string()).min(1),
    pubDate:        z.coerce.date().optional(),
    author:         z.string().optional().default("Charles King"),
    heroImage:      z.string().optional().transform((v) => v === "" ? undefined : v),
    category:       z.string().optional().default("DIY"),
  }),
});

export const collections = { posts, guides, cityGuides, globalSponsors, events, diy };
