import type { Translate } from '@/i18n/types';
import type { OfflineNoticeKind } from '@/features/sync/assetHtml';

/** Safe in both a script element and injectJavaScript, including translated/user strings. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export const escapePresentationHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function contentPresentation(t: Translate, locale: string, direction: 'ltr' | 'rtl') {
  return {
    locale,
    direction,
    openTool: t('content.openTool'),
    openNamedTool: t('content.openNamedTool', { name: '{name}' }),
    unsupported: t('content.offlineUnsupported'),
    missing: t('content.offlineMissing'),
  };
}
export type ContentPresentation = ReturnType<typeof contentPresentation>;

/** Optional offlineAssetHtml renderer: the caller supplies the viewing language explicitly. */
export function offlineNoticeHtml(kind: OfflineNoticeKind, presentation: ContentPresentation): string {
  return `<p role="note" lang="${escapePresentationHtml(presentation.locale)}" dir="${presentation.direction}">${escapePresentationHtml(presentation[kind])}</p>`;
}

/** RichContent renders labels on load and updates them without rebuilding media HTML. */
export const contentPresentationScript = (presentation: ContentPresentation) =>
  `window.easelContentPresentation && window.easelContentPresentation(${scriptJson(presentation)}); true;`;
