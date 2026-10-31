import { useTranslation, type Translate } from '@/i18n';
import { router } from 'expo-router';
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ListFilter,
  Plus,
} from 'lucide-react-native';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppointmentGroups } from '@/canvas/api/appointments';
import {
  type CalendarItem,
  useCalendarItems,
  useCalendars,
  usePrefetchCalendar,
} from '@/canvas/api/calendar';
import { useDashboardCourses } from '@/canvas/api/courses';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  IconButton,
  ListGroup,
  Screen,
  Section,
  SegmentedControl,
  Skeleton,
  Text,
  useTheme,
} from '@/design';
import { AgendaRow, calendarColor, useDotColor } from '@/features/calendar/AgendaRow';
import { CalendarFilterSheet } from '@/features/calendar/CalendarFilterSheet';
import { HourGrid, type HourGridHandle } from '@/features/calendar/HourGrid';
import { type DayMarks, MonthGrid } from '@/features/calendar/MonthGrid';
import {
  addDays,
  addMonths,
  dayKey,
  fullDay,
  gridRange,
  monthTitle,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  weekDays,
} from '@/features/calendar/month';
import { PeriodPager } from '@/features/calendar/PeriodPager';
import { type CalendarView, useCalendarView } from '@/features/calendar/preferences';
import { useHiddenCalendars } from '@/features/calendar/selection';
import { minutesOf } from '@/features/calendar/timeGrid';
import { openCanvasLink } from '@/features/content/links';
import { useActionSheet } from '@/features/files/ActionSheet';
import { daysOf } from '@/features/calendar/eventDates';
import { dateFormatter, dayBoundary, fromDayKey, useDisplayTimeZone } from '@/lib/dates';
import { useNow } from '@/features/reminders/useNow';

const views = [
  { value: 'month', labelKey: 'calendar.month' },
  { value: 'week', labelKey: 'calendar.week' },
  { value: 'day', labelKey: 'calendar.day' },
  { value: 'agenda', labelKey: 'calendar.agenda' },
] as const;

/** Pinching open moves to a closer view; pinching closed, to a wider one. */
const closer: Partial<Record<CalendarView, CalendarView>> = { month: 'week', week: 'day' };
const wider: Partial<Record<CalendarView, CalendarView>> = { day: 'week', week: 'month' };

/** Below this, the hour grid would be too short to use, so the whole screen scrolls instead. */
const MIN_GRID = 320;

const rangeDate = dateFormatter({ month: 'short', day: 'numeric', year: 'numeric' });

function weekTitle(days: Date[], t: Translate): string {
  return t('calendar.dateRange', {
    start: rangeDate.format(days[0]),
    end: rangeDate.format(days[days.length - 1]),
  });
}

/** Days the agenda lists at a time. */
const AGENDA_DAYS = 28;

/** Four weeks from a week's first day (`YYYY-MM-DD`). */
function agendaRange(firstDay: string) {
  const start = fromDayKey(firstDay);
  const end = dayBoundary(start, AGENDA_DAYS);
  end.setMilliseconds(-1);
  return { start, end };
}

const byTime = (a: CalendarItem, b: CalendarItem) =>
  Number(b.allDay) - Number(a.allDay) ||
  a.start.getTime() - b.start.getTime() ||
  a.title.localeCompare(b.title);

