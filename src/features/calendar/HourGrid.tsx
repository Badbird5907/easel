import { useTranslation, type Translate } from '@/i18n';
import {
  type ComponentRef,
  type ReactElement,
  type Ref,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import type { CalendarItem } from '@/canvas/api/calendar';
import { deriveAccent, Skeleton, Text, useTheme } from '@/design';
import { cn } from '@/lib/cn';
import { dateFormatter, formatTime, useDisplayTimeZone } from '@/lib/dates';

import { dayKey, fullDay, longWeekday, narrowWeekday, sameDay } from './month';
import { allDayItems, type GridBlock, layoutDay, minutesOf } from './timeGrid';
import { hourAxisFormatter } from './display';

export type HourGridHandle = {
  /** Scrolls so `minutes` past midnight sits a third of the way down. */
  scrollToMinutes: (minutes: number, animated?: boolean) => void;
};

type Props = {
  days: Date[];
  /** Everything visible in the period; the grid picks each day's share. */
  items: CalendarItem[];
  today: Date;
  now: Date;
  /** Height for the whole grid: day headers, the all-day row, and the scrolling hours. */
  height: number;
  /** Show placeholders while the period loads. */
  loading?: boolean;
  /** Space under the last hour, e.g. for a floating tab bar. */
  bottomInset?: number;
  /** The calendar's raw color: course color, group color, or null for personal. */
  colorFor: (item: CalendarItem) => string | null;
  /** Short name of the item's calendar: course code, group, or Personal. */
  contextFor: (item: CalendarItem) => string;
  onPressItem: (item: CalendarItem) => void;
  /** Opens one day, from the week's day headers and "more" in the all-day row. */
  onPressDay?: (day: Date) => void;
  /** A long press on an empty hour, to add an event there. */
  onLongPressTime?: (day: Date, minutes: number) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
  ref?: Ref<HourGridHandle>;
};

const BASE_HOUR_HEIGHT = 48;
/** Space above midnight so its label isn't cut off. */
const TOP_PAD = 8;
/** Where loading placeholders sit, in minutes from midnight. */
const placeholders = [
  [9 * 60, 10 * 60],
  [11 * 60 + 30, 12 * 60 + 30],
  [14 * 60, 15 * 60 + 30],
  [18 * 60, 19 * 60],
] as const;
/** All-day chips shown per day in the week before "more". */
const WEEK_ALL_DAY = 2;

const dayNumber = dateFormatter({ day: 'numeric' });

const kindName = {
  assignment: 'calendar.kind.assignment',
  quiz: 'calendar.kind.quiz',
  discussion: 'calendar.kind.discussion',
  page: 'calendar.kind.page',
  note: 'calendar.kind.note',
  event: 'calendar.kind.event',
  peer_review: 'calendar.kind.peer_review',
  announcement: 'calendar.kind.announcement',
} as const;

/** "2:00 PM to 3:30 PM", "due 11:59 PM", or "all day". */
export function spokenTime(item: CalendarItem, t: Translate): string {
  if (item.allDay) return t('calendar.allDay');
  const start = formatTime(item.start);
  if (item.end && item.end.getTime() > item.start.getTime())
    return t('calendar.timeSpan', { start, end: formatTime(item.end) });
  if (item.kind === 'event' || item.kind === 'note') return start;
  return t('calendar.dueTime', { time: start });
}

/** Block colors for a calendar color: a soft fill with a strong edge. Personal items stay neutral. */
function useBlockColors() {
  const { scheme, colors } = useTheme();
  return useCallback(
    (raw: string | null) => {
      if (!raw) return { fill: colors.surfaceSunken, edge: colors.fgMuted };
      const accent = deriveAccent(raw, scheme);
      return { fill: accent.accentSoft, edge: accent.accent };
    },
    [scheme, colors.surfaceSunken, colors.fgMuted],
  );
}

/**
 * Week and day views (CAL-2): an hour grid with an all-day row, items
 * side by side where they overlap, and a line at the current time. Items
 * read their time, title, and calendar to screen readers.
 */
export function HourGrid({
  days,
  items,
  today,
  now,
  height,
  bottomInset = 0,
  colorFor,
  contextFor,
  onPressItem,
  onPressDay,
  onLongPressTime,
  loading = false,
  refreshControl,
  ref,
}: Props) {
  const { t, locale } = useTranslation();
  const hourLabel = useMemo(() => hourAxisFormatter(locale), [locale]);
  useDisplayTimeZone();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [columnsWidth, setColumnsWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const blockColors = useBlockColors();
  const week = days.length > 1;
  const scale = Math.min(Math.max(fontScale, 1), 1.6);
  const hourHeight = Math.round(BASE_HOUR_HEIGHT * scale);
  const labels = useMemo(() => Array.from({ length: 24 }, (_, hour) =>
    hourLabel.format(new Date(Date.UTC(2026, 0, 1, hour)))), [hourLabel]);
  const measureKey = `${locale}:${fontScale}`;
  const [labelWidth, setLabelWidth] = useState({ key: '', width: 0 });
  const gutter = Math.ceil(Math.max(44, labelWidth.key === measureKey
    ? labelWidth.width + 10 : Math.max(...labels.map((label) => label.length)) * 8 * Math.min(scale, 1.35) + 10));
  const labelHeight = 20 * Math.min(scale, 1.35);
  const minuteHeight = hourHeight / 60;

  const scrollHeight = Math.max(240, height - headerHeight);
  const columnWidth = columnsWidth / days.length;

  useImperativeHandle(ref, () => ({
    scrollToMinutes: (minutes, animated = true) => {
      const y = Math.max(0, TOP_PAD + minutes * minuteHeight - scrollHeight / 3);
      // After layout, so a grid that just appeared scrolls too.
      requestAnimationFrame(() => scroll.current?.scrollTo({ y, animated }));
    },
  }));

  const allDay = days.map((day) => allDayItems(items, day));
  const hasAllDay = allDay.some((list) => list.length > 0);
  const layouts = days.map((day) => layoutDay(items, day));
  const nowMinutes = minutesOf(now);
  const todayIndex = days.findIndex((d) => sameDay(d, today));

  const label = (item: CalendarItem, day: Date) =>
    [
      week ? longWeekday.format(day) : null,
      spokenTime(item, t),
      item.title,
      contextFor(item),
      t(kindName[item.kind]),
      item.appointment ? t('calendar.appointment') : null,
      item.done ? t('common.done') : null,
    ]
      .filter(Boolean)
      .join(', ');

  const renderBlock = (block: GridBlock, day: Date) => {
    const { item } = block;
    const color = blockColors(colorFor(item));
    const top = TOP_PAD + block.top * minuteHeight;
    const blockHeight = Math.max(18, (block.bottom - block.top) * minuteHeight - 2);
    // Narrow side-by-side blocks would break titles letter by letter: one line, or just color.
    const width = (columnWidth * block.span) / block.columns - 2;
    const lines = width < 44 ? 1 : Math.max(1, Math.floor((blockHeight - 6) / (week ? 14 : 17)));
    const showTitle = columnWidth === 0 || width >= 26;
    const showMeta = !week && blockHeight >= 36 && width >= 120;
    return (
      <Pressable
        key={`${item.id}:${dayKey(day)}`}
        accessibilityRole="button"
        accessibilityLabel={label(item, day)}
        accessibilityHint={t('planner.openHint')}
        onPress={() => onPressItem(item)}
        className="absolute overflow-hidden rounded-md active:opacity-70"
        style={{
          top,
          height: blockHeight,
          start: `${(block.column / block.columns) * 100}%`,
          width: `${(block.span / block.columns) * 100}%`,
          paddingEnd: 2,
        }}
      >
        <View
          className={cn(
            'flex-1 rounded-md px-1 py-0.5',
            block.continuesBefore && 'rounded-t-none',
            block.continuesAfter && 'rounded-b-none',
            item.done && 'opacity-60',
          )}
          style={{ backgroundColor: color.fill, borderStartWidth: 3, borderStartColor: color.edge }}
        >
          {showTitle ? (
            <Text
              variant={week ? 'caption' : 'footnote'}
              weight="semibold"
              numberOfLines={showMeta ? Math.max(1, lines - 1) : lines}
              maxFontSizeMultiplier={week ? 1.2 : 1.5}
              className={cn(item.done && 'line-through', week && 'text-[11px] leading-[14px]')}
            >
              {item.title}
            </Text>
          ) : null}
          {showMeta ? (
            <Text variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.5}>
              {[spokenTime(item, t), contextFor(item), item.location].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const contentHeight = TOP_PAD + 24 * hourHeight + 12 + bottomInset;

  return (
    <View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', opacity: 0 }}>
        {labels.map((label, index) => (
          <Text key={`${measureKey}:${index}`} variant="caption" tabular maxFontSizeMultiplier={1.35}
            style={{ alignSelf: 'flex-start' }} onTextLayout={(event) => {
              const width = Math.max(...event.nativeEvent.lines.map((line) => line.width));
              if (!Number.isFinite(width)) return;
              setLabelWidth((previous) => ({ key: measureKey,
                width: Math.max(previous.key === measureKey ? previous.width : 0, width) }));
            }}>{label}</Text>
        ))}
      </View>
      <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        {week ? (
          <View className="flex-row border-b-hairline border-border pb-1" style={{ paddingStart: gutter }}>
            {days.map((day, i) => {
              const isToday = sameDay(day, today);
              const count = layouts[i].length + allDay[i].length;
              return (
                <Pressable
                  key={dayKey(day)}
                  accessibilityRole="button"
                  accessibilityLabel={t(isToday ? 'calendar.todayCount' : 'calendar.dayCount', {
                    date: fullDay.format(day),
                    items: count ? t('calendar.items', { count }) : t('calendar.nothingScheduled'),
                  })}
                  accessibilityHint={t('calendar.openDayHint')}
                  onPress={onPressDay ? () => onPressDay(day) : undefined}
                  className="min-h-11 flex-1 items-center justify-center gap-0.5 active:opacity-60"
                >
                  <Text variant="caption" tone={isToday ? 'accent' : 'muted'} maxFontSizeMultiplier={1.3}>
                    {narrowWeekday.format(day)}
                  </Text>
                  <View
                    className={cn('h-7 w-7 items-center justify-center rounded-full', isToday && 'bg-accent')}
                  >
                    <Text
                      variant="subhead"
                      weight={isToday ? 'semibold' : 'medium'}
                      tone={isToday ? 'onAccent' : 'default'}
                      tabular
                      maxFontSizeMultiplier={1.3}
                    >
                      {dayNumber.format(day)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {hasAllDay ? (
          <View className="flex-row border-b-hairline border-border py-1">
            <View
              style={{ width: gutter }}
              className="justify-center"
              importantForAccessibility="no"
              accessibilityElementsHidden
            >
              <Text variant="caption" tone="muted" maxFontSizeMultiplier={1.3} numberOfLines={2}>
                {t('calendar.allDay')}
              </Text>
            </View>
            {days.map((day, i) => {
              const list = allDay[i];
              const shown = week
                ? list.slice(0, list.length > WEEK_ALL_DAY ? WEEK_ALL_DAY - 1 : WEEK_ALL_DAY)
                : list;
              const hidden = list.length - shown.length;
              return (
                <View key={dayKey(day)} className="flex-1 gap-0.5" style={{ paddingEnd: 2 }}>
                  {shown.map((item) => {
                    const color = blockColors(colorFor(item));
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={label(item, day)}
                        accessibilityHint={t('planner.openHint')}
                        onPress={() => onPressItem(item)}
                        className="min-h-6 justify-center rounded-md px-1 active:opacity-70"
                        style={{
                          backgroundColor: color.fill,
                          borderStartWidth: 3,
                          borderStartColor: color.edge,
                        }}
                      >
                        <Text
                          variant="caption"
                          weight="semibold"
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          className={cn(week && 'text-[11px]')}
                        >
                          {item.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {hidden > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('calendar.moreAllDay', {
                        count: hidden,
                        date: fullDay.format(day),
                      })}
                      onPress={onPressDay ? () => onPressDay(day) : undefined}
                      className="min-h-6 justify-center rounded-md bg-surface-sunken px-1 active:opacity-70"
                    >
                      <Text
                        variant="caption"
                        tone="muted"
                        weight="semibold"
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('calendar.moreCount', { count: hidden })}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <ScrollView
        ref={scroll}
        style={{ height: scrollHeight }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        refreshControl={refreshControl}
        contentContainerStyle={{ height: contentHeight }}
      >
        {/* Hour lines and labels. */}
        <View
          style={StyleSheet.absoluteFill}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {Array.from({ length: 25 }, (_, hour) => (
            <View
              key={hour}
              className="absolute end-0 flex-row items-center"
              style={{ top: TOP_PAD + hour * hourHeight - labelHeight / 2, start: 0, height: labelHeight }}
            >
              <Text
                variant="caption"
                tone="subtle"
                align="right"
                tabular
                maxFontSizeMultiplier={1.35}
                numberOfLines={1}
                style={{ width: gutter - 6 }}
              >
                {hour === 24 ? '' : labels[hour]}
              </Text>
              <View className="ms-1.5 h-hairline flex-1 bg-border" />
            </View>
          ))}
        </View>

        {/* One column per day. */}
        <View
          className="absolute bottom-0 end-0 top-0 flex-row"
          style={{ start: gutter }}
          onLayout={(e) => setColumnsWidth(e.nativeEvent.layout.width)}
        >
          {days.map((day, i) => (
            <Pressable
              key={dayKey(day)}
              accessible={false}
              onLongPress={
                onLongPressTime
                  ? (e) => {
                      const minutes = (e.nativeEvent.locationY - TOP_PAD) / minuteHeight;
                      onLongPressTime(
                        day,
                        Math.max(0, Math.min(23 * 60 + 30, Math.floor(minutes / 30) * 30)),
                      );
                    }
                  : undefined
              }
              className={cn('flex-1', week && i > 0 && 'border-s-hairline border-border')}
            >
              {loading
                ? placeholders.map(([from, to]) => (
                    <View
                      key={from}
                      className="absolute inset-x-0 pe-0.5"
                      style={{ top: TOP_PAD + from * minuteHeight, height: (to - from) * minuteHeight - 2 }}
                    >
                      <Skeleton className="flex-1 rounded-md" />
                    </View>
                  ))
                : layouts[i].map((block) => renderBlock(block, day))}
              {i === todayIndex ? (
                <View
                  pointerEvents="none"
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  className="absolute end-0 flex-row items-center"
                  style={{ top: TOP_PAD + nowMinutes * minuteHeight - 4, height: 8, start: week ? 0 : -4 }}
                >
                  <View className="h-2 w-2 rounded-full bg-danger" />
                  <View className="h-0.5 flex-1 bg-danger" />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
