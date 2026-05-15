import { SITE } from '../config';

export interface Author {
  slug: string;
  name: string;
  role: string;
  avatarUrl: string;
  bio: string;
  github?: string;
  twitter?: string;
  linkedin?: string;
}

const authors: Record<string, Author> = {
  'naman-gupta': {
    slug: 'naman-gupta',
    name: 'Naman Gupta',
    role: 'Senior Backend & Platform Engineer',
    avatarUrl: 'https://avatars.githubusercontent.com/u/placeholder?v=4',
    bio: 'Focuses on system design, distributed systems, and cloud infrastructure. Passionate about building high-throughput services and sharing production-ready patterns.',
    github: 'https://github.com',
    twitter: 'https://x.com',
    linkedin: 'https://linkedin.com',
  },
  'jane-doe': {
    slug: 'jane-doe',
    name: 'Jane Doe',
    role: 'FinTech Engineer',
    avatarUrl: 'https://avatars.githubusercontent.com/u/placeholder?v=4',
    bio: 'Specializes in payment processing, ledger systems, and financial infrastructure. Writes about fraud detection, PCI compliance, and building idempotent APIs.',
    github: 'https://github.com',
    twitter: 'https://x.com',
    linkedin: 'https://linkedin.com',
  },
  'john-smith': {
    slug: 'john-smith',
    name: 'John Smith',
    role: 'AI/ML Engineer',
    avatarUrl: 'https://avatars.githubusercontent.com/u/placeholder?v=4',
    bio: 'Works on practical applications of AI in engineering workflows. Covers RAG pipelines, vector databases, prompt engineering, and LLM integration patterns.',
    github: 'https://github.com',
    twitter: 'https://x.com',
    linkedin: 'https://linkedin.com',
  },
  'alex-chen': {
    slug: 'alex-chen',
    name: 'Alex Chen',
    role: 'Backend Engineer',
    avatarUrl: 'https://avatars.githubusercontent.com/u/placeholder?v=4',
    bio: 'Deep expertise in microservices, event-driven architecture, and database design. Writes about caching strategies, message queues, and API design patterns.',
    github: 'https://github.com',
    twitter: 'https://x.com',
    linkedin: 'https://linkedin.com',
  },
};

const authorOrder = ['naman-gupta', 'jane-doe', 'john-smith', 'alex-chen'];

export function getAuthor(slug?: string): Author {
  if (slug && authors[slug]) {
    return authors[slug];
  }
  return {
    slug: 'default',
    name: SITE.author.name,
    role: 'Author',
    avatarUrl: typeof SITE.author.avatar === 'string' ? SITE.author.avatar : '/images/avatar.jpg',
    bio: '',
  };
}

export function getAllAuthors(): Author[] {
  return authorOrder.map((slug) => authors[slug]).filter(Boolean);
}
