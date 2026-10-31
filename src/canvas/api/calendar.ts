import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { allDayDateKey, eventBody, projectAllDay } from '@/features/calendar/eventDates';
import { fromDayKey, useDisplayTimeZone } from '@/lib/dates';

import { courseColors } from '@/design/tokens/colors';

import type { CanvasClient } from '../client';
import { isDone, type WorkItemKind } from '../models';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { useCanvas } from '../session';
import type { CanvasPlannerItem } from '../types';
import { useDashboardCourses } from './courses';
import { type PlannerRange, toWorkItem } from './planner';

/** Canvas reads at most 10 `context_codes` per calendar request and ignores the rest. */
export const CONTEXT_CODE_LIMIT = 10;

/** `GET /api/v1/calendar_events?type=event` (lib/api/v1/calendar_event.rb#calendar_event_json) */
export type CanvasCalendarEvent = {
  id: string;
  title: string;
  type: 'event';
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  all_day_date?: string | null;
  description?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  context_code: string;
  effective_context_code?: string | null;
  context_name?: string | null;
  context_color?: string | null;
  workflow_state?: string;
  hidden?: boolean;
  html_url: string;
  url?: string;
  appointment_group_id?: string | null;
  reserved?: boolean;
  own_reservation?: boolean;
  series_uuid?: string | null;
  rrule?: string | null;
  /** True on the first event of a recurring series. */
  series_head?: boolean;
  /** "Weekly on Tue, 10 times", with `include[]=series_natural_language`. */
  series_natural_language?: string | null;
  /** A reservation's time slot. */
  parent_event_id?: string | null;
  /** What the student wrote when reserving. */
  comments?: string | null;
  updated_at?: string;
};

/** `GET /api/v1/calendar_events?type=assignment` (lib/api/v1/calendar_event.rb#assignment_event_json) */
export type CanvasAssignmentEvent = {
  /** `assignment_<id>` */
  id: string;
  title: string;
  type: 'assignment';
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  html_url: string;
  context_code: string;
  context_name?: string | null;
  submission_types?: string | string[];
  workflow_state?: string;
};

/** `GET /api/v1/users/self/groups` (lib/api/v1/group.rb) */
export type CanvasGroup = {
  id: string;
  name: string;
  course_id?: string | null;
  context_type?: string;
  concluded?: boolean;
};

/** Planner items as the calendar reads them: notes and personal events carry a user ID. */
type CalendarPlannerItem = CanvasPlannerItem & {
  user_id?: string;
  plannable: CanvasPlannerItem['plannable'] & { location_name?: string | null; all_day_date?: string | null };
};

/** One calendar the student can show or hide: their own, a course, or a group. */
export type CalendarSource = {
  /** Canvas context code: `user_1`, `course_42`, `group_7`. */
  code: string;
  type: 'user' | 'course' | 'group';
  name: string;
  /** Course code for courses; the name otherwise. */
  shortName: string;
  /** Course color, or null for personal and group calendars. */
  color: string | null;
};

export type CalendarItem = {
  /** Unique across sources: `event:12`, `assignment:9`, `planner_note:4`. */
  id: string;
  kind: WorkItemKind;
  title: string;
  /** Which calendar it belongs to, for filtering and color. */
  contextCode: string;
  courseId: string | null;
  contextName: string | null;
  start: Date;
  end: Date | null;
  allDay: boolean;
  /** Canvas civil YYYY-MM-DD, retained across zone changes. */
  allDayDate?: string | null;
  location: string | null;
  htmlUrl: string | null;
  /** Calendar event ID, for the event screen. */
  eventId: string | null;
  /** Planner note ID, for the to-do editor. */
  noteId: string | null;
  /** A reserved appointment slot (scheduler). */
  appointment: boolean;
  done: boolean;
  points: number | null;
};

/** Full event details for the event screen. */
export type CalendarEventDetail = {
  id: string;
  title: string;
  contextCode: string;
  contextName: string | null;
  courseId: string | null;
  color: string | null;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  /** Canvas civil YYYY-MM-DD, retained across zone changes. */
  allDayDate?: string | null;
  location: string | null;
  address: string | null;
  html: string;
  htmlUrl: string;
  appointment: boolean;
  /** Personal events are the only ones a student can change. */
  editable: boolean;
  recurring: boolean;
  /** The series' recurrence rule (RRULE), when it has one. */
  rrule: string | null;
  /** The first event of its series: only it can move the whole series to another day. */
  seriesHead: boolean;
  /** Canvas's own wording for the series, e.g. "Weekly on Tue, 10 times". */
  seriesText: string | null;
  /** The student's own reservation of a time slot (CAL-6). */
  reservation: {
    /** Appointment group, for "See other times". */
    groupId: string;
    comments: string | null;
    /** Canvas refuses changes to reservations that have ended. */
    canCancel: boolean;
  } | null;
};

