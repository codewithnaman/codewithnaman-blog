/**
 * i18n utilities (English only — single language).
 */

import type { UIKey } from './ui';
import { messages } from './ui';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');

export function withBase(path: string): string {
  if (!path || !path.startsWith('/')) return path;
  if (!BASE) return path;
  if (path === BASE || path.startsWith(`${BASE}/`)) return path;
  return `${BASE}${path}`;
}

export function useTranslations(): (_key: UIKey) => string {
  return function (k: UIKey): string {
    return messages[k] ?? k;
  };
}

export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', options).format(d);
}

export function isoDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function localizedPath(path: string): string {
  return withBase(path);
}
