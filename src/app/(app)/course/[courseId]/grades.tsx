import { hasGradesTab, useCourseTabs } from '@/canvas/api/tabs';
import { useGradeLifetime, useGradeState, useGradesRefresh } from '@/features/grades/lifetime';
import { useGradePresentation } from '@/features/grades/presentation';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { RefreshControl, View } from 'react-native';

import type { GradeAssignment } from '@/canvas/api/grades';
import { useDashboardCourses } from '@/canvas/api/courses';
import {
  AccentScope,
  Callout,
  Card,
  deriveAccent,
  EmptyState,
  ListGroup,
  ListItem,
  Screen,
  Skeleton,
  Switch,
  useTheme,
} from '@/design';
import { groupPercent, scoreToLetter } from '@/features/grades/calculate';
import { GradeRow } from '@/features/grades/components/GradeRow';
import { GroupHeader } from '@/features/grades/components/GroupHeader';
import { PeriodPicker } from '@/features/grades/components/PeriodPicker';
import { TotalCard } from '@/features/grades/components/TotalCard';
import { WhatIfSheet } from '@/features/grades/components/WhatIfSheet';
import { describeGroup, describeMeta, describeScore, describeStatus } from '@/features/grades/format';
import { useCourseGrades } from '@/features/grades/useCourseGrades';

/** GRADE-2 to GRADE-6: one course's grades by assignment group, with periods and what-if scores. */
export default function CourseGradesScreen() {
  const { t } = useGradePresentation();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const tabs = useCourseTabs(courseId);
  if (!tabs.data || tabs.isError || !hasGradesTab(tabs.data)) {
    return (
      <>
        <Stack.Screen options={{ title: t('grades.title') }} />
        <Screen>
          {tabs.isError ? (
            <Callout
              tone="danger"
              title={t('grades.loadError')}
              action={{ label: t('grades.retry'), onPress: () => tabs.refetch() }}
            >
              {tabs.error.message}
            </Callout>
          ) : tabs.isPending ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : (
            <EmptyState icon={ClipboardList} title={t('grades.unavailable')} />
          )}
        </Screen>
      </>
    );
  }
  return <AvailableCourseGradesScreen key={courseId} />;
}

