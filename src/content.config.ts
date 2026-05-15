/**
 * Content Collections (Astro v6 loader API).
 */

import { defineCollection, type SchemaContext } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

/**
 * Build the post / page frontmatter schema.
 *
 * `heroImage` accepts THREE shapes:
 *   1. An imported asset via `image()` — a path RELATIVE TO THE
 *      MARKDOWN FILE pointing into `src/assets/...`. Astro resolves
 *      it through its image pipeline (WebP, responsive `srcset`,
 *      width/height inferred). This is the recommended option.
 *   2. A public path (e.g. `/images/foo.jpg`) — copied as-is, NOT
 *      optimized.
 *   3. An external URL (https://…) — optimized at build if the host
 *      is allow-listed in `image.remotePatterns` in `astro.config.mjs`.
 */
const baseFrontmatter = ({ image }: SchemaContext) =>
  z.object({
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(280),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    categories: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    heroImage: z.union([image(), z.string()]).optional(),
    heroImageAlt: z.string().optional(),
    showFeaturedImage: z.boolean().optional(),
    dynamicPostCardHeight: z.boolean().optional(),
    canonicalURL: z.url().optional(),
    comments: z.boolean().optional(),
    toc: z.boolean().default(true),
    pinned: z.boolean().default(false),
    math: z.boolean().default(false),
  });

export type PostFrontmatter = z.infer<ReturnType<typeof baseFrontmatter>>;

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/posts',
  }),
  schema: baseFrontmatter,
});

const pages = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/pages',
  }),
  schema: (ctx) =>
    baseFrontmatter(ctx)
      .partial({ pubDate: true })
      .extend({
        showInNav: z.boolean().default(false),
      }),
});

export const collections = { posts, pages };