export const calendarKeys = {
  all: ['calendar'] as const,
  groups: ['calendar', 'groups'] as const,
  events: (range: PlannerRange, codes: string[]) =>
    ['calendar', 'events', dayKey(range.start), dayKey(range.end), ...codes] as const,
  event: (id: string) => ['calendar', 'event', id] as const,
  /** Under `planner` so marking done refreshes it too. */
  planner: (range: PlannerRange) => ['planner', 'calendar', dayKey(range.start), dayKey(range.end)] as const,
};

function dayKey(date: Date) {
  return date.toISOString();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const courseIdOf = (code: string) => (code.startsWith('course_') ? code.slice('course_'.length) : null);

// ---------------------------------------------------------------------------
// Calendars (filter sources)

export async function fetchGroups(client: CanvasClient, signal?: AbortSignal): Promise<CanvasGroup[]> {
  try {
    const groups = await client.getAll<CanvasGroup>('/api/v1/users/self/groups', undefined, {
      signal,
      maxPages: 5,
    });
    return groups.filter((g) => !g.concluded);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    // Some schools turn groups off; the calendar still works without them.
    return [];
  }
}

/** Personal, then each dashboard course, then groups. */
export function useCalendars() {
  const { account } = useCanvas();
  const courses = useDashboardCourses();
  const groups = useCanvasQuery(calendarKeys.groups, fetchGroups);

  const personal: CalendarSource = {
    code: `user_${account.user.id}`,
    type: 'user',
    name: 'Personal',
    shortName: 'Personal',
    color: null,
  };
  const data: CalendarSource[] | undefined = courses.data
    ? [
        personal,
        ...courses.data.map((c) => ({
          code: `course_${c.id}`,
          type: 'course' as const,
          name: c.name,
          shortName: c.code,
          color: c.color,
        })),
        ...(groups.data ?? []).map((g) => ({
          code: `group_${g.id}`,
          type: 'group' as const,
          name: g.name,
          shortName: g.name,
          color: null,
        })),
      ]
    : undefined;

  return {
    data,
    isPending: courses.isPending,
    isError: courses.isError,
    error: courses.error,
    refetch: () => Promise.all([courses.refetch(), groups.refetch()]),
  };
}

/** Group calendars take the neutral palette color so they read as "not a course". */
export const groupColor = courseColors[courseColors.length - 1].light;

// ---------------------------------------------------------------------------
// Items

type PlannerPart = { items: CalendarItem[]; assignmentIds: string[] };

function plannerContextCode(item: CalendarPlannerItem, userId: string): string {
  if (item.course_id) return `course_${item.course_id}`;
  if (item.group_id) return `group_${item.group_id}`;
  if (item.plannable.course_id) return `course_${item.plannable.course_id}`;
  return `user_${item.user_id ?? userId}`;
}

/**
 * The planner feed for the range: assignments, quizzes, discussions, pages,
 * peer reviews, checkpoints, and planner notes, with done state.
 */
export async function fetchPlannerPart(
  client: CanvasClient,
  range: PlannerRange,
  userId: string,
  signal?: AbortSignal,
): Promise<PlannerPart> {
  const raw = await client.getAll<CalendarPlannerItem>(
    '/api/v1/planner/items',
    { start_date: range.start.toISOString(), end_date: range.end.toISOString() },
    { signal },
  );
  const assignmentIds: string[] = [];
  const items: CalendarItem[] = [];
  for (const entry of raw) {
    if (entry.plannable_type === 'announcement') continue;
    const work = toWorkItem(entry);
    if (entry.plannable_type === 'assignment') assignmentIds.push(String(entry.plannable_id));
    else if (entry.plannable.assignment_id) assignmentIds.push(String(entry.plannable.assignment_id));
    const event = entry.plannable_type === 'calendar_event';
    const allDay = event && !!entry.plannable.all_day;
    items.push({
      id: event ? `event:${entry.plannable_id}` : work.id,
      kind: work.kind,
      title: work.title,
      contextCode: plannerContextCode(entry, userId),
      courseId: work.courseId,
      contextName: work.contextName,
      start: event && entry.plannable.start_at ? new Date(entry.plannable.start_at) : work.dueAt,
      end: event && entry.plannable.end_at ? new Date(entry.plannable.end_at) : null,
      allDay,
      allDayDate: allDay ? allDayDateKey(entry.plannable.all_day_date, work.dueAt) : null,
      location: entry.plannable.location_name ?? null,
      htmlUrl: work.htmlUrl,
      eventId: event ? work.plannableId : null,
      noteId: work.kind === 'note' ? work.plannableId : null,
      appointment: false,
      done: isDone(work),
      points: work.points,
    });
  }
  return { items, assignmentIds };
}

function assignmentKind(event: CanvasAssignmentEvent): WorkItemKind {
  const types = Array.isArray(event.submission_types)
    ? event.submission_types.join(',')
    : (event.submission_types ?? '');
  if (types.includes('online_quiz')) return 'quiz';
  if (types.includes('discussion_topic')) return 'discussion';
  return 'assignment';
}

/**
 * Calendar events and assignment dates for the given calendars. Canvas reads
 * only 10 context codes per request, so codes go out in batches.
 */
export async function fetchCalendarEvents(
  client: CanvasClient,
  range: PlannerRange,
  codes: string[],
  signal?: AbortSignal,
): Promise<{ events: CalendarItem[]; assignments: (CalendarItem & { assignmentId: string })[] }> {
  const window = { start_date: range.start.toISOString(), end_date: range.end.toISOString() };
  const courseCodes = codes.filter((c) => c.startsWith('course_'));
  const [eventPages, assignmentPages] = await Promise.all([
    Promise.all(
      chunk(codes, CONTEXT_CODE_LIMIT).map((batch) =>
        client.getAll<CanvasCalendarEvent>(
          '/api/v1/calendar_events',
          { type: 'event', context_codes: batch, excludes: ['description', 'child_events'], ...window },
          { signal },
        ),
      ),
    ),
    Promise.all(
      chunk(courseCodes, CONTEXT_CODE_LIMIT).map((batch) =>
        client.getAll<CanvasAssignmentEvent>(
          '/api/v1/calendar_events',
          { type: 'assignment', context_codes: batch, excludes: ['description', 'assignment'], ...window },
          { signal },
        ),
      ),
    ),
  ]);

  const events = eventPages
    .flat()
    .filter((e) => !e.hidden && e.workflow_state !== 'deleted' && e.start_at)
    .map((e): CalendarItem => {
      const code = e.effective_context_code?.split(',')[0] || e.context_code;
      return {
        id: `event:${e.id}`,
        kind: 'event',
        title: e.title,
        contextCode: code,
        courseId: courseIdOf(code),
        contextName: e.context_name ?? null,
        start: new Date(e.start_at!),
        allDayDate: e.all_day ? allDayDateKey(e.all_day_date, new Date(e.start_at!)) : null,
        end: e.all_day || !e.end_at ? null : new Date(e.end_at),
        allDay: e.all_day,
        location: e.location_name || null,
        htmlUrl: e.html_url,
        eventId: String(e.id),
        noteId: null,
        appointment: !!e.appointment_group_id,
        done: false,
        points: null,
      };
    });

  const assignments = assignmentPages
    .flat()
    .filter((a) => a.start_at)
    .map((a) => {
      const assignmentId = String(a.id).replace(/^assignment_/, '');
      return {
        id: `assignment:${assignmentId}`,
        assignmentId,
        kind: assignmentKind(a),
        title: a.title,
        contextCode: a.context_code,
        courseId: courseIdOf(a.context_code),
        contextName: a.context_name ?? null,
        start: new Date(a.start_at!),
        end: null,
        allDay: false,
        location: null,
        htmlUrl: a.html_url,
        eventId: null,
        noteId: null,
        appointment: false,
        done: false,
        points: null,
      };
    });

  return { events, assignments };
}

/**
 * Everything on the calendar for a range: planner items plus calendar events
 * and assignment dates, de-duplicated. Each source loads on its own, so one
 * failing still shows the rest.
 */
export function useCalendarItems(range: PlannerRange, codes: string[] | undefined) {
  useDisplayTimeZone();
  const { account } = useCanvas();
  const planner = useCanvasQuery(calendarKeys.planner(range), (client, signal) =>
    fetchPlannerPart(client, range, account.user.id, signal),
  );
  const events = useCanvasQuery(
    calendarKeys.events(range, codes ?? []),
    (client, signal) => fetchCalendarEvents(client, range, codes ?? [], signal),
    { enabled: codes !== undefined && codes.length > 0 },
  );

  let data: CalendarItem[] | undefined;
  if (planner.data || events.data) {
    const seen = new Set<string>();
    const assignmentIds = new Set(planner.data?.assignmentIds ?? []);
    data = [];
    // Calendar events first: they carry location and end times the planner copy lacks.
    for (const item of events.data?.events ?? []) {
      if (!seen.has(item.id)) data.push(item);
      seen.add(item.id);
    }
    for (const item of planner.data?.items ?? []) {
      if (!seen.has(item.id)) data.push(item);
      seen.add(item.id);
    }
    for (const { assignmentId, ...item } of events.data?.assignments ?? []) {
      if (assignmentIds.has(assignmentId) || seen.has(item.id)) continue;
      data.push(item);
      seen.add(item.id);
    }
  }

  // Nothing to show only once the planner failed and the events can't fill in.
  const isError = !data && planner.isError && (events.isError || !events.isFetching);
  return {
    data: data?.map((item) => projectAllDay(item)),
    isPending: !data && !isError,
    isError,
    /** One source failed; the calendar may be missing items. */
    isPartial: !!data && (planner.isError || events.isError),
    error: planner.error ?? events.error,
    refetch: () => Promise.all([planner.refetch(), codes?.length ? events.refetch() : null]),
  };
}

/**
 * Loads a range ahead of time, e.g. the months either side of the one on
 * screen, so paging and swiping between periods doesn't wait on Canvas.
 */
export function usePrefetchCalendar() {
  const queryClient = useQueryClient();
  const { account, client } = useCanvas();
  return useCallback(
    (range: PlannerRange, codes: string[] | undefined) => {
      void queryClient.prefetchQuery({
        queryKey: [account.id, ...calendarKeys.planner(range)],
        queryFn: ({ signal }) => fetchPlannerPart(client, range, account.user.id, signal),
      });
      if (codes?.length) {
        void queryClient.prefetchQuery({
          queryKey: [account.id, ...calendarKeys.events(range, codes)],
          queryFn: ({ signal }) => fetchCalendarEvents(client, range, codes, signal),
        });
      }
    },
    [queryClient, account.id, account.user.id, client],
  );
}

// ---------------------------------------------------------------------------
// Event details and personal events (CAL-5)

function toEventDetail(e: CanvasCalendarEvent, userId: string): CalendarEventDetail {
  const code = e.effective_context_code?.split(',')[0] || e.context_code;
  return {
    id: String(e.id),
    title: e.title,
    contextCode: code,
    contextName: e.context_name ?? null,
    courseId: courseIdOf(code),
    color: e.context_color ?? null,
    start: e.start_at ? new Date(e.start_at) : e.all_day_date ? fromDayKey(e.all_day_date) : null,
    allDayDate: e.all_day ? allDayDateKey(e.all_day_date, new Date(e.start_at ?? Date.now())) : null,
    end: e.all_day || !e.end_at ? null : new Date(e.end_at),
    allDay: e.all_day,
    location: e.location_name || null,
    address: e.location_address || null,
    html: e.description ?? '',
    htmlUrl: e.html_url,
    appointment: !!e.appointment_group_id,
    editable: e.context_code === `user_${userId}` && !e.appointment_group_id,
    recurring: !!e.rrule || !!e.series_uuid,
    rrule: e.rrule || null,
    seriesHead: !!e.series_head,
    seriesText: e.series_natural_language || null,
    reservation:
      e.appointment_group_id && e.parent_event_id && e.context_code === `user_${userId}`
        ? {
            groupId: String(e.appointment_group_id),
            comments: e.comments || null,
            canCancel: !e.end_at || new Date(e.end_at).getTime() > Date.now(),
          }
        : null,
  };
}

export async function fetchCalendarEvent(
  client: CanvasClient,
  id: string,
  userId: string,
  signal?: AbortSignal,
): Promise<CalendarEventDetail> {
  const event = await client.get<CanvasCalendarEvent>(
    `/api/v1/calendar_events/${id}`,
    { include: ['series_natural_language'] },
    signal,
  );
  return toEventDetail(event, userId);
}

export function useCalendarEvent(id: string) {
  const zone = useDisplayTimeZone();
  const { account } = useCanvas();
  const select = useCallback((data: CalendarEventDetail) => projectAllDay(data, zone), [zone]);
  return useCanvasQuery(
    calendarKeys.event(id),
    (client, signal) => fetchCalendarEvent(client, id, account.user.id, signal),
    { select },
  );
}

export type PersonalEventInput = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Canvas civil YYYY-MM-DD, retained across zone changes. */
  allDayDate?: string | null;
  location: string;
  /** HTML from the rich editor. Undefined leaves the current description alone. */
  details?: string;
  /**
   * How the event repeats, as an iCalendar RRULE (`FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=10`).
   * Null stops it repeating; undefined leaves the schedule alone.
   */
  rrule?: string | null;
};

