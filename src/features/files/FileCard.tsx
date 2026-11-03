import { Copy, ExternalLink, FolderDown, Link, Lock, Printer, Share } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { useCourseLookup } from '@/canvas/api/courses';
import type { FileItem } from '@/canvas/api/files';
import { Button, Callout, haptics, Icon, ListGroup, ListItem, ProgressBar, Text, useTheme } from '@/design';
import type { ColorToken } from '@/design';

import { formatNumber, type Translate, useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import { fileSummary } from './AttachmentList';
import { kindTone } from './FileThumbnail';
import { availabilityOf, describeFile, formatDateTime, formatSize } from './kinds';
import type { FileActions } from './useFileActions';

const heroBg: Record<string, string> = {
  danger: 'bg-danger-soft',
  info: 'bg-info-soft',
  success: 'bg-success-soft',
  warning: 'bg-warning-soft',
  accent: 'bg-accent-soft',
  neutral: 'bg-surface-sunken',
};
const heroFg: Record<string, ColorToken> = {
  danger: 'dangerFg',
  info: 'infoFg',
  success: 'successFg',
  warning: 'warningFg',
  accent: 'accentFg',
  neutral: 'fgMuted',
};

/** Big type icon, name, and "Word document · 48 KB". */
export function FileHero({ file }: { file: FileItem }) {
  const { t, locale } = useTranslation();
  const { colors } = useTheme();
  const type = describeFile(file, locale);
  const tone = kindTone[type.kind] ?? 'neutral';
  const summary = fileSummary(file, locale);
  return (
    <View
      className="items-center gap-3"
      accessible
      accessibilityLabel={t('file.rowLabel', { name: file.name, summary })}
    >
      <View
        className={`h-20 w-20 items-center justify-center rounded-3xl ${heroBg[tone]}`}
        style={{ borderCurve: 'continuous' }}
      >
        <Icon icon={type.icon} size={40} color={colors[heroFg[tone]]} strokeWidth={1.5} />
      </View>
      <View className="items-center gap-1">
        <Text variant="title3" align="center" numberOfLines={3}>
          {file.name}
        </Text>
        <Text variant="subhead" tone="muted" align="center">
          {summary}
        </Text>
      </View>
    </View>
  );
}

/** "Downloading… 45%" while an action waits for the bytes. */
export function DownloadProgress({ actions }: { actions: FileActions }) {
  const { t, locale } = useTranslation();
  const { download } = actions;
  if (download.status !== 'downloading') return null;
  const fraction = download.progress.fraction;
  const percent =
    fraction === null
      ? ''
      : formatNumber(
          Math.round(fraction * 100) / 100,
          { style: 'percent', maximumFractionDigits: 0 },
          locale,
        );
  return (
    <View className="gap-2">
      <ProgressBar
        value={fraction ?? 0}
        accessibilityLabel={
          fraction !== null ? t('files.downloadLabelPercent', { percent }) : t('files.downloading')
        }
      />
      <View className="flex-row items-center justify-between">
        <Text variant="footnote" tone="muted" tabular>
          {fraction !== null
            ? t('files.downloadPercent', { percent })
            : t('files.downloadBytes', {
                size: formatSize(download.progress.bytes, locale) ?? '',
              })}
        </Text>
        <Button variant="ghost" size="sm" onPress={download.cancel}>
          {t('common.cancel')}
        </Button>
      </View>
    </View>
  );
}

/** The actions as buttons, for the file card. */
export function FileActionButtons({ actions, locked }: { actions: FileActions; locked: boolean }) {
  const { t } = useTranslation();
  const busy = actions.busy;
  const saveDisabled = locked || (!!busy && busy !== 'save');
  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <Button
          className="flex-1"
          leadingIcon={Share}
          loading={busy === 'share'}
          disabled={locked || (!!busy && busy !== 'share')}
          onPress={actions.share}
        >
          {t('files.share')}
        </Button>
        <Button
          className="flex-1"
          variant="tonal"
          leadingIcon={FolderDown}
          loading={busy === 'save'}
          disabled={saveDisabled}
          onPress={actions.save}
          onLongPress={() => {
            haptics.light();
            actions.saveElsewhere();
          }}
          accessibilityActions={
            saveDisabled ? undefined : [{ name: 'longpress', label: t('files.actions.chooseWhere') }]
          }
          onAccessibilityAction={(event) => {
            if (!saveDisabled && event.nativeEvent.actionName === 'longpress') actions.saveElsewhere();
          }}
        >
          {t('files.save')}
        </Button>
      </View>
      <View className="flex-row gap-3">
        <Button
          className="flex-1"
          variant="tonal"
          leadingIcon={ExternalLink}
          loading={busy === 'open'}
          disabled={locked || (!!busy && busy !== 'open')}
          onPress={actions.openIn}
        >
          {t('files.openIn')}
        </Button>
        <Button className="flex-1" variant="tonal" leadingIcon={Link} onPress={actions.shareLink}>
          {t('files.shareLink')}
        </Button>
      </View>
      {actions.canPrint ? (
        <Button
          variant="tonal"
          leadingIcon={Printer}
          loading={busy === 'print'}
          disabled={locked || (!!busy && busy !== 'print')}
          onPress={actions.print}
        >
          {t('files.print')}
        </Button>
      ) : null}
    </View>
  );
}

