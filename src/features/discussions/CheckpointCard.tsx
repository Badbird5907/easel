import { CircleCheck, CircleDashed } from 'lucide-react-native';
import { View } from 'react-native';

import type { Checkpoint, DiscussionEntry, DiscussionTopic } from '@/canvas/api/discussions';
import { Card, Divider, Icon, Text } from '@/design';
import { useTranslation } from '@/i18n';
import { useDisplayTimeZone } from '@/lib/dates';

import { discussionPresentation } from './presentation';

type Progress = { done: number; required: number };

/**
 * How far the student is with each checkpoint, counted the way Canvas does:
 * their own replies to the topic, and their own replies anywhere below it
 * (discussion_entry.rb#update_topic_submission).
 */
export function checkpointProgress(entries: DiscussionEntry[], checkpoint: Checkpoint): Progress {
  let roots = 0;
  let nested = 0;
  const walk = (list: DiscussionEntry[], depth: number) => {
    for (const e of list) {
      if (e.mine && !e.deleted) {
        if (depth === 0) roots += 1;
        else nested += 1;
      }
      walk(e.replies, depth + 1);
    }
  };
  walk(entries, 0);
  const done = checkpoint.kind === 'reply_to_topic' ? roots : nested;
  return { done: Math.min(done, checkpoint.required), required: checkpoint.required };
}

/**
 * A checkpointed discussion's parts (CONTENT-4): reply to the topic, then a
 * number of replies to classmates, each with its own due date and points.
 */
export function CheckpointCard({
  topic,
  entries,
  gated,
  now,
}: {
  topic: DiscussionTopic;
  /** The thread, once loaded; null while it loads or stays hidden. */
  entries: DiscussionEntry[] | null;
  gated: boolean;
  now: Date;
}) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const { dates, number, pointParams, countParams } = discussionPresentation(locale, zone);
  return (
    <Card padding="none">
      <Text variant="headline" accessibilityRole="header" className="px-4 pb-1 pt-4">
        {t('discussionDetail.checkpoints')}
      </Text>
      {topic.checkpoints.map((checkpoint, index) => {
        // Hidden replies mean the student hasn't posted to the topic yet.
        const progress = entries
          ? checkpointProgress(entries, checkpoint)
          : gated
            ? { done: 0, required: checkpoint.required }
            : null;
        const complete = !!progress && progress.done >= progress.required;
        const overdue = !complete && !!checkpoint.dueAt && checkpoint.dueAt < now;
        const status = !progress
          ? null
          : complete
            ? t('discussionDetail.done')
            : checkpoint.required > 1
              ? t('discussionDetail.progress', { done: number(progress.done), required: number(progress.required) })
              : t('discussionDetail.notDone');
        const details = [
          checkpoint.dueAt
            ? t('discussions.due', { date: dates.formatDueDate(checkpoint.dueAt, now) })
            : t('discussionDetail.noDueDate'),
          checkpoint.points != null ? t('discussions.points', pointParams(checkpoint.points)) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const title = checkpoint.kind === 'reply_to_topic'
          ? t('discussionDetail.replyToTopic')
          : t('discussionDetail.classmates', countParams(checkpoint.required));
        return (
          <View key={checkpoint.kind}>
            {index > 0 ? <Divider inset={52} /> : null}
            <View
              accessible
              accessibilityLabel={[title, details, status, overdue ? t('discussionDetail.pastDue') : null].filter(Boolean).join(', ')}
              className="min-h-[60px] flex-row items-center gap-3 px-4 py-3"
            >
              <Icon
                icon={complete ? CircleCheck : CircleDashed}
                size={22}
                tone={complete ? 'success' : overdue ? 'danger' : 'muted'}
              />
              <View className="flex-1 gap-0.5">
                <Text variant="body" weight="medium">
                  {title}
                </Text>
                <Text variant="subhead" tone={overdue ? 'danger' : 'muted'}>
                  {details}
                </Text>
              </View>
              {status ? (
                <Text variant="subhead" weight="medium" tone={complete ? 'success' : 'muted'} tabular>
                  {status}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}
