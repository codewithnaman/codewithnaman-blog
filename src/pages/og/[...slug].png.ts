/**
 * Dynamic OG image endpoint.
 *
 * Generates a 1200×630 PNG for each post that doesn't have a custom
 * heroImage. Posts WITH a heroImage get their image used as the OG
 * directly (handled in the SEO/layout layer) — this endpoint only
 * produces fallback images for posts that lack one.
 *
 * Route: /og/[...slug].png
 * Example: /og/welcome.png → OG image for the "welcome" post
 */
/* global Response */
import type { GetStaticPaths } from 'astro';
import { generateOgImage } from '../../utils/og-image';
import { getPosts, postSlug, type Post } from '../../utils/posts';
import { SITE } from '../../config';
import { formatDate } from '../../i18n/utils';

export const getStaticPaths: GetStaticPaths = async () => {
  if (!SITE.autoOgImage || import.meta.env.CI_SKIP_AUTO_OG_IMAGE === 'true') return [];

  const posts = await getPosts();
  return posts.map((post) => ({
    params: { slug: postSlug(post) },
    props: { post },
  }));
};

interface Props {
  post: Post;
}

export async function GET({ props }: { props: Props }) {
  const { post } = props;

  const date = post.data.pubDate ? formatDate(post.data.pubDate) : undefined;

  const png = await generateOgImage({
    title: post.data.title,
    description: post.data.description,
    date,
    category: post.data.categories[0],
    tags: post.data.tags,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
