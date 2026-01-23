import { defineCollection, z } from "astro:content";

const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    city: z.enum(["daytona"]).default("daytona"),
    topics: z.array(z.string()).optional(),
    guides: z.array(z.string()).optional(),
    featured: z.boolean().optional().default(false),
    pubDate: z.coerce.date(),
    heroImage: z.string().optional(),
    sourceUrl: z.string().optional(),
    hasPermission: z.boolean().optional().default(true),
  }),
});

export const collections = { posts };
