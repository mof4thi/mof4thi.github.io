import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// English files sit at the top of each content folder; French translations
// sit in a fr/ subfolder with the same file name, which is what pairs them.
const articleSchema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  summary: z.string(),
  category: z.string().default('notes'),
  tags: z.array(z.string()).default([]),
  // Posts with draft: true are visible in `npm run dev` but never published.
  draft: z.boolean().default(false),
});

const articles = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/articles' }),
  schema: articleSchema,
});

const articlesFr = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/articles/fr' }),
  schema: articleSchema,
});

// Each project is one Markdown file. The front matter fills the collapsed
// block on /projects/, and the Markdown body is shown when it expands.
const projectSchema = z.object({
  title: z.string(),
  summary: z.string(),
  context: z.string(), // e.g. "Apprenticeship, Vistory" or "Personal"
  stack: z.array(z.string()).default([]),
  order: z.number(), // lower comes first
  featured: z.boolean().default(false), // featured blocks span the full width
  links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
});

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: projectSchema,
});

const projectsFr = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects/fr' }),
  schema: projectSchema,
});

export const collections = { articles, articlesFr, projects, projectsFr };
