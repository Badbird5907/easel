import type { CalendarItem } from '@/canvas/api/calendar';

import { dateParts, dayBoundary } from '@/lib/dates';

import { dayKey, startOfDay } from './month';

/**
 * Layout for the week and day hour grids (CAL-2): where each timed item sits
 * in its day's column, with overlapping items side by side.
 */

const DAY_MINUTES = 24 * 60;

/** Items without a length (due dates, to-dos) still get a block this tall. */
export const POINT_MINUTES = 30;

export type GridBlock = {
  item: CalendarItem;
  /** Minutes from midnight, clipped to the day. */
  top: number;
  bottom: number;
  /** Column within its overlap cluster, and how many columns the cluster has. */
  column: number;
  columns: number;
  /** How many columns it can stretch across before the next busy one. */
  span: number;
  /** It started the day before or carries on into the next. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** The part of an item that falls on `day`, in minutes from midnight, or null. */
function segment(
  item: CalendarItem,
  day: Date,
  minMinutes: number,
): Omit<GridBlock, 'column' | 'columns' | 'span'> | null {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayBoundary(day, 1).getTime();
  const start = item.start.getTime();
  const hasLength = !!item.end && item.end.getTime() > start;
  const end = hasLength ? item.end!.getTime() : start;
  if (hasLength ? end <= dayStart || start >= dayEnd : start < dayStart || start >= dayEnd) return null;

  // Wall-clock minutes, not elapsed ones: days when the clocks change are 23 or 25 hours long.
  let top = start <= dayStart ? 0 : minutesOf(item.start);
  let bottom = end >= dayEnd ? DAY_MINUTES : hasLength ? minutesOf(item.end!) : top;
  if (bottom - top < minMinutes) {
    bottom = Math.min(DAY_MINUTES, top + minMinutes);
    // Something due at 11:59 PM still fits inside the day.
    top = Math.max(0, bottom - minMinutes);
  }
  return {
    item,
    top,
    bottom,
    continuesBefore: start < dayStart,
    continuesAfter: end > dayEnd,
  };
}

/**
 * Lays out one day's timed items. Items that overlap form a cluster; each takes
 * the first free column, and the cluster shares the width between its columns.
 * An item stretches right over columns that are free for its whole time.
 */
export function layoutDay(items: CalendarItem[], day: Date, minMinutes = POINT_MINUTES): GridBlock[] {
  const segments = items
    .filter((item) => !item.allDay)
    .map((item) => segment(item, day, minMinutes))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.item.title.localeCompare(b.item.title));

  const blocks: GridBlock[] = [];
  let cluster: GridBlock[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    const columns = columnEnds.length;
    for (const block of cluster) {
      block.columns = columns;
      let span = 1;
      for (let c = block.column + 1; c < columns; c++) {
        const busy = cluster.some(
          (other) => other.column === c && other.top < block.bottom && other.bottom > block.top,
        );
        if (busy) break;
        span++;
      }
      block.span = span;
      blocks.push(block);
    }
    cluster = [];
    columnEnds = [];
  };

  for (const s of segments) {
    if (s.top >= clusterEnd && cluster.length) closeCluster();
    let column = columnEnds.findIndex((end) => end <= s.top);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(s.bottom);
    } else {
      columnEnds[column] = s.bottom;
    }
    cluster.push({ ...s, column, columns: 1, span: 1 });
    clusterEnd = cluster.length === 1 ? s.bottom : Math.max(clusterEnd, s.bottom);
  }
  if (cluster.length) closeCluster();
  return blocks;
}

/** All-day items on a day. Canvas all-day events sit on one calendar date. */
export function allDayItems(items: CalendarItem[], day: Date): CalendarItem[] {
  const dayStart = startOfDay(day).getTime();
  return items.filter(
    (item) =>
      item.allDay &&
      (item.allDayDate ? item.allDayDate === dayKey(day) : startOfDay(item.start).getTime() === dayStart),
  );
}

/** Minutes from midnight for a time. */
export function minutesOf(date: Date): number {
  const p = dateParts(date);
  return p.hour * 60 + p.minute + p.second / 60;
}
