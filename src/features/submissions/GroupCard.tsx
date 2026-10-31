import { Users } from 'lucide-react-native';
import { View } from 'react-native';

import type { Assignment } from '@/canvas/api/assignments';
import { type SubmissionGroup, useSubmissionGroup } from '@/canvas/api/submissions';
import { useCanvas } from '@/canvas/session';
import { Avatar, Callout, Card, IconTile, Skeleton, Text } from '@/design';
import { type Translate, useTranslation } from '@/i18n';

/** "Osmosis Lab Group (4 people)", for confirmations. */
export function groupPhrase(group: SubmissionGroup, t?: Translate): string {
  const count = group.members.length;
  // The one-argument caller still embeds this in English confirmation prose.
  if (!t) {
    return group.membersStatus !== 'unavailable' && count > 1
      ? `${group.name} (${count} people)`
      : group.name;
  }
  return group.membersStatus === 'loaded' && count > 1
    ? t('submissionGroup.phrase', { name: group.name, count })
    : group.name;
}

/** Only describe returned members; Canvas may restrict the visible roster. */
export function groupMembersLabel(
  group: SubmissionGroup,
  selfId: string,
  t: Translate,
  locale: string,
): string {
  if (group.membersStatus === 'unavailable' || (!group.membersStatus && !group.members.length)) {
    return t('submissionGroup.membersUnavailable');
  }
  if (!group.members.length) return t('submissionGroup.membersEmpty');
  const names = group.members.map((m) => (m.id === selfId ? t('submissionGroup.you') : m.name));
  return t('submissionGroup.members', {
    names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names),
  });
}

/**
 * The group a group assignment is turned in for (ASSIGN-13): its name and
 * members, and what submitting means for them. Null for individual work.
 */
export function GroupCard({ a, compact }: { a: Assignment; compact?: boolean }) {
  const { t, locale } = useTranslation();
  const { account } = useCanvas();
  const query = useSubmissionGroup(a.courseId, a.groupCategoryId);
  if (!a.groupCategoryId) return null;
  if (query.isPending)
    return (
      <View
        accessible
        accessibilityLabel={t('submissionGroup.loading')}
        accessibilityState={{ busy: true }}
      >
        <Skeleton className="h-20 rounded-2xl" />
      </View>
    );
  if (query.isError)
    return (
      <Callout tone="info" icon={Users} title={t('submissionGroup.title')}>
        {t('submissionGroup.error')}
      </Callout>
    );
  const group = query.data;
  if (!group)
    return (
      <Callout tone="info" icon={Users} title={t('submissionGroup.title')}>
        {t('submissionGroup.noGroup')}
      </Callout>
    );

  const membersLabel = groupMembersLabel(group, account.user.id, t, locale);
  return (
    <Card>
      <View
        className="gap-3"
        accessible
        accessibilityLabel={t('submissionGroup.accessibility', {
          name: group.name,
          members: membersLabel,
        })}
      >
        <View className="flex-row items-center gap-3">
          <IconTile icon={Users} tone="accent" />
          <View className="flex-1 gap-0.5">
            <Text variant="headline">{group.name}</Text>
            <Text variant="subhead" tone="muted">
              {t(compact ? 'submissionGroup.compact' : 'submissionGroup.full')}
            </Text>
          </View>
        </View>
        {group.membersStatus !== 'unavailable' && group.members.length ? (
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-2">
            {group.members.map((m) => (
              <View key={m.id} className="flex-row items-center gap-1.5">
                <Avatar name={m.name} uri={m.avatarUrl} size="xs" />
                <Text variant="footnote" tone="muted">
                  {m.id === account.user.id ? t('submissionGroup.you') : m.name}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="footnote" tone="muted">
            {membersLabel}
          </Text>
        )}
      </View>
    </Card>
  );
}
