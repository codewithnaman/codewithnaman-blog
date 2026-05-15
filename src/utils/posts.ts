/**
 * Post helpers.
 *
 * Wraps the `astro:content` collection API to:
 *  - filter drafts in production
 *  - sort by pubDate desc, with pinned posts first
 *  - group posts by tag / category / month
 */

import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';

import { SITE } from '../config';

export type Post = CollectionEntry<'posts'>;

const isProd = import.meta.env.PROD;
const skipPostCollections = import.meta.env.CI_SKIP_CONTENT_COLLECTIONS === 'true';

/** Public slug used for the URL: filename minus extension. */
export function postSlug(entry: Post): string {
  return entry.id.replace(/\.(md|mdx)$/i, '');
}

/** URL path for a post. */
export function postPath(entry: Post): string {
  return `/posts/${postSlug(entry)}/`;
}

/** Sort posts: pinned first, then by pubDate desc. */
export function sortPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    const at = a.data.pubDate?.valueOf?.() ?? 0;
    const bt = b.data.pubDate?.valueOf?.() ?? 0;
    return bt - at;
  });
}

/**
 * Sort posts strictly by `pubDate` (newest first), ignoring `pinned`.
 *
 * Used for prev/next post navigation: pinned posts shouldn't yank the
 * latest entry to position 0 and break the chronological chain (which
 * would label a newer post as "Previous" of an older pinned post).
 */
export function sortPostsByDate(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const at = a.data.pubDate?.valueOf?.() ?? 0;
    const bt = b.data.pubDate?.valueOf?.() ?? 0;
    return bt - at;
  });
}

/** Get all non-draft posts (drafts hidden in prod, sorted). */
export async function getPosts(): Promise<Post[]> {
  if (skipPostCollections) return [];
  const all = await getCollection('posts', (entry) => {
    if (isProd && entry.data.draft) return false;
    return true;
  });
  return sortPosts(all);
}

/** Find a single post by slug. */
export async function getPostBySlug(slug: string): Promise<Post | undefined> {
  const posts = await getPosts();
  return posts.find((p) => postSlug(p) === slug);
}

/** Tags with counts, sorted by count desc then alpha. */
export async function getTagsWithCount(): Promise<Array<{ name: string; count: number }>> {
  const posts = await getPosts();
  const map = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.data.tags) map.set(t, (map.get(t) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Categories with counts, sorted by count desc then alpha. */
export async function getCategoriesWithCount(): Promise<Array<{ name: string; count: number }>> {
  const posts = await getPosts();
  const map = new Map<string, number>();
  for (const p of posts) {
    for (const c of p.data.categories) map.set(c, (map.get(c) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Group posts by year -> month for the archives page. */
export function groupByYearMonth(posts: Post[]): Array<{
  year: number;
  months: Array<{ month: number; label: string; posts: Post[] }>;
}> {
  const buckets = new Map<number, Map<number, Post[]>>();
  for (const post of posts) {
    const date = post.data.pubDate;
    if (!date) continue;
    const y = date.getFullYear();
    const m = date.getMonth();
    if (!buckets.has(y)) buckets.set(y, new Map());
    const months = buckets.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(post);
  }
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'long' });
  return Array.from(buckets.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      months: Array.from(months.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([month, list]) => ({
          month,
          label: fmt.format(new Date(year, month, 1)),
          posts: list,
        })),
    }));
}

/**
 * Resolve whether a post should display its featured (hero) image,
 * considering the per-post override (`showFeaturedImage`) and the
 * site-wide default (`SITE.showFeaturedImages`).
 *
 * Returns `false` when there is no `heroImage` to show.
 */
export function shouldShowHero(post: Post): boolean {
  if (!post.data.heroImage) return false;
  return post.data.showFeaturedImage ?? SITE.showFeaturedImages;
}

/** The hero image source URL/path for a post (or undefined). */
export function heroImageSrc(post: Post): string | undefined {
  const img = post.data.heroImage;
  if (!img) return undefined;
  let src: string | undefined;
  if (typeof img === 'string') src = img;
  else if (typeof img === 'object' && 'src' in (img as Record<string, unknown>)) {
    src = (img as { src: string }).src;
  }
  if (!src) return undefined;
  return src;
}

/**
 * The raw hero image, suitable for passing straight to `<SmartImage>`.
 * Preserves the `ImageMetadata` shape for assets imported via the `image()` schema.
 */
export function heroImage(post: Post): ImageMetadata | string | undefined {
  const img = post.data.heroImage;
  if (!img) return undefined;
  return img as ImageMetadata | string;
}

/** Slugify a tag/category for use in URLs. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build the URL for a tag listing page. */
export function tagPath(tag: string): string {
  return `/tags/${slugify(tag)}/`;
}

/** Build the URL for a category listing page. */
export function categoryPath(category: string): string {
  return `/categories/${slugify(category)}/`;
}

/**
 * Find related posts that share at least one tag with the given post.
 * Sorted by shared tag count (desc), then pubDate (desc).
 */
export function getRelatedPosts(post: Post, allPosts: Post[], limit = 3): Post[] {
  const postTags = new Set(post.data.tags);
  return allPosts
    .filter((p) => p.id !== post.id && p.data.tags.some((t) => postTags.has(t)))
    .map((p) => ({
      entry: p,
      sharedTags: p.data.tags.filter((t) => postTags.has(t)).length,
    }))
    .sort((a, b) => {
      if (b.sharedTags !== a.sharedTags) return b.sharedTags - a.sharedTags;
      const at = a.entry.data.pubDate?.valueOf?.() ?? 0;
      const bt = b.entry.data.pubDate?.valueOf?.() ?? 0;
      return bt - at;
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}
