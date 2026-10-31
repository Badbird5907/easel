import { Lock } from 'lucide-react-native';
import { useMemo } from 'react';

import { type AttachmentInput, type FileItem, toFileItem } from '@/canvas/api/files';
import { Badge, ListGroup, ListItem } from '@/design';
import { createTranslator, useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import { FileThumbnail } from './FileThumbnail';
import { availabilityOf, describeFile, formatSize } from './kinds';
import { openFile } from './open';

export type AttachmentListProps = {
  /** Canvas attachment JSON: `id`, `display_name`, `content-type`, `size`, `url`, `thumbnail_url`. */
  attachments: AttachmentInput[];
  /** The course the attachments belong to, when known. */
  courseId?: string;
  /** Small label above the group, e.g. "Attachments". Omit inside a titled section. */
  header?: string;
  className?: string;
};

/** "PDF · 1.2 MB", never a MIME type. Omit locale for the legacy summary. */
export function fileSummary(file: FileItem, locale?: string): string {
  if (locale !== undefined) {
    const type = describeFile(file, locale).label;
    const size = formatSize(file.size, locale);
    return size === null ? type : createTranslator(locale)('file.summary', { type, size });
  }
  return [describeFile(file).label, formatSize(file.size)].filter(Boolean).join(' · ');
}

/**
 * Attachments on a message, post, comment, or submission. Each row shows the
 * type and size; tapping opens the viewer, which swipes between them (FILE-8).
 */
export function AttachmentList({ attachments, courseId, header, className }: AttachmentListProps) {
  const { t, locale } = useTranslation();
  const timeZone = useDisplayTimeZone();
  const dates = useMemo(() => createDateContext(locale, timeZone), [locale, timeZone]);
  const files = useMemo(() => attachments.map(toFileItem), [attachments]);
  if (files.length === 0) return null;
  return (
    <ListGroup header={header} className={className}>
      {files.map((file, index) => {
        // Keep supplied display names (including empty strings) raw; opening retains the adapter payload.
        const name = attachments[index].display_name ?? file.name;
        const summary = fileSummary(file, locale);
        const availability = availabilityOf(file, new Date(), dates);
        return (
          <ListItem
            key={file.id}
            leading={<FileThumbnail file={file} />}
            title={name}
            subtitle={summary}
            subtitleLines={1}
            accessibilityLabel={
              availability
                ? t('file.rowAvailabilityLabel', { name, summary, availability: availability.short })
                : t('file.rowLabel', { name, summary })
            }
            accessibilityHint={t('file.openHint')}
            trailing={
              availability?.tone === 'warning' ? (
                <Badge tone="warning" size="sm" icon={Lock}>
                  {t('file.locked')}
                </Badge>
              ) : null
            }
            onPress={() => openFile(file.id, { courseId, files })}
          />
        );
      })}
    </ListGroup>
  );
}
