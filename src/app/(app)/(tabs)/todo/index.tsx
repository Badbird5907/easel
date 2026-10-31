import { useTranslation } from '@/i18n';
import { router } from 'expo-router';
import { BookOpen, CalendarRange, ListChecks, Plus, Settings2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { LayoutAnimation, RefreshControl, ScrollView, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useDashboardCourses } from '@/canvas/api/courses';
import { type OverrideState, usePlannerItems } from '@/canvas/api/planner';
import type { WorkItem } from '@/canvas/models';
import { useCanvas } from '@/canvas/session';
import {
  AccentScope,
  Button,
  Callout,
  Chip,
  EmptyState,
  haptics,
  IconButton,
  ListGroup,
  ListItem,
  type Option,
  OptionGroup,
  Screen,
  Sheet,
  Skeleton,
  Switch,
  useTheme,
  useToast,
} from '@/design';
import { useTodoBadgeSetting } from '@/features/planner/badge';
import {
  type CourseFilter,
  DEFAULT_RANGE,
  matchesCourse,
  PERSONAL,
  type RangePreset,
  rangeFor,
  rangePresets,
  type StatusFilter,
  statusFilters,
} from '@/features/planner/filters';
import { usePendingPlannerIds, useQueuedPlannerOverride } from '@/features/offline/plannerWrites';
import { QueuedChanges } from '@/features/offline/QueuedChanges';
import { useOnline } from '@/features/offline/useOnline';
import { canOpenWorkItem, openWorkItem } from '@/features/planner/open';
import { PlannerRow } from '@/features/planner/PlannerRow';
import { useDisplayTimeZone } from '@/lib/dates';
import { useNow } from '@/features/reminders/useNow';
import { groupByDue } from '@/lib/due';

/** How long a checked-off row stays in place before it moves to Done. */
const LINGER_MS = 1800;

/**
 * Keeps just-toggled rows where they were for a moment, so checking one off
 * doesn't yank it out from under the finger. `held` maps item IDs to how the
 * item looked before the toggle; grouping and filtering use that snapshot.
 */
function useLinger(animate: () => void) {
  const [held, setHeld] = useState<ReadonlyMap<string, WorkItem>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const release = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    animate();
    setHeld((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  };

  const hold = (item: WorkItem) => {
    setHeld((current) => (current.has(item.id) ? current : new Map(current).set(item.id, item)));
    clearTimeout(timers.current.get(item.id));
    timers.current.set(
      item.id,
      setTimeout(() => release(item.id), LINGER_MS),
    );
  };

  return { held, hold, release };
}

export default function TodoScreen() {
  const { t } = useTranslation();
  useDisplayTimeZone();
  const [now] = useNow(60_000);
  const { account } = useCanvas();
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [courseFilter, setCourseFilter] = useState<CourseFilter>(null);
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_RANGE);
  const range = rangeFor(preset, new Date(now));
  const [sheet, setSheet] = useState<'course' | 'range' | 'options' | null>(null);
  const [badgeOn, setBadgeOn] = useTodoBadgeSetting();
  const [showCompleted, setShowCompleted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const planner = usePlannerItems(range);
  const courses = useDashboardCourses();
  // OFF-2: offline, mark done and dismiss queue and show right away.
  const setOverride = useQueuedPlannerOverride();
  const pending = usePendingPlannerIds();
  const online = useOnline();
  const toast = useToast();

  const animate = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };
  const linger = useLinger(animate);

  const courseFor = (id: string | null) => (id ? courses.data?.find((c) => c.id === id) : undefined);
  const filteredCourse = courseFilter && courseFilter !== PERSONAL ? courseFor(courseFilter) : undefined;
  const statusTest = (statusFilters.find((f) => f.value === status) ?? statusFilters[0]).test;
  const rangeLabel = t(rangePresets.find((p) => p.value === preset)?.labelKey ?? 'planner.rangeUpcoming');
  const courseLabel =
    courseFilter === null
      ? t('planner.allCourses')
      : courseFilter === PERSONAL
        ? t('calendar.personal')
        : (filteredCourse?.code ?? t('planner.course'));

  const live = new Map((planner.data ?? []).map((item) => [item.id, item]));
  const visible = (planner.data ?? [])
    .filter((item) => !item.dismissed)
    .map((item) => linger.held.get(item.id) ?? item)
    .filter((item) => matchesCourse(item, courseFilter) && statusTest(item));
  const groups = groupByDue(visible, new Date(now));
  const collapsible = status === 'all';
  const doneGroup = collapsible ? groups.find((g) => g.key === 'done') : undefined;
  const openGroups = collapsible ? groups.filter((g) => g.key !== 'done') : groups;

  const write = (item: WorkItem, state: OverrideState) =>
    setOverride(item, state).catch((error: Error) => {
      linger.release(item.id);
      haptics.error();
      toast.show(t('planner.updateError', { title: item.title, error: error.message }));
    });

  const toggleDone = (item: WorkItem) => {
    const markedComplete = !item.markedComplete;
    haptics.selection();
    linger.hold(item);
    write(item, { markedComplete, dismissed: item.dismissed });
    toast.show(
      t(
        markedComplete
          ? online
            ? 'planner.markedDone'
            : 'planner.markedDoneOffline'
          : online
            ? 'planner.markedNotDone'
            : 'planner.markedNotDoneOffline',
        { title: item.title },
      ),
      {
        label: t('planner.undo'),
        onPress: () =>
          write(
            { ...item, markedComplete },
            { markedComplete: item.markedComplete, dismissed: item.dismissed },
          ),
      },
    );
  };

  const dismiss = (item: WorkItem) => {
    haptics.selection();
    animate();
    write(item, { markedComplete: item.markedComplete, dismissed: true });
    toast.show(t(online ? 'planner.dismissed' : 'planner.dismissedOffline', { title: item.title }), {
      label: t('planner.undo'),
      onPress: () => {
        animate();
        write({ ...item, dismissed: true }, { markedComplete: item.markedComplete, dismissed: false });
      },
    });
  };

  const addTodo = () =>
    router.push({
      pathname: '/planner-note/new',
      params: filteredCourse ? { courseId: filteredCourse.id } : {},
    });

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([planner.refetch(), courses.refetch()]);
    setRefreshing(false);
  };

  const renderGroup = (group: (typeof groups)[number]) => (
    <ListGroup
      key={group.key}
      header={
        group.key === 'overdue' ? t('planner.overdue') : group.key === 'done' ? t('common.done') : group.title
      }
    >
      {group.items.map((snapshot) => {
        const item = live.get(snapshot.id) ?? snapshot;
        return (
          <PlannerRow
            key={item.id}
            item={item}
            course={courseFor(item.courseId)}
            showDay={group.key === 'overdue' || group.key === 'done'}
            onPress={canOpenWorkItem(item) ? () => openWorkItem(item, account.baseUrl) : undefined}
            onToggleDone={() => toggleDone(item)}
            onDismiss={() => dismiss(item)}
            pending={pending.has(item.id)}
          />
        );
      })}
    </ListGroup>
  );

  const empty =
    status === 'missing'
      ? {
          title: t('planner.emptyMissing'),
          description: t('planner.emptyMissingHelp'),
        }
      : status === 'done'
        ? {
            title: t('planner.emptyDone'),
            description: filteredCourse
              ? t('planner.emptyDoneCourse', { course: filteredCourse.code })
              : t(courseFilter === PERSONAL ? 'planner.emptyDonePersonal' : 'planner.emptyDoneAll'),
          }
        : {
            title: doneGroup ? t('planner.caughtUp') : t('planner.empty'),
            description: filteredCourse
              ? t('planner.emptyRangeCourse', { course: filteredCourse.code, range: rangeLabel })
              : t(courseFilter === PERSONAL ? 'planner.emptyRangePersonal' : 'planner.emptyRangeAll', {
                  range: rangeLabel,
                }),
          };

  const courseOptions: Option<string>[] = [
    {
      value: 'all',
      label: t('planner.allCourses'),
      leading: <View className="h-3 w-3 rounded-full border border-border-strong" />,
    },
    {
      value: PERSONAL,
      label: t('calendar.personal'),
      subtitle: t('planner.personalHelp'),
      leading: <View className="h-3 w-3 rounded-full bg-fg-muted" />,
    },
    ...(courses.data ?? []).map((c) => ({
      value: c.id,
      label: c.code,
      subtitle: c.name,
      leading: (
        <AccentScope color={c.color}>
          <View className="h-3 w-3 rounded-full bg-accent" />
        </AccentScope>
      ),
    })),
  ];

  return (
    <>
      <Screen
        title={t('nav.todo')}
        titleAccessory={
          <View className="flex-row items-center gap-2">
            <IconButton
              icon={Settings2}
              variant="secondary"
              accessibilityLabel={t('planner.options')}
              onPress={() => setSheet('options')}
            />
            <IconButton
              icon={Plus}
              variant="secondary"
              accessibilityLabel={t('planner.add')}
              onPress={addTodo}
            />
          </View>
        }
        contentClassName="gap-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-4"
          contentContainerClassName="items-center gap-2 px-4"
        >
          {statusFilters.map((f) => (
            <Chip key={f.value} selected={status === f.value} onPress={() => setStatus(f.value)}>
              {t(f.labelKey)}
            </Chip>
          ))}
          <View className="mx-1 h-5 w-px bg-border-strong" />
          <Chip
            icon={BookOpen}
            selected={courseFilter !== null}
            accessibilityLabel={t('planner.courseLabel', { course: courseLabel })}
            accessibilityHint={t('planner.chooseCourseHint')}
            onPress={() => setSheet('course')}
          >
            {courseLabel}
          </Chip>
          <Chip
            icon={CalendarRange}
            selected={preset !== DEFAULT_RANGE}
            accessibilityLabel={t('planner.datesLabel', { range: rangeLabel })}
            accessibilityHint={t('planner.chooseRangeHint')}
            onPress={() => setSheet('range')}
          >
            {rangeLabel}
          </Chip>
        </ScrollView>

        <QueuedChanges kinds={['planner-override', 'planner-note']} />

        {planner.isPending ? (
          <View className="gap-3">
            <Skeleton className="ml-4 h-3 w-24" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="ml-4 mt-3 h-3 w-20" />
            <Skeleton className="h-24 rounded-2xl" />
          </View>
        ) : planner.isError ? (
          <Callout
            tone="danger"
            title={t('planner.loadError')}
            action={{ label: t('common.retry'), onPress: () => planner.refetch() }}
          >
            {planner.error.message}
          </Callout>
        ) : (
          <>
            {openGroups.length > 0 ? (
              openGroups.map(renderGroup)
            ) : (
              <EmptyState
                icon={ListChecks}
                title={empty.title}
                description={empty.description}
                action={
                  status === 'all' || status === 'open'
                    ? { label: t('planner.add'), leadingIcon: Plus, onPress: addTodo }
                    : undefined
                }
              />
            )}
            {doneGroup ? (
              <View className="gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-center"
                  accessibilityState={{ expanded: showCompleted }}
                  onPress={() => {
                    animate();
                    setShowCompleted((s) => !s);
                  }}
                >
                  {showCompleted
                    ? t('planner.hideCompleted')
                    : t('planner.showCompleted', { count: doneGroup.items.length })}
                </Button>
                {showCompleted ? renderGroup(doneGroup) : null}
              </View>
            ) : null}
          </>
        )}
      </Screen>

      {toast.element}

      <Sheet visible={sheet === 'course'} title={t('planner.course')} onClose={() => setSheet(null)}>
        <OptionGroup
          options={courseOptions}
          selected={courseFilter ?? 'all'}
          onSelect={(value) => {
            setCourseFilter(value === 'all' ? null : value);
            setSheet(null);
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'options'} title={t('planner.options')} onClose={() => setSheet(null)}>
        <ListGroup footer={t('planner.badgeHelp')}>
          <ListItem
            title={t('planner.badge')}
            chevron={false}
            trailing={
              <Switch value={badgeOn} onValueChange={setBadgeOn} accessibilityLabel={t('planner.badge')} />
            }
          />
        </ListGroup>
      </Sheet>

      <Sheet visible={sheet === 'range'} title={t('planner.dates')} onClose={() => setSheet(null)}>
        <OptionGroup
          options={rangePresets.map((p) => ({ value: p.value, label: t(p.labelKey) }))}
          selected={preset}
          footer={t('planner.rangeHelp')}
          onSelect={(value) => {
            setPreset(value);
            setSheet(null);
          }}
        />
      </Sheet>
    </>
  );
}
