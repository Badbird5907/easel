import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation } from 'expo-router';
import { clearSharedPayloads } from 'expo-sharing';
import { FileText, FileX } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { RefreshControl, View } from 'react-native';

import { type Assignment, useAssignmentGroups } from '@/canvas/api/assignments';
import { useCourseLookup } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import { Card, EmptyState, IconTile, ListGroup, ListItem, Screen, Text, useTheme } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { ListSkeleton, LoadError } from '@/features/course/states';
import { useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import { getSharedContentSnapshot, kindOf, useSharedContentSnapshot } from './content';
import { ShareAssignmentsOwner } from './shareAssignmentsLifetime';
import { assignmentFits, startSubmission } from './submit';

/**
 * Step two of "Submit to an assignment" (ASSIGN-16): open assignments in the
 * course that take what was shared. Choosing one opens its submit screen with
 * the files uploading, or the link or text filled in.
 */
export function AssignmentPicker({ courseId }: { courseId: string }) {
  const { account, client } = useCanvas();
  const shared = useSharedContentSnapshot();
  const content = shared.content;
  const course = useCourseLookup()(courseId);
  const list = useAssignmentGroups(courseId, null);
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const dates = useMemo(() => createDateContext(locale, zone), [locale, zone]);
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const navigation = useNavigation();
  // Locale/zone redrawDates clones Date-bearing query data and changes its
  // timestamp. Equal values still describe the same offered assignments; actual
  // data/eligibility changes retire controls, including in-place model changes.
  const querySource = JSON.stringify(list.data);
  const contentSource = JSON.stringify(content);
  const owner = useMemo(
    () =>
      new ShareAssignmentsOwner(
        focused,
        navigation,
        () => getSharedContentSnapshot() === shared && JSON.stringify(content) === contentSource,
      ),
    // Sources only: presentation changes keep committed controls valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      account.id,
      account.user.id,
      account.baseUrl,
      client,
      courseId,
      shared,
      content,
      contentSource,
      querySource,
      list.isPending,
      list.isError,
      list.error,
      list.errorUpdatedAt,
      queryClient,
      focused,
      navigation,
    ],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.retire();
  }, [owner]);
  const { epoch, refreshing } = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      tintColor={colors.fgMuted}
      onRefresh={() =>
        owner.refresh(epoch, () =>
          queryClient.refetchQueries({
            queryKey: [account.id, 'courses', courseId, 'assignment_groups'],
            type: 'active',
          }),
        )
      }
    />
  );
  const kind = kindOf(content);
  const now = new Date();

  const fits =
    list.data && !list.isPending && !list.isError
      ? assignmentFits(list.data.assignments, content, { t })
      : [];
  const open = fits.filter((f) => !f.problem);
  const refused = fits.filter((f) => f.problem);
  const courseName = course?.name ?? t('shareAssignments.courseFallback');

  const choose = (a: Assignment) => {
    if (!open.some((fit) => fit.assignment === a)) return;
    owner.choose(epoch, () => {
      startSubmission({ accountId: account.id, client }, a, content);
      clearSharedPayloads();
    });
  };

  const subtitleFor = (a: Assignment) => {
    const due = a.dueAt
      ? t('shareAssignments.due', {
          day: dates.formatShortDate(a.dueAt, now),
          time: dates.formatTime(a.dueAt),
        })
      : t('shareAssignments.noDue');
    return (a.submission?.attempt ?? 0) > 0 ? t('shareAssignments.resubmission', { due }) : due;
  };

  let body;
  if (kind === 'none') {
    body = (
      <Card padding="none">
        <EmptyState
          icon={FileText}
          title={t('shareAssignments.empty')}
          description={t('shareAssignments.emptyHelp')}
        />
      </Card>
    );
  } else if (list.isPending) {
    body = <ListSkeleton rows={5} />;
  } else if (list.isError) {
    body = (
      <LoadError
        title={t('shareAssignments.loadError')}
        error={list.error}
        onRetry={() => owner.refresh(epoch, () => list.refetch())}
      />
    );
  } else {
    body = (
      <>
        {open.length ? (
          <ListGroup>
            {open.map(({ assignment: a }) => (
              <ListItem
                key={a.id}
                leading={<IconTile icon={FileText} />}
                title={a.name}
                subtitle={subtitleFor(a)}
                accessibilityHint={t('shareAssignments.openHint')}
                accessibilityLabel={t('shareAssignments.rowLabel', {
                  name: a.name,
                  description: subtitleFor(a),
                })}
                onPress={() => choose(a)}
              />
            ))}
          </ListGroup>
        ) : (
          <Card padding="none">
            <EmptyState
              icon={FileX}
              title={t('shareAssignments.unavailable')}
              description={t(`shareAssignments.unavailable.${kind}`, {
                course: courseName,
                count: content.files.length,
              })}
            />
          </Card>
        )}
        {refused.length ? (
          <ListGroup footer={t('shareAssignments.refusedHelp')}>
            {refused.map(({ assignment: a, problem }) => (
              <ListItem
                key={a.id}
                leading={<IconTile icon={FileX} tone="neutral" />}
                title={a.name}
                subtitle={problem ?? undefined}
                accessibilityLabel={t('shareAssignments.rowLabel', {
                  name: a.name,
                  description: problem ?? '',
                })}
              />
            ))}
          </ListGroup>
        ) : null}
      </>
    );
  }

  return (
    <CourseScope courseId={courseId} title={t('shareAssignments.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-4">
        {kind !== 'none' ? (
          <View className="gap-1 px-1">
            <Text variant="title3" accessibilityRole="header">
              {courseName}
            </Text>
            <Text variant="subhead" tone="muted">
              {t(`shareAssignments.header.${kind}`, { count: content.files.length })}
            </Text>
          </View>
        ) : null}
        {body}
      </Screen>
    </CourseScope>
  );
}
