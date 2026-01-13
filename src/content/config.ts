import { defineCollection, z } from "astro:content";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    city: z.string(),
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
  }),
});

const guides = defineCollection({
  type: "content",
  schema: z.object({
    city: z.string(),
    title: z.string(),
    description: z.string().optional(),
    section: z.string(),
  }),
});

export const collections = { posts, guides };