/** Which events of a series a change applies to (`which`, calendar_events_api_controller.rb). */
export type SeriesScope = 'one' | 'all' | 'following';

function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  // A deleted event's own query is left alone, so its closing screen doesn't refetch a 404.
  return (removedId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: [accountKey, ...calendarKeys.all],
        predicate: (query) => !removedId || query.queryKey[2] !== 'event' || query.queryKey[3] !== removedId,
      }),
      queryClient.invalidateQueries({ queryKey: [accountKey, 'planner'] }),
    ]);
}

export function useCreatePersonalEvent() {
  const { account } = useCanvas();
  const invalidate = useInvalidateCalendar();
  return useCanvasMutation(
    async (client, input: PersonalEventInput) =>
      toEventDetail(
        await client.post<CanvasCalendarEvent>(
          '/api/v1/calendar_events',
          eventBody(input, `user_${account.user.id}`),
        ),
        account.user.id,
      ),
    { onSuccess: () => invalidate() },
  );
}

/**
 * Canvas answers a series change with every event it touched, and a single
 * change with the event. Either way, the event that was edited comes back.
 */
function editedEvent(
  response: CanvasCalendarEvent | CanvasCalendarEvent[],
  id: string,
): CanvasCalendarEvent | undefined {
  if (!Array.isArray(response)) return response;
  return response.find((e) => String(e.id) === id) ?? response[0];
}

