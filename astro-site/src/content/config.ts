import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    author: z.string().optional().default('Michael John Peña'),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    categories: z.array(z.string()).optional().default([]),
    image: z.string().optional(),
    cover: z.string().optional(),
    draft: z.boolean().optional().default(false),
    url: z.string().optional(),
    images: z.array(z.string()).optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};
