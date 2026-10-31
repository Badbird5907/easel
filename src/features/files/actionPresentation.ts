import { createTranslator } from '@/i18n/runtime';
import type { Translate } from '@/i18n/types';

import { FileActionError } from './actions';
import type { SaveDestination } from './actionTypes';
import { FileDownloadError } from './download';
import { describeFile } from './kinds';

export type SaveOptionKey = 'folder' | 'downloads' | 'photos';
export function saveOptionLabel(key: SaveOptionKey, ios: boolean, t: Translate): string {
  switch (key) {
    case 'folder':
      return t(ios ? 'files.actions.saveFiles' : 'files.actions.saveFolder');
    case 'downloads':
      return t('files.actions.saveDownloads');
    case 'photos':
      return t(ios ? 'files.actions.savePhotos' : 'files.actions.saveGallery');
  }
}

export function destinationLabel(destination: SaveDestination, t: Translate): string {
  switch (destination.origin) {
    case 'folder':
      return t('files.actions.destination.folder');
    case 'that-folder':
      return t('files.actions.destination.thatFolder');
    case 'downloads':
      return t('files.actions.destination.downloads');
    case 'iphone':
      return t('files.actions.destination.iphone');
    case 'ipad':
      return t('files.actions.destination.ipad');
    case 'photos':
      return t('files.actions.destination.photos');
    case 'gallery':
      return t('files.actions.destination.gallery');
    default:
      return destination.label;
  }
}

/** Explicit invocation locale; native/legacy/same-text errors never acquire an origin here. */
export function createActionPresentation(locale: string) {
  const t = createTranslator(locale);
  return {
    copied: () => t('files.actions.copied'),
    saved: (destination: SaveDestination) =>
      t('files.actions.saved', { destination: destinationLabel(destination, t) }),
    error: (error: unknown): string => {
      if (error instanceof FileActionError) {
        const origin = error.origin;
        switch (origin?.reason) {
          case 'sharing-unavailable':
            return t('files.actions.error.sharing');
          case 'folder-picker':
            return t('files.actions.error.picker');
          case 'folder-copy':
            return t('files.actions.error.copy', {
              destination: destinationLabel(origin.destination, t),
            });
          case 'photos-permission':
            return t('files.actions.error.photos');
          case 'gallery-permission':
            return t('files.actions.error.gallery');
          case 'print-open':
            return t('files.actions.error.print');
          case 'print-rendition':
            return t('files.actions.error.rendition');
          case 'print-unsupported':
            return t('files.actions.error.unsupported');
          case 'no-app':
            return t('files.actions.error.noApp', {
              type: describeFile(origin.file, locale).label,
            });
          default:
            return error.message;
        }
      }
      if (error instanceof FileDownloadError) {
        switch (error.origin?.reason) {
          case 'not_found':
            return t('files.actions.error.download.notFound');
          case 'forbidden':
            return t('files.actions.error.download.forbidden');
          case 'locked':
            return t('files.actions.error.download.locked');
          case 'signed_out':
            return t('files.actions.error.download.signedOut');
          case 'offline':
            return t('files.actions.error.download.offline');
          case 'server':
            return t('files.actions.error.download.server');
          case 'storage':
            return t('files.actions.error.download.storage');
          default:
            return error.message;
        }
      }
      return t('files.actions.error.unexpected');
    },
  };
}
