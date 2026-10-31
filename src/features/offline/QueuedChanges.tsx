import { CloudUpload } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useCanvas } from '@/canvas/session';
import { Callout } from '@/design';
import { useTranslation } from '@/i18n';

import { createOfflinePresentation } from './presentation';
import { dismissNotice, flushQueue, useQueuedWrites, useQueueNotices } from './queue';
import { useOnline } from './useOnline';

type Props = {
  /** Only writes of these kinds count, e.g. the planner's on To Do. Defaults to all. */
  kinds?: string[];
  className?: string;
};

/**
 * Writes waiting for the network (OFF-2), and what happened to any that
 * couldn't go through: "Will sync when you're online", plus a notice for a
 * delete Easel skipped because the item changed in Canvas.
 */
export function QueuedChanges({ kinds, className }: Props) {
  const { t, locale } = useTranslation();
  const presentation = useMemo(() => createOfflinePresentation(locale), [locale]);
  const { account } = useCanvas();
  const online = useOnline();
  const writes = useQueuedWrites(account.id).filter((w) => !kinds || kinds.includes(w.kind));
  const notices = useQueueNotices(account.id);
  if (!writes.length && !notices.length) return null;

  return (
    <View className={className ?? 'gap-3'}>
      {notices.map((notice) => (
        <Callout
          key={notice.id}
          tone="warning"
          title={t('offline.noticeTitle')}
          action={{
            label: t('offline.ok'),
            accessibilityLabel: t('offline.dismissHint'),
            onPress: () => dismissNotice(notice.id),
          }}
        >
          {presentation.notice(notice)}
        </Callout>
      ))}
      {writes.length ? (
        <Callout
          tone="info"
          icon={CloudUpload}
          action={online ? { label: t('offline.syncNow'), onPress: () => void flushQueue() } : undefined}
        >
          {presentation.summary(writes, online)}
        </Callout>
      ) : null}
    </View>
  );
}
