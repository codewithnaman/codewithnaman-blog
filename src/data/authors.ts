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
    role: 'Engineering Manager',
    avatarUrl: '/images/naman-gupta.jpg',
    bio: 'Software Engineering Manager with 11+ years of experience, including 8+ in FinTech. Leads Core Payment Authentication at Mastercard. Focuses on engineering leadership, distributed systems, and applied AI.',
    github: 'https://github.com/codewithnaman',
    twitter: 'https://twitter.com/codewithnaman',
    linkedin: 'https://www.linkedin.com/in/codewithnaman/',
  },
  'vikas-pathneja': {
    slug: 'vikas-pathneja',
    name: 'Vikas Pathneja',
    role: 'Senior Software Engineer',
    avatarUrl: '/images/vikas-pathneja.jpg',
    bio: 'Senior Software Engineer at Mastercard with 9+ years of experience in web application development and integration. Specializes in building transactional and scalable systems, microservices with Spring Boot, and financial solutions.',
    github: 'https://github.com/vikaspathneja',
    linkedin: 'https://www.linkedin.com/in/vikaspathneja/',
  },
};

const authorOrder = ['naman-gupta', 'vikas-pathneja'];

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
