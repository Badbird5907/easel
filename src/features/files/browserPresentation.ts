import type { FileItem, FileSort, FolderItem, SortOrder } from '@/canvas/api/files';
import { createTranslator, formatNumber, type Translate } from '@/i18n';
import { createDateContext } from '@/lib/dates';

import { fileSummary } from './AttachmentList';
import { formatDay } from './kinds';

const sortKeys = {
  name: {
    label: 'files.sort.name',
    asc: 'files.sort.az',
    desc: 'files.sort.za',
  },
  updated_at: {
    label: 'files.sort.updated_at',
    asc: 'files.sort.oldest',
    desc: 'files.sort.newest',
  },
  size: {
    label: 'files.sort.size',
    asc: 'files.sort.smallest',
    desc: 'files.sort.largest',
  },
  content_type: {
    label: 'files.sort.content_type',
    asc: 'files.sort.az',
    desc: 'files.sort.za',
  },
} as const;
export const sortIds = Object.keys(sortKeys) as FileSort[];
export function sortLabel(by: FileSort, t: Translate, order?: SortOrder) {
  const label = t(sortKeys[by].label);
  return order ? t('files.sort.value', { label, order: t(sortKeys[by][order]) }) : label;
}
export function sortPresentation(sort: { by: FileSort; order: SortOrder }, t: Translate) {
  return {
    title: t('files.sort.title'),
    options: sortIds.map((by) =>
      sortLabel(by, t, sort.by === by ? (sort.order === 'asc' ? 'desc' : 'asc') : undefined),
    ),
  };
}
export function browserCount(kind: 'folders' | 'files' | 'items' | 'results', count: number, locale: string) {
  const params = { count, number: formatNumber(count, undefined, locale) };
  return createTranslator(locale)(`files.count.${kind}`, params);
}
export function folderSummary(folder: FolderItem, locale: string) {
  const parts: string[] = [];
  if (folder.foldersCount) parts.push(browserCount('folders', folder.foldersCount, locale));
  if (folder.filesCount) parts.push(browserCount('files', folder.filesCount, locale));
  return parts.join(' · ') || createTranslator(locale)('files.empty');
}
export function browserFileSummary(file: FileItem, locale: string, zone: string) {
  const date = file.modifiedAt ?? file.updatedAt;
  return [
    fileSummary(file, locale),
    date ? formatDay(date, new Date(), createDateContext(locale, zone)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
