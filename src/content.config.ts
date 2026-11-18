import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writeups = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/writeups' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    category: z.string().default('notes'),
    tags: z.array(z.string()).default([]),
    // Posts with draft: true are visible in `npm run dev` but never published.
    draft: z.boolean().default(false),
  }),
});

export const collections = { writeups };
