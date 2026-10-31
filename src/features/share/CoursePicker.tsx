import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useIsFocused, useNavigation } from 'expo-router';
import { BookOpen } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { RefreshControl } from 'react-native';

import { useAllCourses } from '@/canvas/api/tabs';
import { useCanvas } from '@/canvas/session';
import { Card, EmptyState, IconTile, ListGroup, ListItem, Screen, Text, useTheme } from '@/design';
import { ListSkeleton, LoadError } from '@/features/course/states';
import { useTranslation } from '@/i18n';

import { getSharedContentSnapshot, kindOf, useSharedContentSnapshot } from './content';
import { ShareCoursesControls } from './shareCoursesControls';

/** Step one of "Submit to an assignment" (ASSIGN-16): which course. */
export function CoursePicker() {
  const courses = useAllCourses();
  const shared = useSharedContentSnapshot();
  const content = shared.content;
  const contentSource = JSON.stringify(content);
  const { t } = useTranslation();
  const { account, client } = useCanvas();
  const accountId = account.id;
  const userId = account.user.id;
  const baseUrl = account.baseUrl;
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const kind = kindOf(content);
  const empty = kind === 'none';
  const controls = useMemo(
    () =>
      new ShareCoursesControls(
        () =>
          focused &&
          navigation.isFocused() &&
          !empty &&
          getSharedContentSnapshot() === shared &&
          JSON.stringify(content) === contentSource,
      ),
    // Scalar session identity survives equivalent account clones and locale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      accountId,
      userId,
      baseUrl,
      client,
      queryClient,
      shared,
      content,
      contentSource,
      focused,
      navigation,
      empty,
    ],
  );
  const { data, isPending, isError, error, refetch } = courses;
  const query = useMemo(
    () => ({ data, isPending, isError, error, refetch }),
    [data, isPending, isError, error, refetch],
  );
  const state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  useLayoutEffect(() => {
    controls.activate();
    const blur = navigation.addListener('blur', () => controls.retire());
    const focus = navigation.addListener('focus', () => controls.activate());
    return () => {
      blur();
      focus();
      controls.retire();
    };
  }, [controls, navigation]);
  useLayoutEffect(() => controls.commitQuery(query), [controls, query]);
  const retry = () => controls.refresh(state, query, () => refetch({ throwOnError: true }));
  const refreshControl = (
    <RefreshControl
      refreshing={state.refreshing}
      onRefresh={() =>
        controls.refresh(state, query, () =>
          queryClient.refetchQueries(
            { queryKey: [accountId, 'courses', 'all'], type: 'active' },
            { throwOnError: true },
          ),
        )
      }
      tintColor={colors.fgMuted}
    />
  );
  const prompt =
    kind === 'files'
      ? content.files.length === 1
        ? t('shareCourses.filePrompt', { name: content.files[0].name })
        : t('shareCourses.filesPrompt', { count: content.files.length })
      : kind === 'url'
        ? t('shareCourses.linkPrompt')
        : t('shareCourses.textPrompt');
  const available = courses.data?.filter((course) => course.timing === 'current' && !course.restricted) ?? [];

  let body;
  if (empty) {
    body = (
      <Card padding="none">
        <EmptyState
          icon={BookOpen}
          title={t('shareCourses.emptyTitle')}
          description={t('shareCourses.emptyBody')}
        />
      </Card>
    );
  } else if (courses.isError || state.failure) {
    const failure = courses.isError ? courses.error : state.failure?.error;
    body = (
      <LoadError
        title={t('shareCourses.loadError')}
        error={failure instanceof Error ? failure : new Error(t('shareCourses.retryFailed'))}
        onRetry={retry}
      />
    );
  } else if (courses.isPending) {
    body = <ListSkeleton rows={5} />;
  } else if (!available.length) {
    body = (
      <Card padding="none">
        <EmptyState
          icon={BookOpen}
          title={t('shareCourses.noCoursesTitle')}
          description={t('shareCourses.noCoursesBody')}
        />
      </Card>
    );
  } else {
    body = (
      <ListGroup>
        {available.map((course) => (
          <ListItem
            key={course.id}
            leading={<IconTile icon={BookOpen} color={course.color} />}
            title={course.name}
            subtitle={course.code}
            subtitleLines={1}
            onPress={() =>
              controls.select(state, query, () =>
                router.push({
                  pathname: '/share/assignments/[courseId]',
                  params: { courseId: course.id },
                } as never),
              )
            }
          />
        ))}
      </ListGroup>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('shareCourses.title') }} />
      <Screen refreshControl={refreshControl} contentClassName="gap-4">
        {!empty ? (
          <Text variant="subhead" tone="muted" className="px-1">
            {prompt}
          </Text>
        ) : null}
        {body}
      </Screen>
    </>
  );
}
