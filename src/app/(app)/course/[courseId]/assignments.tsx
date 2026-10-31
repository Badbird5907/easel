import { useLocalSearchParams } from 'expo-router';
import { FileText, ListFilter } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  type Assignment,
  type AssignmentGroup,
  type AssignmentKind,
  currentGradingPeriod,
  useAssignmentGroups,
  useGradingPeriods,
} from '@/canvas/api/assignments';
import { Card, EmptyState, ListGroup, Screen, Section, SegmentedControl } from '@/design';
import { AssignmentListRow } from '@/features/course/AssignmentListRow';
import { CourseScope } from '@/features/course/CourseScope';
import {
  useAssignmentPresentation,
  useAssignmentAction,
  useAssignmentOwner,
} from '@/features/course/assignmentPresentation';
import type { Translate } from '@/i18n';
import { ChipRow, ExpandingPicker, type Option } from '@/features/course/Pickers';
import { ListSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';

type GroupBy = 'due' | 'group' | 'type';
type Filter = 'all' | 'not_submitted' | 'to_be_graded' | 'graded';
type Group = { key: string; title: string; items: Assignment[] };

const ALL_PERIODS = 'all';

const groupings = (t: Translate) =>
  [
    { value: 'due', label: t('assignmentPresentation.group.due') },
    { value: 'group', label: t('assignmentPresentation.group.group') },
    { value: 'type', label: t('assignmentPresentation.group.type') },
  ] as const;

const filterOptions = (t: Translate): Option<Filter>[] => [
  { value: 'all', label: t('assignmentPresentation.filter.all') },
  {
    value: 'not_submitted',
    label: t('assignmentPresentation.filter.not_submitted'),
  },
  {
    value: 'to_be_graded',
    label: t('assignmentPresentation.filter.to_be_graded'),
  },
  { value: 'graded', label: t('assignmentPresentation.filter.graded') },
];

const matches: Record<Filter, (a: Assignment) => boolean> = {
  all: () => true,
  not_submitted: (a) => a.status === 'open' || a.status === 'missing',
  to_be_graded: (a) => a.status === 'submitted',
  graded: (a) => a.status === 'graded',
};

const time = (d: Date | null) => d?.getTime() ?? 0;

/** Overdue work first, then what's coming, then undated, then everything already past. */
function byDueDate(items: Assignment[], now: Date, t: Translate): Group[] {
  const overdue: Assignment[] = [];
  const upcoming: Assignment[] = [];
  const undated: Assignment[] = [];
  const past: Assignment[] = [];
  for (const a of items) {
    if (!a.dueAt) undated.push(a);
    else if (a.dueAt >= now) upcoming.push(a);
    else if (a.status === 'open' || a.status === 'missing') overdue.push(a);
    else past.push(a);
  }
  overdue.sort((a, b) => time(a.dueAt) - time(b.dueAt));
  upcoming.sort((a, b) => time(a.dueAt) - time(b.dueAt));
  past.sort((a, b) => time(b.dueAt) - time(a.dueAt));
  return [
    {
      key: 'overdue',
      title: t('assignmentPresentation.overDue'),
      items: overdue,
    },
    {
      key: 'upcoming',
      title: t('assignmentPresentation.upcoming'),
      items: upcoming,
    },
    {
      key: 'undated',
      title: t('assignmentPresentation.noDue'),
      items: undated,
    },
    { key: 'past', title: t('assignmentPresentation.past'), items: past },
  ];
}

function byAssignmentGroup(items: Assignment[], groups: AssignmentGroup[]): Group[] {
  return groups.map((g) => ({
    key: g.id,
    title: g.name,
    items: items.filter((a) => a.groupId === g.id),
  }));
}

const kindOrder: AssignmentKind[] = ['assignment', 'quiz', 'discussion', 'external_tool', 'offline'];

function byType(items: Assignment[], t: Translate): Group[] {
  return kindOrder.map((kind) => ({
    key: kind,
    title: t(`assignmentPresentation.kind.${kind}`),
    items: items.filter((a) => a.kind === kind),
  }));
}

/** A course's assignments: grouped, filtered, and scoped to a grading period (ASSIGN-1). */
export default function AssignmentsScreen() {
  const { courseId, fromHome } = useLocalSearchParams<{
    courseId: string;
    fromHome?: string;
  }>();
  const { t } = useAssignmentPresentation();
  const filters = filterOptions(t);
  const gate = useTabGate(courseId, 'assignments', fromHome === '1');
  const periods = useGradingPeriods(courseId);
  const periodOwner = useAssignmentOwner(courseId);
  const [periodChoice, setPeriodChoice] = useState<{
    owner: typeof periodOwner;
    value: string;
  } | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('due');
  const [filter, setFilter] = useState<Filter>('all');
  const refreshControl = useRefreshControl([
    ['courses', courseId, 'assignment_groups'],
    ['courses', courseId, 'grading_periods'],
    ['courses', courseId, 'tabs'],
  ]);

  const periodList = periods.data ?? [];
  // Canvas opens on the current grading period, as the web and the official apps do.
  const chosenPeriod = periodChoice?.owner === periodOwner ? periodChoice.value : null;
  const periodId = chosenPeriod ?? currentGradingPeriod(periodList)?.id ?? ALL_PERIODS;
  const list = useAssignmentGroups(courseId, periodId === ALL_PERIODS ? null : periodId, !periods.isPending);

  const action = useAssignmentAction(JSON.stringify([courseId, periodId, gate]));
  const now = new Date();
  const visible = (list.data?.assignments ?? []).filter(matches[filter]);
  const groups = (
    groupBy === 'due'
      ? byDueDate(visible, now, t)
      : groupBy === 'group'
        ? byAssignmentGroup(visible, list.data?.groups ?? [])
        : byType(visible, t)
  ).filter((g) => g.items.length > 0);

  const periodOptions: Option<string>[] = [
    ...periodList.map((p) => ({ value: p.id, label: p.title })),
    { value: ALL_PERIODS, label: t('assignmentPresentation.allPeriods') },
  ];
  const total = list.data?.assignments.length ?? 0;

  return (
    <CourseScope courseId={courseId} title={t('assignmentPresentation.assignments')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {gate === 'hidden' ? (
          <TabDisabled courseId={courseId} label={t('assignmentPresentation.assignments')} />
        ) : (
          <>
            {periodList.length > 0 ? (
              <ExpandingPicker
                label={t('assignmentPresentation.period')}
                options={periodOptions}
                value={periodId}
                onChange={(value) => {
                  if (action.owner.active) setPeriodChoice({ owner: periodOwner, value });
                }}
              />
            ) : null}

            <View className="gap-3">
              <SegmentedControl
                options={groupings(t)}
                value={groupBy}
                onChange={(value) => {
                  if (action.owner.active) setGroupBy(value);
                }}
                accessibilityLabel={t('assignmentPresentation.groupLabel')}
              />
              <ChipRow
                options={filters}
                value={filter}
                onChange={(value) => {
                  if (action.owner.active) setFilter(value);
                }}
                accessibilityLabel={t('assignmentPresentation.filterLabel')}
              />
            </View>

            {periods.isPending || list.isPending ? (
              <ListSkeleton rows={5} />
            ) : list.isError ? (
              <LoadError
                title={t('assignmentPresentation.loadAssignments')}
                error={list.error}
                onRetry={() => action.run(() => list.refetch())}
              />
            ) : total === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={FileText}
                  title={t('assignmentPresentation.empty')}
                  description={
                    periodId === ALL_PERIODS
                      ? t('assignmentPresentation.emptyHelp')
                      : t('assignmentPresentation.emptyPeriod')
                  }
                />
              </Card>
            ) : groups.length === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={ListFilter}
                  title={t(`assignmentPresentation.empty.${filter}`)}
                  description={t(`assignmentPresentation.emptyHelp.${filter}`, {
                    count: total,
                  })}
                  action={{
                    label: t('assignmentPresentation.showAll'),
                    onPress: () => {
                      if (action.owner.active) setFilter('all');
                    },
                  }}
                />
              </Card>
            ) : (
              groups.map((group) => (
                <Section key={group.key} title={group.title}>
                  <ListGroup>
                    {group.items.map((a) => (
                      <AssignmentListRow key={a.id} a={a} now={now} />
                    ))}
                  </ListGroup>
                </Section>
              ))
            )}
          </>
        )}
      </Screen>
    </CourseScope>
  );
}