/** Type, size, dates, course, and availability. */
export function FileDetails({
  file,
  courseId,
  actions,
}: {
  file: FileItem;
  courseId?: string;
  actions?: FileActions;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const courseFor = useCourseLookup();
  const type = describeFile(file, locale);
  const availability = availabilityOf(file, new Date(), dates);
  const contextCourse = file.context?.type === 'course' ? file.context.id : courseId;
  const course = courseFor(contextCourse);
  const rows: { key: string; title: string; value: string }[] = [
    { key: 'type', title: t('files.detail.type'), value: type.label },
    ...(file.size !== null
      ? [
          {
            key: 'size',
            title: t('files.detail.size'),
            value: formatSize(file.size, locale)!,
          },
        ]
      : []),
    ...(file.modifiedAt
      ? [
          {
            key: 'modified',
            title: t('files.detail.modified'),
            value: formatDateTime(file.modifiedAt, new Date(), dates),
          },
        ]
      : []),
    ...(file.createdAt
      ? [
          {
            key: 'uploaded',
            title: t('files.detail.uploaded'),
            value: formatDateTime(file.createdAt, new Date(), dates),
          },
        ]
      : []),
    ...(file.uploader
      ? [
          {
            key: 'uploader',
            title: t('files.detail.uploader'),
            value: file.uploader,
          },
        ]
      : []),
    ...(course
      ? [
          {
            key: 'course',
            title: t('files.detail.course'),
            value: course.code || course.name,
          },
        ]
      : []),
    ...(file.context?.type === 'user'
      ? [
          {
            key: 'location',
            title: t('files.detail.location'),
            value: t('files.my'),
          },
        ]
      : []),
    {
      key: 'availability',
      title: t('files.detail.availability'),
      value: availability?.long ?? t('files.available'),
    },
  ];
  return (
    <ListGroup>
      {rows.map((row) => (
        <ListItem
          key={row.key}
          title={row.title}
          accessibilityLabel={t('files.detail.row', {
            title: row.title,
            value: row.value,
          })}
          trailing={
            <Text variant="body" tone="muted" numberOfLines={2} align="right" className="max-w-[68%] shrink">
              {row.value}
            </Text>
          }
        />
      ))}
      {actions?.link ? (
        <ListItem
          title={t('files.copyLink')}
          leading={<Icon icon={Copy} tone="accent" />}
          chevron={false}
          onPress={actions.copyLink}
        />
      ) : null}
    </ListGroup>
  );
}

/** Canvas's lock explanation, unless it only repeats the date already in the title. */
function lockDetail(file: FileItem, t: Translate) {
  const explanation = file.lockExplanation?.trim();
  if (explanation && !(file.unlockAt && /locked until/i.test(explanation))) return explanation;
  return t(file.unlockAt ? 'files.lockAfter' : 'files.lockInstructor');
}

/**
 * The file card (FILE-7): what every file shows when Easel can't preview it, and
 * what Details shows for files it can. Never a MIME type.
 */
export function FileCard({
  file,
  courseId,
  actions,
  note,
}: {
  file: FileItem;
  courseId?: string;
  actions: FileActions;
  /** Why there's no preview, when there isn't one. */
  note?: string;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = createDateContext(locale, zone);
  const availability = availabilityOf(file, new Date(), dates);
  return (
    <View className="gap-6">
      <View className="pt-4">
        <FileHero file={file} />
      </View>
      {file.lockedForUser ? (
        <Callout tone="warning" icon={Lock} title={availability?.long ?? t('file.locked')}>
          {lockDetail(file, t)}
        </Callout>
      ) : note ? (
        <Text variant="subhead" tone="muted" align="center" className="px-4">
          {note}
        </Text>
      ) : null}
      <FileActionButtons actions={actions} locked={file.lockedForUser} />
      <DownloadProgress actions={actions} />
      <FileDetails file={file} courseId={courseId} actions={actions} />
    </View>
  );
}

export function InlineSpinner() {
  const { colors } = useTheme();
  return <ActivityIndicator color={colors.fgMuted} />;
}
