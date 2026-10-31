import { resolveCanvasPath } from '@/features/content/links';

/**
 * Rewrites links the OS hands to Easel before Expo Router sees them.
 *
 * - `easel://oauth/callback` and `easel://oauth/logout` belong to the sign-in
 *   browser (AUTH-3): on Android, Custom Tabs deliver them as app links, and
 *   expo-web-browser picks them up itself. Keep the router from treating them as
 *   screens.
 * - `easel://expo-sharing` is the share extension (iOS) or share intent
 *   (Android) handing something over: the share screen reads it (ASSIGN-16).
 * - `easel://courses/1/assignments/2` and other Canvas paths open the matching
 *   screen, and `easel://open?url=…` takes a whole Canvas URL (SYS-3). Paths
 *   Easel has no screen for go to the share screen, which offers the browser.
 *
 * Everything else, Easel's own routes and the development client, passes
 * through unchanged.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (/^(easel:\/\/|\/)?oauth\/(callback|logout)\b/.test(path.replace(/^easel:\/\/\/?/, 'easel://'))) {
      // At launch there's no current screen to stay on, so start at the root.
      return initial ? '/' : null;
    }
    return easelLink(path) ?? path;
  } catch {
    // Never crash on a malformed link.
  }
  return path;
}

/** Canvas paths Easel can open from an `easel://` link. The first segment decides. */
const CANVAS_ROOTS = /^(courses|files|conversations|grades|calendar_events|users|groups)(\/|\?|$)/;

/** The Easel href for an `easel://` link, or null to leave the path alone. */
function easelLink(path: string): string | null {
  const match = path.match(/^easel:\/\/\/?(.*)$/i);
  if (!match) return null;
  const rest = match[1];
  if (/^expo-sharing(\/|\?|$)/.test(rest)) return '/share';

  if (/^open(\/)?(\?|$)/.test(rest)) {
    const url = new URLSearchParams(rest.slice(rest.indexOf('?') + 1)).get('url');
    if (!url) return '/share';
    // Keep the school attached. The share screen checks it against the signed-in
    // account before opening; stripping the host could open another school's ID.
    return `/share?link=${encodeURIComponent(url)}`;
  }

  if (CANVAS_ROOTS.test(rest)) {
    return resolveCanvasPath(`/${rest}`) ?? `/share?link=${encodeURIComponent(`/${rest}`)}`;
  }
  return null;
}
