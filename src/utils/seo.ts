/* global URL */
import { SITE } from '../config';
import { withBase } from '../i18n/utils';

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  type: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
}

interface BuildSeoArgs {
  title?: string;
  description?: string;
  pathWithoutLocale: string;
  fullPath: string;
  ogImage?: string;
  type?: 'website' | 'article';
  publishedTime?: Date;
  modifiedTime?: Date;
  tags?: string[];
}

/** Build the SEO data block consumed by `<SEO />`. */
export function buildSeo(args: BuildSeoArgs): SeoMeta {
  return {
    title: args.title && args.title !== SITE.title ? `${args.title} — ${SITE.title}` : SITE.title,
    description: args.description ?? SITE.description,
    canonical: new URL(args.fullPath, SITE.url).toString(),
    ogImage: args.ogImage
      ? new URL(withBase(args.ogImage), SITE.url).toString()
      : SITE.defaultOgImage
        ? new URL(withBase(SITE.defaultOgImage), SITE.url).toString()
        : `${SITE.url}/og/default.png`,
    type: args.type ?? 'website',
    publishedTime: args.publishedTime?.toISOString(),
    modifiedTime: args.modifiedTime?.toISOString(),
    tags: args.tags,
  };
}
