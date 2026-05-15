# CodeWithNaman Blog

A production-ready technical blogging platform built with [Astro](https://astro.build), TailwindCSS, and MDX. Hosted on GitHub Pages with custom domain support.

**Live site:** [blog.codewithnaman.com](https://blog.codewithnaman.com)

## Features

- **Astro 6** — Static site generation, zero JS by default
- **TailwindCSS 4 + daisyUI 5** — Utility-first styling with professional dark theme
- **MDX support** — Write posts in `.md` or `.mdx` with embedded components
- **Content Collections** — Type-safe frontmatter with Zod validation
- **Pagefind search** — Full-text search, client-side, no server needed
- **Syntax highlighting** — Expressive Code with copy button
- **Table of contents** — Smart scroll-spy with active section tracking
- **SEO** — Sitemap, RSS, OpenGraph, Twitter Cards, JSON-LD structured data
- **GitHub Pages** — Automated deployment via GitHub Actions
- **Dark mode** — Default dark theme with light mode toggle
- **Performance** — Lighthouse 95+ scores, minimal hydration

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Git

### Local Setup

```bash
# Clone the repository
git clone https://github.com/<your-username>/blog.codewithnaman.com.git
cd blog.codewithnaman.com

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) to see your blog.

## Development Workflow

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Build production site to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Run TypeScript type checking |

### Pre-commit Hooks

This project uses Husky + lint-staged. On every commit, staged files are automatically linted and formatted.

## How to Add a Blog Post

1. Create a new file in `src/content/posts/`:

```bash
touch src/content/posts/my-new-post.md
```

2. Add frontmatter at the top:

```markdown
---
title: 'My Post Title'
description: 'A brief description for SEO and listing cards (max 280 chars).'
pubDate: 2026-05-15
updatedDate: 2026-05-16
tags: [tag1, tag2, tag3]
categories: [Category1, Category2]
draft: false
toc: true
---

Your content here. Supports standard Markdown.
```

3. For MDX (with components), use `.mdx` extension:

```mdx
---
title: 'MDX Post'
description: 'Using Astro components in posts.'
pubDate: 2026-05-15
tags: [mdx]
categories: [Guide]
---

import Callout from '../../components/Callout.astro';

<Callout type="info">This is a callout component in your post!</Callout>
```

### Frontmatter Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `title` | Yes | string | Post title (1-140 chars) |
| `description` | Yes | string | Meta description (1-280 chars) |
| `pubDate` | Yes | date | Publication date |
| `updatedDate` | No | date | Last updated date |
| `tags` | No | string[] | Tags for grouping and related posts |
| `categories` | No | string[] | Categories for navigation |
| `draft` | No | boolean | Hide from production builds (default: false) |
| `toc` | No | boolean | Show table of contents (default: true) |
| `heroImage` | No | string/image | Featured image path or URL |
| `heroImageAlt` | No | string | Alt text for hero image |
| `comments` | No | boolean | Enable/disable comments per post |
| `math` | No | boolean | Enable KaTeX math rendering |

### Draft Posts

Set `draft: true` to hide a post from production builds. Draft posts are visible during development (`npm run dev`).

## Deployment

### GitHub Pages (Recommended)

The project includes a GitHub Actions workflow that builds and deploys on every push to `main`.

#### Step 1: Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/blog.codewithnaman.com.git
git branch -M main
git push -u origin main
```

#### Step 2: Enable GitHub Pages

1. Go to your repository **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. The workflow will automatically deploy on the next push

#### Step 3: Set Environment Variables (Optional)

Go to **Settings → Environments → github-pages → Environment variables** and add:

| Variable | Purpose |
|----------|---------|
| `SITE_URL` | Your production URL (default: `https://blog.codewithnaman.com`) |
| `PUBLIC_GITHUB_HANDLE` | Your GitHub username (shows GitHub icon in sidebar) |
| `PUBLIC_TWITTER_HANDLE` | Your Twitter/X handle |
| `PUBLIC_CONTACT_EMAIL` | Contact email |
| `PUBLIC_GISCUS_ENABLED` | Set to `true` to enable comments |
| `PUBLIC_GISCUS_REPO` | GitHub repo for comments (e.g., `user/repo`) |
| `PUBLIC_GISCUS_REPO_ID` | From [giscus.app](https://giscus.app) |
| `PUBLIC_GISCUS_CATEGORY` | Discussion category name |
| `PUBLIC_GISCUS_CATEGORY_ID` | From [giscus.app](https://giscus.app) |

## GitHub Pages Setup

### Using a Custom Domain (Recommended)

This project is pre-configured for `blog.codewithnaman.com`. The `public/CNAME` file contains the domain, and the deploy workflow preserves it.

1. The `public/CNAME` file already contains `blog.codewithnaman.com`
2. After deploying, go to **Settings → Pages → Custom domain**
3. Enter `blog.codewithnaman.com` and click **Save**
4. Check **Enforce HTTPS**

### Using GitHub Pages Subdomain (No Custom Domain)

If you don't have a custom domain:

1. Delete `public/CNAME`
2. Set `BASE_PATH` in `.github/workflows/deploy.yml` to `/<repo-name>`
3. Update `SITE_URL` in environment variables to `https://<username>.github.io/<repo-name>`

## DNS Setup

### Squarespace Domain

If your domain is registered with Squarespace:

1. Log in to your Squarespace account
2. Go to **Settings → Domains**
3. Click your domain → **DNS Settings**
4. Add the following records:

| Type | Host | Value |
|------|------|-------|
| CNAME | `blog` | `<your-username>.github.io` |

5. Wait up to 48 hours for DNS propagation

### Other Domain Registrars

For any registrar (Namecheap, GoDaddy, Cloudflare, etc.):

1. Add a CNAME record:
   - **Host/Name:** `blog`
   - **Value:** `<your-username>.github.io`
   - **TTL:** Automatic or 3600

2. Alternatively, use A records pointing to GitHub Pages IPs:
   - `185.199.108.153`
   - `185.199.109.153`
   - `185.199.110.153`
   - `185.199.111.153`

## Custom Domain Setup

### Step-by-Step

1. **Update `public/CNAME`** with your domain:
   ```
   blog.yourdomain.com
   ```

2. **Update `SITE_URL`** in `.env.example` and GitHub environment variables:
   ```
   SITE_URL=https://blog.yourdomain.com
   ```

3. **Configure DNS** (see DNS Setup above)

4. **Deploy** — push to `main` and the workflow will deploy with your CNAME

5. **Verify** — visit your domain and check that HTTPS is enabled

### Troubleshooting

- **DNS not propagating:** Use `dig blog.yourdomain.com` to check
- **HTTPS not working:** Go to GitHub Pages settings and click "Enforce HTTPS" (may take up to 24 hours after DNS propagation)
- **404 errors:** Ensure `public/.nojekyll` exists (prevents GitHub from running Jekyll)

## How to Customize Branding

### Site Title, Author, Tagline

Edit `src/config.ts`:

```typescript
export const SITE: SiteConfig = {
  title: 'Your Blog Name',
  description: 'Your tagline here.',
  author: {
    name: 'Your Name',
    bio: 'Your bio.',
  },
  // ...
};
```

### Social Links

Set environment variables in `.env` or GitHub settings:

```env
PUBLIC_GITHUB_HANDLE=yourusername
PUBLIC_TWITTER_HANDLE=yourhandle
PUBLIC_CONTACT_EMAIL=you@example.com
```

### Avatar & Favicon

Replace these files:
- `src/assets/images/site/avatar.svg` — Sidebar avatar
- `src/assets/images/site/favicon.svg` — Browser favicon
- `src/assets/images/site/og-default.svg` — Default OpenGraph image

### Theme Colors

Edit `src/styles/global.css` — look for the `@plugin 'daisyui/theme'` blocks to customize the color palette.

### Navigation

Edit the `NAV` array in `src/config.ts`:

```typescript
export const NAV: readonly NavItem[] = [
  { key: 'home', href: '/', icon: 'lucide:home' },
  { key: 'posts', href: '/posts', icon: 'lucide:file-text' },
  // Add or remove items here
] as const;
```

### UI Text

Edit `src/i18n/ui.ts` to customize all UI strings (navigation labels, button text, etc.).

## Project Structure

```
src/
├── assets/images/       # Static images (avatar, favicon, OG)
├── components/          # Astro components
│   ├── islands/         # Interactive islands (client-side JS)
│   └── ...
├── content/posts/       # Blog posts (.md / .mdx)
├── layouts/             # Page layouts
├── pages/               # Astro pages (file-based routing)
├── styles/              # Global CSS
└── utils/               # Utility functions
public/
├── .nojekyll            # Bypass Jekyll on GitHub Pages
├── CNAME                # Custom domain
└── robots.txt           # SEO robots configuration
```

## Architecture Decisions

- **Static-first** — All pages are pre-rendered at build time. Zero server runtime.
- **Islands architecture** — Only interactive components (search, TOC, theme toggle) ship JavaScript.
- **Single language** — Simplified from the starter's multilingual setup for better performance and maintainability.
- **Dark mode default** -- Professional engineering blog aesthetic with dark theme as the default.
- **npm over bun** — Broader compatibility and ecosystem support.

## License

MIT
