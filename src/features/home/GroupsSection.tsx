import { useTranslation } from '@/i18n';
import { router } from 'expo-router';
import { Users } from 'lucide-react-native';

import { useGroups } from '@/canvas/api/groups';
import type { Course } from '@/canvas/models';
import { Callout, IconTile, ListGroup, ListItem, Section } from '@/design';

/** The student's groups on Home (HOME-7). Each opens its group home. */
export function GroupsSection({ courseFor }: { courseFor: (id: string | null) => Course | undefined }) {
  const { t } = useTranslation();
  const groups = useGroups();
  if (groups.isError && !groups.data)
    return (
      <Section title={t('home.groups')}>
        <Callout
          tone="danger"
          title={t('home.groupsError')}
          action={{ label: t('common.retry'), onPress: () => groups.refetch() }}
        >
          {t('common.loadHint')}
        </Callout>
      </Section>
    );
  if (!groups.data?.length) return null;
  return (
    <Section title={t('home.groups')}>
      <ListGroup>
        {groups.data.map((group) => {
          const course = courseFor(group.courseId);
          const members = group.memberCount === null ? null : t('home.members', { count: group.memberCount });
          return (
            <ListItem
              key={group.id}
              leading={<IconTile icon={Users} color={course?.color} tone="neutral" />}
              title={group.name}
              subtitle={[course?.code, members].filter(Boolean).join(' · ') || undefined}
              onPress={() => router.push({ pathname: '/group/[groupId]', params: { groupId: group.id } })}
            />
          );
        })}
      </ListGroup>
    </Section>
  );
}
