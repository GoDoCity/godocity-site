import { defineCollection, z } from "astro:content";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    city: z.string().optional(),
    pubDate: z.coerce.date(),
    heroImage: z.string().optional(),

    tags: z.array(z.string()).optional(),

    guides: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    sourceUrl: z.string().optional(),
    hasPermission: z.boolean().optional(),
  }),
});

export const collections = { posts };
