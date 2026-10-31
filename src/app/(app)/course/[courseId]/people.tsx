import { useLocalSearchParams } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { SectionList, View, ActivityIndicator } from 'react-native';
import { useTranslation } from '@/i18n';

import { type Person, roleOrder, usePeoplePages } from '@/canvas/api/people';
import { useCanvas } from '@/canvas/session';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ListItem,
  Screen,
  SearchField,
  SegmentedControl,
  Text,
  useToast,
} from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';
import { CourseGroups } from '@/features/groups/CourseGroups';
import { ProfileSheet } from '@/features/people/ProfileSheet';

type PeopleView = 'everyone' | 'groups';

/**
 * The course roster grouped by role, with a profile card and Message for each
 * person (CONTENT-10), and the student's groups and group sign-up (COURSE-7).
 */
export default function PeopleScreen() {
  const { t } = useTranslation();
  const views = [{ value: 'everyone' as const, label: t('people.everyone') }, { value: 'groups' as const, label: t('people.groups') }];
  const { courseId, fromHome, show } = useLocalSearchParams<{
    courseId: string;
    fromHome?: string;
    show?: string;
  }>();
  const { account } = useCanvas();
  const gate = useTabGate(courseId, 'people', fromHome === '1');

  const [view, setView] = useState<PeopleView>(show === 'groups' ? 'groups' : 'everyone');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const people = usePeoplePages(courseId, term);
  const [selected, setSelected] = useState<Person | null>(null);
  const toast = useToast();
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'people'],
    ['courses', courseId, 'tabs'],
    ['groups', 'course', courseId],
  ]);

  const all = [...new Map((people.data?.pages.flatMap((page) => page.people) ?? []).map((p) => [p.id, p])).values()];
  const sections = roleOrder.map((role) => ({ title: t(`people.heading.${role}`), data: all.filter((p) => p.role === role) })).filter((s) => s.data.length);

  return (
    <CourseScope courseId={courseId} title={t('people.title')}>
      {gate === 'hidden' || view === 'groups' ? (
        <Screen refreshControl={refreshControl} contentClassName="gap-6">
          {gate === 'hidden' ? <TabDisabled courseId={courseId} label={t('people.title')} /> : <>
            <SegmentedControl options={views} value={view} onChange={setView} accessibilityLabel={t('people.show')} />
            <CourseGroups courseId={courseId} notify={toast.show} />
          </>}
        </Screen>
      ) : (
        <SectionList
          className="flex-1 bg-bg"
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          sections={sections}
          keyExtractor={(person) => person.id}
          stickySectionHeadersEnabled={false}
          refreshControl={refreshControl}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (people.hasNextPage && !people.isFetching && !people.isFetchNextPageError) void people.fetchNextPage();
          }}
          ListHeaderComponent={<View className="gap-6 pb-6">
            <SegmentedControl options={views} value={view} onChange={setView} accessibilityLabel={t('people.show')} />
            <SearchField value={search} onChangeText={setSearch} placeholder={t('people.search')} />
          </View>}
          renderSectionHeader={({ section }) => <Text variant="headline" className="pb-2 pt-4">{section.title}</Text>}
          renderItem={({ item: person }) => {
            const you = person.id === account.user.id;
            const subtitle = [person.customRole, person.pronouns].filter(Boolean).join(' · ');
            return <ListItem
              leading={<Avatar name={person.name} uri={person.avatarUrl} />}
              title={person.name} subtitle={subtitle || undefined} subtitleLines={1}
              trailing={you ? <Badge tone="accent">{t('people.you')}</Badge> : undefined}
              accessibilityLabel={[person.name, you ? t('people.you') : null, subtitle].filter(Boolean).join(', ')}
              accessibilityHint={t('people.profileHint')} onPress={() => setSelected(person)} />;
          }}
          ListEmptyComponent={term.length === 1 ? (
            <Text tone="muted">{t('people.searchMinimum')}</Text>
          ) : people.isPending ? <ListSkeleton rows={6} /> : people.isError ? (
            <LoadError title={t('people.loadError')} error={people.error} onRetry={() => people.refetch()} />
          ) : term ? <Text tone="muted">{t('people.noMatch', { search: term })}</Text> : (
            <Card padding="none"><EmptyState icon={Users} title={t('people.empty')} description={t('people.emptyDescription')} /></Card>
          )}
          ListFooterComponent={people.isFetchNextPageError ? (
            <LoadError title={t('people.loadError')} error={people.error} onRetry={() => people.fetchNextPage()} />
          ) : people.isFetchingNextPage ? <ActivityIndicator accessibilityLabel={t('people.loadingMore')} /> : undefined}
        />
      )}
      <ProfileSheet
        person={selected}
        courseId={courseId}
        userId={account.user.id}
        onClose={() => setSelected(null)}
      />
      {toast.element}
    </CourseScope>
  );
}