export function useUpdatePersonalEvent(id: string) {
  const { account } = useCanvas();
  const invalidate = useInvalidateCalendar();
  return useCanvasMutation(
    async (client, { input, scope }: { input: PersonalEventInput; scope?: SeriesScope }) => {
      const response = await client.put<CanvasCalendarEvent | CanvasCalendarEvent[]>(
        `/api/v1/calendar_events/${id}`,
        eventBody(input, undefined, scope),
      );
      const event = editedEvent(response, id);
      return event ? toEventDetail(event, account.user.id) : null;
    },
    { onSuccess: () => invalidate() },
  );
}

export function useDeletePersonalEvent(id: string) {
  const invalidate = useInvalidateCalendar();
  return useCanvasMutation(
    (client, scope: SeriesScope | void) =>
      client.delete<unknown>(`/api/v1/calendar_events/${id}`, scope ? { which: scope } : undefined),
    { onSuccess: () => invalidate(id) },
  );
}

/** Cancels the student's reservation of a time slot (CAL-6): Canvas deletes the reservation event. */
export function useCancelReservation(id: string) {
  const invalidate = useInvalidateCalendar();
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation((client, _: void) => client.delete<unknown>(`/api/v1/calendar_events/${id}`), {
    onSuccess: () =>
      Promise.all([
        invalidate(id),
        queryClient.invalidateQueries({ queryKey: [accountKey, 'appointments'] }),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Calendar feed (CAL-7, SET-8)

/** `GET /api/v1/users/self/profile` (lib/api/v1/user_profile.rb): `calendar.ics` is the student's private feed. */
type CanvasProfileCalendar = { calendar?: { ics?: string | null } | null };

export async function fetchCalendarFeedUrl(
  client: CanvasClient,
  signal?: AbortSignal,
): Promise<string | null> {
  const profile = await client.get<CanvasProfileCalendar>('/api/v1/users/self/profile', undefined, signal);
  return profile.calendar?.ics || null;
}

/** The student's iCalendar feed URL, or null when the school doesn't offer one. */
export function useCalendarFeedUrl() {
  return useCanvasQuery(['calendarFeed'], fetchCalendarFeedUrl, { staleTime: 60 * 60_000 });
}
