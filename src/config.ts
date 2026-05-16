import avatarImg from './assets/images/site/avatar.jpg';
import type { SiteConfig, NavItem, SocialLink, GiscusConfig } from './types/config';

export const SITE_IMAGES = {
  avatar: avatarImg,
} as const;

const GITHUB_HANDLE = import.meta.env.PUBLIC_GITHUB_HANDLE ?? '';
const TWITTER_HANDLE = import.meta.env.PUBLIC_TWITTER_HANDLE ?? '';
const CONTACT_EMAIL = import.meta.env.PUBLIC_CONTACT_EMAIL ?? '';
const THEME_REPO_URL = 'https://github.com/kannansuresh/chirping-astro';

export const REPO = {
  handle: GITHUB_HANDLE,
  url: GITHUB_HANDLE ? `https://github.com/${GITHUB_HANDLE}` : 'https://github.com',
} as const;

export const SITE: SiteConfig = {
  title: 'CodeWithNaman Blog',
  description: 'Engineering, System Design, FinTech, Cloud & AI — a technical blog by Naman Gupta.',
  author: {
    name: 'Naman Gupta',
    url: 'https://codewithnaman.com',
    avatar: avatarImg,
  },
  defaultOgImage: undefined,
  postsPerPage: 8,
  isoDates: false,
  showFeaturedImages: true,
  boxedArticles: false,
  dynamicPostCardHeight: false,
  autoOgImage: true,
  showPrivacyPolicy: false,
  footer: {
    leftText: undefined,
    rightText: undefined,
    showPrivacyPolicy: false,
    showThemeCredits: false,
    themeName: 'Chirping Astro',
    themeUrl: THEME_REPO_URL,
  },
  url: import.meta.env.SITE_URL || 'https://blog.codewithnaman.com',
};

export const NAV: readonly NavItem[] = [
  { key: 'home', href: '/', icon: 'lucide:home' },
  { key: 'posts', href: '/posts', icon: 'lucide:file-text' },
  { key: 'categories', href: '/categories', icon: 'lucide:layers' },
  { key: 'tags', href: '/tags', icon: 'lucide:tag' },
  { key: 'about', href: '/about', icon: 'lucide:info' },
] as const;

export const SOCIALS: readonly SocialLink[] = [
  GITHUB_HANDLE && {
    label: 'GitHub',
    href: `https://github.com/${GITHUB_HANDLE}`,
    icon: 'simple-icons:github',
  },
  TWITTER_HANDLE && {
    label: 'Twitter',
    href: `https://x.com/${TWITTER_HANDLE}`,
    icon: 'simple-icons:x',
  },
  CONTACT_EMAIL && {
    label: 'Email',
    href: `mailto:${CONTACT_EMAIL}`,
    icon: 'lucide:mail',
  },
  { label: 'RSS', href: '/rss.xml', icon: 'lucide:rss' },
].filter(Boolean) as SocialLink[];

export const GISCUS: GiscusConfig = {
  enabled: (import.meta.env.PUBLIC_GISCUS_ENABLED ?? 'false') === 'true',
  repo: import.meta.env.PUBLIC_GISCUS_REPO ?? '',
  repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID ?? '',
  category: import.meta.env.PUBLIC_GISCUS_CATEGORY ?? 'Announcements',
  categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID ?? '',
  mapping: 'pathname',
  strict: '0',
  reactionsEnabled: '1',
  emitMetadata: '0',
  inputPosition: 'bottom',
  loading: 'lazy',
};

export const PAGEFIND = {
  bundlePath: '/_pagefind/',
  pageSize: 10,
} as const;
