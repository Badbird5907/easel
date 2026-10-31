import type { CanvasClient } from '../client';
import { useCanvasQuery } from '../query';
import { type Assignment, fetchCourseAssignments } from './assignments';

/** `GET /api/v1/calendar_events` (lib/api/v1/calendar_event.rb), the fields the summary needs. */
type CanvasCalendarEvent = {
  id: string;
  title: string;
  start_at: string | null;
  end_at?: string | null;
  all_day?: boolean;
  html_url?: string;
};

export type SyllabusItem =
  | { kind: 'assignment'; id: string; title: string; date: Date | null; assignment: Assignment }
  | {
      kind: 'event';
      id: string;
      eventId: string;
      title: string;
      date: Date | null;
      allDay: boolean;
      htmlUrl: string | null;
    };

export type Syllabus = {
  /** Syllabus HTML, or empty when the instructor hasn't written one. */
  html: string;
  /** Dated items first, soonest first; undated assignments last. */
  summary: SyllabusItem[];
};

/** Canvas's course summary covers the term; a year either side is plenty for any course. */
function summaryRange(now = new Date()) {
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 1);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  return { start_date: start.toISOString(), end_date: end.toISOString() };
}

export async function fetchSyllabus(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<Syllabus> {
  const [course, assignments, events] = await Promise.all([
    client.get<{ syllabus_body?: string | null }>(
      `/api/v1/courses/${courseId}`,
      { include: ['syllabus_body'] },
      signal,
    ),
    fetchCourseAssignments(client, courseId, signal),
    // Events are a bonus; the summary still works without them.
    client
      .getAll<CanvasCalendarEvent>(
        '/api/v1/calendar_events',
        { context_codes: [`course_${courseId}`], type: 'event', ...summaryRange() },
        { signal, maxPages: 5 },
      )
      .catch((): CanvasCalendarEvent[] => []),
  ]);

  const items: SyllabusItem[] = [
    ...assignments.map((a): SyllabusItem => ({
      kind: 'assignment',
      id: `assignment:${a.id}`,
      title: a.name,
      date: a.dueAt,
      assignment: a,
    })),
    ...events.map((e): SyllabusItem => ({
      kind: 'event',
      id: `event:${e.id}`,
      eventId: String(e.id),
      title: e.title,
      date: e.start_at ? new Date(e.start_at) : null,
      allDay: e.all_day ?? false,
      htmlUrl: e.html_url ?? null,
    })),
  ];
  items.sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : a.title.localeCompare(b.title);
    return a.date.getTime() - b.date.getTime();
  });
  return { html: course.syllabus_body ?? '', summary: items };
}

/** Syllabus body plus the course summary of dated items (CONTENT-9). */
export function useSyllabus(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'syllabus'], (client, signal) =>
    fetchSyllabus(client, courseId, signal),
  );
}