function AvailableCourseGradesScreen() {
  const p = useGradePresentation();
  const { t } = p;
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { scheme: colorScheme, colors } = useTheme();
  const card = useDashboardCourses().data?.find((c) => c.id === courseId);
  const color = card?.color ?? null;
  const grades = useCourseGrades(courseId);
  const { settings, groups, grade, mode, restricted } = grades;
  const { refreshing, refresh } = useGradesRefresh(grades.actionOwner, [grades.refresh]);
  const [dialog, setDialog] = useGradeState<{ assignment: GradeAssignment; token: object } | null>(
    grades.actionOwner,
    () => null,
  );
  const dialogOwner = useGradeLifetime('dialog', dialog?.token ?? grades.actionOwner, grades.actionOwner);
  const editing = dialog && grades.canWhatIf(dialog.assignment) ? dialog.assignment : null;
  const close = () => {
    if (!grades.actionOwner.valid() || !dialog || !dialogOwner.claim('done')) return false;
    grades.actionOwner.pending.delete('open');
    setDialog(null);
    return true;
  };
  const edit = (assignment: GradeAssignment) => {
    if (!grades.actionOwner.valid() || !grades.canWhatIf(assignment)) return;
    if (!grades.actionOwner.claim('open')) return;
    setDialog({ assignment, token: {} });
  };

  const courseName = card?.name ?? settings?.name ?? t('grades.course');
  const periodTitle =
    grades.periods.length > 0
      ? (grades.periods.find((p) => p.id === grades.selectedPeriod)?.title ?? t('grades.allPeriods'))
      : null;
  // Totals hidden by the instructor hide group subtotals too, as on the web.
  const showSubtotals = grades.policyReady && !!settings && !settings.hideFinalGrades;

  // GRADE-6: the assignment screen shows the submission and feedback.
  const openAssignment = (assignment: GradeAssignment) => {
    if (!grades.actionOwner.valid()) return;
    router.push({
      pathname: '/course/[courseId]/assignment/[assignmentId]',
      params: {
        courseId,
        assignmentId: assignment.id,
        ...(assignment.htmlUrl && { canvasUrl: assignment.htmlUrl }),
      },
    });
  };

  return (
    <AccentScope color={color} className="flex-1">
      <Stack.Screen
        options={{
          title: t('grades.title'),
          ...(color && { headerTintColor: deriveAccent(color, colorScheme).accentFg }),
        }}
      />
      <Screen
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        {grades.course.isError ? (
          <Callout
            tone="danger"
            title={t('grades.loadError')}
            action={{ label: t('grades.retry'), onPress: refresh }}
          >
            {grades.course.error.message}
          </Callout>
        ) : (
          <>
            {grades.periods.length > 0 ? (
              <PeriodPicker
                periods={grades.periods}
                selected={grades.selectedPeriod ?? null}
                onSelect={grades.selectPeriod}
              />
            ) : null}

            <View className="gap-3">
              <TotalCard
                total={grades.total}
                courseName={courseName}
                mode={mode}
                periodTitle={periodTitle}
                restricted={restricted}
              />
              {grades.whatIfCount > 0 ? (
                <Callout
                  tone="accent"
                  title={t('grades.whatIfOn')}
                  action={{ label: t('grades.reset'), onPress: grades.resetWhatIf }}
                >
                  {t(grades.whatIfCount === 1 ? 'grades.usedOne' : 'grades.usedMany', {
                    count: grades.whatIfCount,
                  })}{' '}
                  {t(grades.saving ? 'grades.saved' : 'grades.notSaved')}
                </Callout>
              ) : null}
            </View>

            {showSubtotals ? (
              <ListGroup
                footer={[
                  grades.basedOnGraded ? t('grades.ungradedExcluded') : t('grades.ungradedIncluded'),
                  grades.whatIfAllowed ? t('grades.tapScore') : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <ListItem
                  title={t('grades.basedOnGraded')}
                  trailing={
                    <Switch
                      accessibilityLabel={t('grades.basedOnGraded')}
                      value={grades.basedOnGraded}
                      onValueChange={grades.setBasedOnGraded}
                    />
                  }
                />
              </ListGroup>
            ) : null}

            {grades.whatIfAllowed ? (
              <ListGroup footer={grades.saving ? t('grades.saveHelp') : t('grades.localHelp')}>
                <ListItem
                  title={t('grades.save')}
                  trailing={
                    <Switch
                      accessibilityLabel={t('grades.save')}
                      value={grades.saving}
                      onValueChange={grades.setSaving}
                    />
                  }
                />
              </ListGroup>
            ) : null}

            {groups.isError && !groups.data ? (
              <Callout
                tone="danger"
                title={t('grades.assignmentsError')}
                action={{ label: t('grades.retry'), onPress: refresh }}
              >
                {groups.error.message}
              </Callout>
            ) : !settings || !groups.data ? (
              <View className="gap-3">
                <Skeleton className="mx-1 h-6 w-1/3" />
                <Skeleton className="h-48 rounded-2xl" />
              </View>
            ) : grades.visibleGroups.length === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={ClipboardList}
                  title={
                    periodTitle && grades.selectedPeriod !== null
                      ? t('grades.emptyPeriod', { title: periodTitle })
                      : t('grades.empty')
                  }
                  description={t('grades.emptyHelp')}
                />
              </Card>
            ) : (
              grades.visibleGroups.map((group) => {
                const subtotal = grade.groups[group.id]?.[mode];
                const percent = showSubtotals && subtotal ? groupPercent(subtotal) : null;
                const dropped = new Set(subtotal?.dropped ?? []);
                return (
                  <View key={group.id} className="gap-3">
                    <GroupHeader
                      name={group.name}
                      detail={describeGroup(group, { weighted: settings.weightGroups, restricted }, p)}
                      percent={percent}
                      letter={restricted ? scoreToLetter(percent, settings.scheme) : null}
                      restricted={restricted}
                    />
                    <ListGroup>
                      {group.assignments.map((assignment) => {
                        const whatIf = grades.whatIf[assignment.id];
                        const editable = grades.canWhatIf(assignment);
                        return (
                          <GradeRow
                            key={assignment.id}
                            assignment={assignment}
                            score={describeScore(
                              assignment,
                              { restricted, scheme: settings.scheme, whatIf },
                              p,
                            )}
                            status={describeStatus(
                              assignment,
                              {
                                dropped: dropped.has(assignment.id),
                                whatIf: whatIf !== undefined,
                                customStatuses: grades.customStatuses,
                              },
                              p,
                            )}
                            meta={describeMeta(assignment, restricted, new Date(), p)}
                            whatIf={whatIf !== undefined}
                            onWhatIf={editable ? () => edit(assignment) : undefined}
                            onPress={() => openAssignment(assignment)}
                          />
                        );
                      })}
                    </ListGroup>
                  </View>
                );
              })
            )}
          </>
        )}
      </Screen>

      <WhatIfSheet
        lifetime={dialog?.token}
        saving={grades.saving}
        assignment={editing}
        whatIf={editing ? grades.whatIf[editing.id] : undefined}
        onClose={close}
        onApply={(score) => {
          if (editing && close()) grades.setWhatIf(editing, score);
        }}
        onRemove={() => {
          if (editing && close()) grades.setWhatIf(editing, null);
        }}
      />
    </AccentScope>
  );
}
