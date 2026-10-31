import { router } from 'expo-router';
import { CloudUpload, RefreshCw, Upload } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Card, Divider, Icon, ProgressBar, Text } from '@/design';
import { useActiveUploads } from '@/features/submissions/uploadStore';
import { useSyncRun } from '@/features/sync/runner';
import { formatNumber, useTranslation } from '@/i18n';

import { useQueuedWrites } from './queue';
import { useOnline } from './useOnline';

function Row({
  icon,
  title,
  detail,
  children,
}: {
  icon: typeof Upload;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <View className="gap-2 px-4 py-3">
      <View className="flex-row items-center gap-3">
        <Icon icon={icon} size={18} tone="accent" />
        <View className="flex-1">
          <Text variant="subhead" weight="medium">
            {title}
          </Text>
          {detail ? (
            <Text variant="footnote" tone="muted" tabular>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

/**
 * What's running in the background, for Home (HOME-9): a course sync with its
 * progress, uploads still sending, and changes waiting for the network.
 * Renders nothing when all is quiet. Tapping it opens Offline and storage.
 */
export function ActivityStrip() {
  const { t, locale } = useTranslation();
  const { account } = useCanvas();
  const online = useOnline();
  const run = useSyncRun();
  const uploads = useActiveUploads(account.id).count;
  const queued = useQueuedWrites(account.id).length;
  const ownRun = run?.accountId === account.id ? run : null;
  const progress = ownRun?.progress;
  const course = ownRun?.courses[ownRun.index];
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const syncTitle = course ? t('activity.syncCourse', { course: course.name }) : t('activity.syncCourses');
  const sync = ownRun
    ? {
        title: ownRun.courses.length > 1
          ? t('activity.syncSequence', { title: syncTitle, current: ownRun.index + 1, total: ownRun.courses.length })
          : syncTitle,
        detail: progress
          ? [
              t('activity.syncProgress', {
                stage: progress.stepKey ? t(`activity.stage.${progress.stepKey}`) : t('activity.syncing'),
                done: progress.done,
                total: progress.total,
              }),
              progress.bytes > 0 ? transferredSize(progress.bytes, locale) : null,
            ].filter(Boolean).join(' · ')
          : t('activity.preparing'),
        fraction,
      }
    : null;
  if (!sync && !uploads && !queued) return null;

  const parts = [
    sync ? t('activity.syncLabel', {
      title: sync.title,
      percent: formatNumber(sync.fraction, { style: 'percent', maximumFractionDigits: 0 }, locale),
    }) : null,
    uploads ? t('activity.uploadsSending', { count: uploads }) : null,
    queued ? t('activity.queued', { count: queued }) : null,
  ].filter(Boolean);

  return (
    // Android reads changes out; iOS reads the label when focused.
    <View accessibilityLiveRegion="polite">
      <Card
        padding="none"
        onPress={() => router.push('/storage')}
        accessibilityLabel={t('activity.label', { activity: parts.join('. ') })}
      >
        {sync ? (
          <Row icon={RefreshCw} title={sync.title} detail={sync.detail}>
            <ProgressBar value={sync.fraction} size="sm" />
          </Row>
        ) : null}
        {sync && (uploads || queued) ? <Divider /> : null}
        {uploads ? (
          <Row
            icon={Upload}
            title={t('activity.uploading', { count: uploads })}
            detail={t('activity.uploadHint')}
          />
        ) : null}
        {uploads && queued ? <Divider /> : null}
        {queued ? (
          <Row
            icon={CloudUpload}
            title={t('activity.queued', { count: queued })}
            detail={t(online ? 'activity.sendingNow' : 'activity.sendsOnline')}
          />
        ) : null}
      </Card>
    </View>
  );
}

/** Match the file UI's decimal byte units, with the viewing locale's numbers and unit labels. */
function transferredSize(bytes: number, locale: string) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return formatNumber(value, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }, locale);
}
