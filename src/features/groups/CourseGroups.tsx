import { router } from 'expo-router';
import { UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { memberLine, membershipErrorMessage } from './presentation';

import {
  type GroupDetail,
  type SignupCategory,
  useJoinGroup,
  useMyCourseGroups,
  useSignupCategories,
} from '@/canvas/api/groups';
import { Badge, Button, Card, EmptyState, IconTile, ListGroup, ListItem, Section, Text } from '@/design';
import { ListSkeleton, LoadError } from '@/features/course/states';

export function openGroup(groupId: string) {
  router.push({ pathname: '/group/[groupId]', params: { groupId } } as never);
}

function SignupSet({
  category,
  joiningId,
  onJoin,
}: {
  category: SignupCategory;
  joiningId: string | null;
  onJoin: (group: GroupDetail, category: SignupCategory) => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <Section title={category.name}>
      <ListGroup
        footer={
          category.multipleMemberships
            ? t('groups.multiple')
            : category.selfSignup === 'restricted'
              ? t('groups.restricted')
              : t('groups.pickOne')
        }
      >
        {category.groups.map((group) => {
          const joined = group.id === category.joinedGroupId;
          const max = group.maxMembers ?? category.groupLimit;
          const full = !joined && !!max && group.membersCount >= max;
          const line = memberLine(group, category.groupLimit, t, locale);
          return (
            <ListItem
              key={group.id}
              leading={<IconTile icon={UsersRound} tone={joined ? 'accent' : 'neutral'} />}
              title={group.name}
              subtitle={line}
              subtitleLines={1}
              // Rows with a Join button stay unlabeled so the button stays reachable on its own.
              accessibilityLabel={
                joined || full || !group.canJoin
                  ? [group.name, line, joined ? t('groups.inGroup') : full ? t('groups.full') : null]
                      .filter(Boolean)
                      .join(', ')
                  : undefined
              }
              chevron={joined}
              onPress={joined ? () => openGroup(group.id) : undefined}
              trailing={
                joined ? (
                  <Badge tone="accent">{t('groups.joined')}</Badge>
                ) : full ? (
                  <Badge>{t('groups.full')}</Badge>
                ) : group.canJoin ? (
                  <Button
                    size="sm"
                    variant="tonal"
                    loading={joiningId === group.id}
                    disabled={!!joiningId}
                    onPress={() => onJoin(group, category)}
                    accessibilityLabel={t('groups.joinName', { name: group.name })}
                  >
                    {t('groups.join')}
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>
    </Section>
  );
}

/**
 * The student's groups in a course, and group sets they can sign up for
 * themselves (COURSE-7), as on the web's People › Groups page.
 */
export function CourseGroups({ courseId, notify }: { courseId: string; notify: (message: string) => void }) {
  const { t, locale } = useTranslation();
  const mine = useMyCourseGroups(courseId);
  const signup = useSignupCategories(courseId);
  const join = useJoinGroup();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const doJoin = (group: GroupDetail) => {
    setJoiningId(group.id);
    join.mutate(group.id, {
      onSuccess: () => notify(t('groups.joinSuccess', { name: group.name })),
      onError: (error) => Alert.alert(t('groups.joinError'), membershipErrorMessage(error, t)),
      onSettled: () => setJoiningId(null),
    });
  };

  const onJoin = (group: GroupDetail, category: SignupCategory) => {
    const current = category.groups.find((g) => g.id === category.joinedGroupId);
    if (current && !category.multipleMemberships) {
      Alert.alert(t('groups.moveTitle', { name: group.name }), t('groups.moveDescription', { name: current.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('groups.move'), onPress: () => doJoin(group) },
      ]);
      return;
    }
    doJoin(group);
  };

  if (mine.isPending || signup.isPending) return <ListSkeleton rows={4} />;
  if (mine.isError)
    return <LoadError title={t('groups.mineError')} error={mine.error} onRetry={() => mine.refetch()} />;

  const categories = signup.data ?? [];
  return (
    <View className="gap-6">
      {mine.data.length > 0 ? (
        <Section title={t('groups.mine')}>
          <ListGroup>
            {mine.data.map((g) => (
              <ListItem
                key={g.id}
                leading={<IconTile icon={UsersRound} tone="accent" />}
                title={g.name}
                subtitle={memberLine(g, null, t, locale)}
                subtitleLines={1}
                onPress={() => openGroup(g.id)}
              />
            ))}
          </ListGroup>
        </Section>
      ) : categories.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={UsersRound}
            title={t('groups.empty')}
            description={t('groups.emptyDescription')}
          />
        </Card>
      ) : (
        <Text variant="subhead" tone="muted" className="px-1">
          {t('groups.joinBelow')}
        </Text>
      )}

      {signup.isError ? (
        <LoadError
          title={t('groups.signupError')}
          error={signup.error}
          onRetry={() => signup.refetch()}
        />
      ) : (
        categories.map((c) => <SignupSet key={c.id} category={c} joiningId={joiningId} onJoin={onJoin} />)
      )}
    </View>
  );
}
