import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import type { Account } from '@/canvas/session';
import { resolveCanvasLink } from '@/features/content/links';
import { openWebView } from '@/features/web/open';

/**
 * Where a link shared or pasted into Easel opens (SYS-3):
 * - `native`: a Canvas link Easel has a screen for
 * - `web`: a page on this school's Canvas with no native screen, opened in the signed-in web view
 * - `other`: a link to somewhere else, another school's Canvas included
 */
export type LinkTarget =
  | { kind: 'native'; url: string; route: { pathname: string; params: Record<string, string> } }
  | { kind: 'web'; url: string }
  | { kind: 'other'; url: string; host: string };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/**
 * Accepts what students paste: full URLs, or a Canvas address without `https://`.
 * Paths like `/courses/1` are read against the signed-in school.
 */
export function normalizeLink(input: string, baseUrl: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = trimmed.startsWith('/')
    ? `${baseUrl}${trimmed}`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) return null;
    // A bare word ("hello") isn't a host anyone meant.
    if (!url.host.includes('.') && !url.host.includes(':') && url.host !== 'localhost') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function linkTarget(url: string, account: Account): LinkTarget {
  const route = resolveCanvasLink(url, account.baseUrl);
  if (route) return { kind: 'native', url, route };
  const host = hostOf(url);
  if (host && host === hostOf(account.baseUrl)) return { kind: 'web', url };
  return { kind: 'other', url, host };
}

export function openLinkTarget(target: LinkTarget) {
  switch (target.kind) {
    case 'native':
      router.push(target.route as never);
      return;
    case 'web':
      openWebView({ url: target.url });
      return;
    case 'other':
      WebBrowser.openBrowserAsync(target.url).catch(() => {});
  }
}