export default function CalendarScreen() {
  const { t } = useTranslation();
  const zone = useDisplayTimeZone();
  const { account } = useCanvas();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [nowMs] = useNow(60_000);
  const now = new Date(nowMs);
  const today = startOfDay(now);
  const [view, setView] = useCalendarView();
  // Navigation state is civil, so changing zones cannot page back a day/month.
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeMonthKey = monthKey ?? dayKey(startOfMonth(today));
  const activeDayKey = selectedKey ?? dayKey(today);
  const month = fromDayKey(activeMonthKey, zone);
  const selected = fromDayKey(activeDayKey, zone);
  const setMonth = useCallback((day: Date) => setMonthKey(dayKey(startOfMonth(day))), []);
  const setSelected = useCallback((day: Date) => setSelectedKey(dayKey(day)), []);
  const [filtering, setFiltering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const { show: showMenu, sheet: menuSheet } = useActionSheet();

  const calendars = useCalendars();
  const courses = useDashboardCourses();
  const { hidden, toggle, setHidden } = useHiddenCalendars();
  const codes = calendars.data?.map((c) => c.code);
  // Agenda reads four weeks from the selected week; the other views read the month's grid.
  const agendaStart = dayKey(startOfWeek(selected));
  const range = view === 'agenda' ? agendaRange(agendaStart) : gridRange(month);
  const items = useCalendarItems(range, codes);
  const appointments = useAppointmentGroups();
  const prefetch = usePrefetchCalendar();
  const dotColor = useDotColor();

  // The months either side load in the background, so paging doesn't wait.
  const loaded = !!items.data;
  const codesKey = codes?.join(',');
  const monthMs = month.getTime();
  useEffect(() => {
    if (!loaded || !codesKey) return;
    const list = codesKey.split(',');
    prefetch(gridRange(addMonths(new Date(monthMs), 1)), list);
    prefetch(gridRange(addMonths(new Date(monthMs), -1)), list);
  }, [loaded, codesKey, monthMs, prefetch]);

  const sourceFor = (code: string) => calendars.data?.find((c) => c.code === code);
  const visible =
    hidden && items.data ? items.data.filter((item) => !hidden.has(item.contextCode)) : undefined;
  const allHidden = !!calendars.data && !!hidden && calendars.data.every((c) => hidden.has(c.code));
  const colorFor = (item: CalendarItem) =>
    calendarColor(item.contextCode, sourceFor(item.contextCode)) ??
    (item.courseId ? (courses.data?.find((c) => c.id === item.courseId)?.color ?? null) : null);
  const contextFor = (item: CalendarItem) => {
    const source = sourceFor(item.contextCode);
    return source?.type === 'user'
      ? t('calendar.personal')
      : source?.type === 'course'
        ? source.shortName
        : (source?.name ?? item.contextName ?? t('calendar.personal'));
  };

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of visible ?? []) {
    for (const key of daysOf(item)) byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const marks = new Map<string, DayMarks>();
  for (const [key, dayItems] of byDay) {
    const raw = [...new Set(dayItems.sort(byTime).map(colorFor))];
    marks.set(key, { colors: raw.map(dotColor), count: dayItems.length });
  }
  const agenda = [...(byDay.get(dayKey(selected)) ?? [])].sort(byTime);

  const select = useCallback(
    (day: Date) => {
      setSelected(day);
      setMonth(day);
    },
    [setMonth, setSelected],
  );

  const changeView = (next: CalendarView) => {
    // Week and day views follow the selected day; keep it inside the month on screen.
    if ((view === 'month' || view === 'agenda') && !sameDay(startOfMonth(selected), month)) {
      setSelected(sameDay(month, startOfMonth(today)) ? today : month);
    }
    setView(next);
  };

  /** Month and agenda page by month, week by week, day by day. */
  const page = (delta: 1 | -1) => {
    if (view === 'week') return select(addDays(selected, delta * 7));
    if (view === 'agenda') {
      setShowEarlier(false);
      return select(addDays(selected, delta * AGENDA_DAYS));
    }
    if (view === 'day') return select(addDays(selected, delta));
    const next = addMonths(month, delta);
    setMonth(next);
    setShowEarlier(false);
    setSelected(sameDay(startOfMonth(today), next) ? today : next);
  };

  const pinch = (direction: 'in' | 'out') => {
    const next = direction === 'in' ? closer[view] : wider[view];
    if (next) changeView(next);
  };

  const grid = useRef<HourGridHandle>(null);
  const goToday = () => {
    setMonthKey(null);
    setSelectedKey(null);
    setShowEarlier(false);
    grid.current?.scrollToMinutes(minutesOf(new Date()));
  };

  const openItem = (item: CalendarItem) => {
    if (item.noteId) router.push({ pathname: '/planner-note/[noteId]', params: { noteId: item.noteId } });
    else if (item.eventId) router.push({ pathname: '/event/[eventId]', params: { eventId: item.eventId } });
    else if (item.htmlUrl) openCanvasLink(item.htmlUrl, account.baseUrl);
  };
  const canOpen = (item: CalendarItem) => !!(item.noteId || item.eventId || item.htmlUrl);

  const addTodo = () => router.push({ pathname: '/planner-note/new', params: { date: dayKey(selected) } });
  const addEvent = (day = selected, minutes?: number) =>
    router.push({
      pathname: '/event/new',
      params: { date: dayKey(day), ...(minutes !== undefined ? { minutes: String(minutes) } : {}) },
    });

  const openMenu = () =>
    showMenu({
      options: [
        { label: t('calendar.addEvent'), onPress: () => addEvent() },
        { label: t('planner.add'), onPress: addTodo },
        { label: t('calendar.signup'), onPress: () => router.push('/appointments') },
        { label: t('calendar.export'), onPress: () => router.push('/calendar-feed') },
      ],
    });

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([calendars.refetch(), items.refetch(), appointments.refetch()]);
    setRefreshing(false);
  };

  const filtered = !!hidden && hidden.size > 0;
  const loading = items.isPending || !hidden;
  const gridMode = view === 'week' || view === 'day';
  const periodDays = view === 'week' ? weekDays(selected) : [selected];
  const periodTitle =
    view === 'week'
      ? weekTitle(periodDays, t)
      : view === 'day'
        ? fullDay.format(selected)
        : view === 'agenda'
          ? weekTitle([range.start, range.end], t)
          : monthTitle.format(month);
  const pageKey = `${zone}:${view}:${
    gridMode
      ? dayKey(view === 'week' ? periodDays[0] : selected)
      : view === 'agenda'
        ? agendaStart
        : dayKey(month)
  }`;

  // The hour grid fills the screen below the controls; measured once laid out.
  const root = useRef<ComponentRef<typeof View>>(null);
  const gridSlot = useRef<ComponentRef<typeof View>>(null);
  const [screenHeight, setScreenHeight] = useState(0);
  const [gridTop, setGridTop] = useState(0);
  const measure = () => {
    if (!root.current || !gridSlot.current) return;
    gridSlot.current.measureLayout(
      root.current,
      (_x, y) => setGridTop(y),
      () => {},
    );
  };
  const available = screenHeight - gridTop;
  const gridFits = gridTop > 0 && available >= MIN_GRID;
  const gridHeight = gridFits ? available : 440;
  const bottomInset = Platform.OS === 'ios' ? insets.bottom + 64 : 12;

  // Week and day views open at the current time, or at the period's first item.
  const timed = (visible ?? []).filter((i) => !i.allDay && periodDays.some((d) => sameDay(d, i.start)));
  const firstTimed = timed.length ? Math.min(...timed.map((i) => minutesOf(i.start))) : null;
  const showsToday = periodDays.some((d) => sameDay(d, today));
  const scrollTarget = showsToday ? minutesOf(new Date()) : (firstTimed ?? 8 * 60);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!gridMode || gridTop === 0) return;
    // Wait for the data before placing a period that isn't today.
    if (!showsToday && loading) return;
    if (scrolledFor.current === pageKey) return;
    scrolledFor.current = pageKey;
    grid.current?.scrollToMinutes(scrollTarget, false);
  }, [gridMode, gridTop, pageKey, showsToday, loading, scrollTarget]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
  );

  const needsSignup = (appointments.data ?? []).filter((g) => g.requiringAction);

  const signupCallout =
    needsSignup.length > 0 && !gridMode ? (
      <Callout
        tone="accent"
        icon={CalendarClock}
        title={
          needsSignup.length === 1
            ? t('calendar.signup')
            : t('calendar.signupCount', { count: needsSignup.length })
        }
        action={{
          label: t('calendar.chooseTime'),
          onPress: () =>
            needsSignup.length === 1
              ? router.push({ pathname: '/appointments/[groupId]', params: { groupId: needsSignup[0].id } })
              : router.push('/appointments'),
        }}
      >
        {needsSignup.length === 1
          ? needsSignup[0].courseId
            ? t('calendar.signupCourse', {
                title: needsSignup[0].title,
                course:
                  courses.data?.find((c) => c.id === needsSignup[0].courseId)?.code ??
                  t('calendar.yourCourse'),
              })
            : t('calendar.signupTitle', { title: needsSignup[0].title })
          : t('calendar.signupPosted')}
      </Callout>
    ) : null;

  const statusBlock = allHidden ? (
    <Callout
      tone="info"
      title={t('calendar.allHidden')}
      action={{ label: t('calendar.choose'), onPress: () => setFiltering(true) }}
    >
      {t('calendar.hiddenHelp')}
    </Callout>
  ) : items.isError && !items.data ? (
    <Callout
      tone="danger"
      title={t('calendar.loadError')}
      action={{ label: t('common.retry'), onPress: () => items.refetch() }}
    >
      {items.error?.message ?? t('calendar.error')}
    </Callout>
  ) : items.isPartial ? (
    <Callout
      tone="warning"
      title={t('calendar.partial')}
      action={{ label: t('common.retry'), onPress: () => items.refetch() }}
    >
      {items.error?.message ?? t('calendar.partialHelp')}
    </Callout>
  ) : null;

  const dayAgenda = (
    <Section
      title={
        sameDay(selected, today)
          ? t('calendar.todayDate', { date: fullDay.format(selected) })
          : fullDay.format(selected)
      }
    >
      {allHidden || items.isError ? null : loading ? (
        <View className="gap-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </View>
      ) : agenda.length > 0 ? (
        <ListGroup>
          {agenda.map((item) => (
            <AgendaRow
              key={item.id}
              item={item}
              source={sourceFor(item.contextCode)}
              onPress={canOpen(item) ? () => openItem(item) : undefined}
            />
          ))}
        </ListGroup>
      ) : (
        <Card variant="outlined" padding="none">
          <EmptyState
            icon={CalendarDays}
            title={t('calendar.empty')}
            description={filtered ? t('calendar.emptyDayFiltered') : t('calendar.emptyDay')}
          />
        </Card>
      )}
      <View className="flex-row gap-3">
        <Button variant="tonal" size="sm" leadingIcon={Plus} className="flex-1" onPress={addTodo}>
          {t('planner.add')}
        </Button>
        <Button
          variant="tonal"
          size="sm"
          leadingIcon={CalendarPlus}
          className="flex-1"
          onPress={() => addEvent()}
        >
          {t('calendar.addEvent')}
        </Button>
      </View>
    </Section>
  );

  // Agenda: every day with something on it in the four weeks; the current ones start today.
  const agendaEnd = dayKey(range.end);
  const agendaDays = [...byDay.keys()].filter((key) => key >= agendaStart && key <= agendaEnd).sort();
  const thisMonth = dayKey(today) >= agendaStart && dayKey(today) <= agendaEnd;
  const earlier = thisMonth ? agendaDays.filter((key) => key < dayKey(today)) : [];
  const agendaShown =
    showEarlier || !thisMonth ? agendaDays : agendaDays.filter((key) => key >= dayKey(today));
  const keyDate = fromDayKey;

  const agendaList =
    loading && !allHidden && !items.isError && !items.data ? (
      <View className="gap-3">
        <Skeleton className="ml-4 h-3 w-40" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="ml-4 mt-3 h-3 w-32" />
        <Skeleton className="h-16 rounded-2xl" />
      </View>
    ) : allHidden || items.isError ? null : (
      <View className="gap-6">
        {earlier.length > 0 && !showEarlier ? (
          <Button variant="secondary" size="sm" className="self-center" onPress={() => setShowEarlier(true)}>
            {t('calendar.earlierDays', { count: earlier.length })}
          </Button>
        ) : null}
        {agendaShown.length > 0 ? (
          agendaShown.map((key) => {
            const day = keyDate(key);
            return (
              <ListGroup
                key={key}
                header={
                  sameDay(day, today)
                    ? t('calendar.todayDate', { date: fullDay.format(day) })
                    : fullDay.format(day)
                }
              >
                {[...(byDay.get(key) ?? [])].sort(byTime).map((item) => (
                  <AgendaRow
                    key={item.id}
                    item={item}
                    source={sourceFor(item.contextCode)}
                    onPress={canOpen(item) ? () => openItem(item) : undefined}
                  />
                ))}
              </ListGroup>
            );
          })
        ) : (
          <Card variant="outlined" padding="none">
            <EmptyState
              icon={CalendarDays}
              title={thisMonth ? t('calendar.emptyUpcoming') : t('calendar.emptyWeeks')}
              description={filtered ? t('calendar.emptyFiltered') : t('calendar.emptyRange')}
              action={{ label: t('calendar.addEvent'), leadingIcon: CalendarPlus, onPress: () => addEvent() }}
            />
          </Card>
        )}
      </View>
    );

  return (
    <View ref={root} className="flex-1 bg-bg" onLayout={(e) => setScreenHeight(e.nativeEvent.layout.height)}>
      <Screen
        title={t('nav.calendar')}
        titleAccessory={
          <View className="flex-row items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              accessibilityLabel={t('date.today')}
              accessibilityHint={t('calendar.todayHint')}
              onPress={goToday}
            >
              {t('date.today')}
            </Button>
            <IconButton
              icon={ListFilter}
              variant={filtered ? 'tonal' : 'secondary'}
              accessibilityLabel={filtered ? t('calendar.someHidden') : t('calendar.calendars')}
              accessibilityHint={t('calendar.chooseHint')}
              onPress={() => setFiltering(true)}
            />
            <IconButton
              icon={Ellipsis}
              variant="secondary"
              accessibilityLabel={t('calendar.more')}
              onPress={openMenu}
            />
          </View>
        }
        contentClassName={gridMode ? 'gap-3' : 'gap-6'}
        scrollEnabled={!gridMode || !gridFits}
        refreshControl={gridMode && gridFits ? undefined : refreshControl}
      >
        <View className="gap-3">
          <SegmentedControl
            options={views.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
            value={view}
            onChange={changeView}
            accessibilityLabel={t('calendar.view')}
          />
          <View className="flex-row items-center gap-1">
            <Text variant="title3" accessibilityRole="header" className="flex-1 px-1">
              {periodTitle}
            </Text>
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel={t(`calendar.previous.${view}`)}
              onPress={() => page(-1)}
              flipInRTL
            />
            <IconButton
              icon={ChevronRight}
              accessibilityLabel={t(`calendar.next.${view}`)}
              onPress={() => page(1)}
              flipInRTL
            />
          </View>
        </View>

        {signupCallout}
        {gridMode ? statusBlock : null}

        {view === 'month' ? (
          <>
            <PeriodPager pageKey={pageKey} onPage={page} onPinch={pinch}>
              <Card padding="sm">
                <MonthGrid month={month} selected={selected} today={today} marks={marks} onSelect={select} />
              </Card>
            </PeriodPager>
            {statusBlock}
            {dayAgenda}
          </>
        ) : null}

        {view === 'agenda' ? (
          <>
            {statusBlock}
            <PeriodPager pageKey={pageKey} onPage={page}>
              {agendaList}
            </PeriodPager>
          </>
        ) : null}

        {gridMode ? (
          <>
            {view === 'day' ? (
              <Card padding="sm">
                <MonthGrid
                  month={month}
                  selected={selected}
                  today={today}
                  marks={marks}
                  compact
                  onSelect={select}
                  onSwipe={(delta) => select(addDays(selected, delta * 7))}
                />
              </Card>
            ) : null}
            <View ref={gridSlot} onLayout={measure} collapsable={false}>
              <PeriodPager pageKey={pageKey} onPage={page} onPinch={pinch}>
                <HourGrid
                  ref={grid}
                  days={periodDays}
                  items={allHidden ? [] : (visible ?? [])}
                  today={today}
                  now={now}
                  height={gridHeight}
                  bottomInset={bottomInset}
                  colorFor={colorFor}
                  contextFor={contextFor}
                  onPressItem={(item) => (canOpen(item) ? openItem(item) : undefined)}
                  onPressDay={(day) => {
                    select(day);
                    setView('day');
                  }}
                  onLongPressTime={(day, minutes) => addEvent(day, minutes)}
                  loading={loading && !allHidden}
                  refreshControl={gridFits ? refreshControl : undefined}
                />
              </PeriodPager>
            </View>
          </>
        ) : null}
      </Screen>

      {calendars.data && hidden ? (
        <CalendarFilterSheet
          visible={filtering}
          calendars={calendars.data}
          hidden={hidden}
          onToggle={toggle}
          onSetHidden={setHidden}
          onClose={() => setFiltering(false)}
        />
      ) : null}
      {menuSheet}
    </View>
  );
}
