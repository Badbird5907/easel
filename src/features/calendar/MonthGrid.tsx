import { useTranslation, formatNumber } from '@/i18n';
import { useMemo } from 'react';
import { PanResponder, Pressable, View } from 'react-native';

import { Text } from '@/design';
import { dateParts, useDisplayTimeZone, weekday } from '@/lib/dates';
import { cn } from '@/lib/cn';

import { dayKey, fullDay, monthWeeks, narrowWeekday, sameDay, weekDays } from './month';
import { pageDelta } from './display';

/** Dots shown under a day before they'd crowd the number. */
const MAX_DOTS = 3;

export type DayMarks = {
  /** Calendar colors of the day's items, already adjusted for the scheme. */
  colors: string[];
  count: number;
};

type Props = {
  month: Date;
  selected: Date;
  today: Date;
  marks: ReadonlyMap<string, DayMarks>;
  onSelect: (day: Date) => void;
  /** Swipe left or right for the next or previous month. Leave out when a pager handles swipes. */
  onSwipe?: (delta: 1 | -1) => void;
  /** Show only the selected week. */
  compact?: boolean;
};

/** Seven-column month (or week) of days with colored dots for what's on each day. */
export function MonthGrid({ month, selected, today, marks, onSelect, onSwipe, compact = false }: Props) {
  const { t, direction } = useTranslation();
  useDisplayTimeZone();
  const weeks = compact ? [weekDays(selected)] : monthWeeks(month);
  const header = weeks[0];

  // Horizontal swipes page between months; vertical ones stay with the scroll view.
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > 48) onSwipe?.(pageDelta(g.dx, direction));
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [onSwipe, direction],
  );

  return (
    <View {...(onSwipe ? swipe.panHandlers : {})} className="gap-1">
      <View className="flex-row" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {header.map((day) => (
          <Text key={weekday(day)} variant="caption" tone="muted" align="center" className="flex-1">
            {narrowWeekday.format(day)}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={dayKey(week[0])} className="flex-row">
          {week.map((day) => {
            const key = dayKey(day);
            const mark = marks.get(key);
            const isSelected = sameDay(day, selected);
            const isToday = sameDay(day, today);
            const outside = !compact && dateParts(day).month !== dateParts(month).month;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t(isToday ? 'calendar.todayCount' : 'calendar.dayCount', {
                  date: fullDay.format(day),
                  items: mark?.count
                    ? t('calendar.items', { count: mark.count })
                    : t('calendar.nothingScheduled'),
                })}
                onPress={() => onSelect(day)}
                className="min-h-[52px] flex-1 items-center gap-1 pt-1"
              >
                <View
                  className={cn(
                    'h-9 w-9 items-center justify-center rounded-full',
                    isSelected && 'bg-accent',
                    !isSelected && isToday && 'bg-accent-soft',
                  )}
                >
                  <Text
                    variant="callout"
                    weight={isSelected || isToday ? 'semibold' : 'regular'}
                    tone={isSelected ? 'onAccent' : isToday ? 'accent' : outside ? 'subtle' : 'default'}
                    tabular
                    maxFontSizeMultiplier={1.4}
                  >
                    {formatNumber(dateParts(day).day)}
                  </Text>
                </View>
                <View className="h-1.5 flex-row gap-[3px]">
                  {(mark?.colors ?? []).slice(0, MAX_DOTS).map((color, i) => (
                    <View
                      key={`${color}-${i}`}
                      className={cn('h-1.5 w-1.5 rounded-full', outside && 'opacity-40')}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
