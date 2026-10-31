import { useLocalSearchParams } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from '@/i18n';

import { type GroupMember, useGroup, useGroupMembers } from '@/canvas/api/groups';
import type { Person } from '@/canvas/api/people';
import { useCanvas } from '@/canvas/session';
import { Avatar, Badge, Card, EmptyState, ListGroup, ListItem, Screen } from '@/design';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { GroupScope } from '@/features/groups/GroupScope';
import { ProfileSheet } from '@/features/people/ProfileSheet';

const asPerson = (m: GroupMember): Person => ({
  id: m.id,
  name: m.name,
  sortableName: m.sortableName,
  avatarUrl: m.avatarUrl,
  pronouns: m.pronouns,
  role: 'student',
  customRole: null,
});

/** A group's members, each with a profile card and Message (COURSE-7, CONTENT-10). */
export default function GroupPeopleScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { account } = useCanvas();
  const group = useGroup(groupId);
  const members = useGroupMembers(groupId);
  const [selected, setSelected] = useState<Person | null>(null);
  const refreshControl = useRefreshControl([['groups', groupId, 'people']]);
  const leaderId = group.data?.leaderId;

  return (
    <GroupScope groupId={groupId} title={t('people.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {members.isPending ? (
          <ListSkeleton rows={4} />
        ) : members.isError ? (
          <LoadError title={t('groups.membersError')} error={members.error} onRetry={() => members.refetch()} />
        ) : members.data.length === 0 ? (
          <Card padding="none">
            <EmptyState icon={Users} title={t('groups.noMembers')} description={t('groups.noMembersDescription')} />
          </Card>
        ) : (
          <ListGroup header={t('groups.members', { count: members.data.length })}>
            {members.data.map((m) => {
              const you = m.id === account.user.id;
              const leader = m.id === leaderId;
              return (
                <ListItem
                  key={m.id}
                  leading={<Avatar name={m.name} uri={m.avatarUrl} />}
                  title={m.name}
                  subtitle={[leader ? t('groups.leader') : null, m.pronouns].filter(Boolean).join(' · ') || undefined}
                  subtitleLines={1}
                  trailing={you ? <Badge tone="accent">{t('people.you')}</Badge> : undefined}
                  accessibilityHint={t('people.profileHint')}
                  onPress={() => setSelected(asPerson(m))}
                />
              );
            })}
          </ListGroup>
        )}
      </Screen>
      <ProfileSheet
        person={selected}
        courseId={group.data?.courseId ?? null}
        userId={account.user.id}
        onClose={() => setSelected(null)}
      />
    </GroupScope>
  );
}
