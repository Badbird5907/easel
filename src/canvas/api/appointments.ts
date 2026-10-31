import { useQueryClient } from '@tanstack/react-query';

import { type CanvasClient, CanvasError } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { useCanvas } from '../session';

/*
 * The appointment scheduler (CAL-6): sign-up sheets instructors post, the time
 * slots in them, and the student's reservations.
 *
 *   GET    /api/v1/appointment_groups?scope=reservable       appointment_groups_controller.rb#index
 *   GET    /api/v1/appointment_groups/:id?include[]=appointments&include[]=child_events
 *   POST   /api/v1/calendar_events/:slot/reservations/:participant   calendar_events_api_controller.rb#reserve
 *   DELETE /api/v1/calendar_events/:reservation              the reservation is the student's own event
 *
 * Shapes: lib/api/v1/calendar_event.rb (#appointment_group_json, #calendar_event_json).
 */

/** A time slot: a calendar event whose context is the appointment group. */
export type CanvasAppointmentSlot = {
  id: string;
  start_at: string;
  end_at: string;
  workflow_state?: string;
  /** The student reserved this slot. */
  reserved?: boolean;
  /** Where to POST a reservation, with the participant filled in. */
  reserve_url?: string;
  reserve_comments?: string | null;
  /** Open places, when the slot has a limit. */
  available_slots?: number;
  participants_per_appointment?: number | null;
  /** The student's own reservation, when they have one (include[]=child_events). */
  child_events?: {
    id: string;
    own_reservation?: boolean;
    comments?: string | null;
    parent_event_id?: string;
  }[];
  child_events_count?: number;
};

export type CanvasAppointmentGroup = {
  id: string;
  title: string;
  description?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  context_codes?: string[];
  participant_type?: 'User' | 'Group';
  participants_per_appointment?: number | null;
  max_appointments_per_participant?: number | null;
  min_appointments_per_participant?: number | null;
  /** The student still has to sign up. */
  requiring_action?: boolean;
  appointments_count?: number;
  appointments?: CanvasAppointmentSlot[];
  reserved_times?: { id: string; start_at: string; end_at: string }[];
  html_url?: string;
  workflow_state?: string;
};

export type Reservation = { id: string; start: Date; end: Date };

export type AppointmentGroup = {
  id: string;
  title: string;
  /** HTML. */
  description: string;
  location: string | null;
  address: string | null;
  start: Date | null;
  end: Date | null;
  /** The first course it's offered in, for color and name. */
  courseId: string | null;
  contextCodes: string[];
  /** Reservations are for a student group, not the student alone. */
  forGroups: boolean;
  maxPerStudent: number | null;
  requiringAction: boolean;
  slotCount: number;
  /** The student's upcoming reservations, soonest first. */
  reserved: Reservation[];
  htmlUrl: string | null;
};

export type AppointmentSlot = {
  id: string;
  start: Date;
  end: Date;
  /** Open places; null when the slot has no limit. */
  open: number | null;
  capacity: number | null;
  reserved: boolean;
  /** The reservation to cancel, when reserved. */
  reservationId: string | null;
  comments: string | null;
  reserveUrl: string | null;
};

export type AppointmentGroupDetail = AppointmentGroup & { slots: AppointmentSlot[] };

const courseIdOf = (code: string) => (code.startsWith('course_') ? code.slice('course_'.length) : null);

function toGroup(g: CanvasAppointmentGroup): AppointmentGroup {
  const codes = g.context_codes ?? [];
  const now = Date.now();
  return {
    id: String(g.id),
    title: g.title,
    description: g.description ?? '',
    location: g.location_name || null,
    address: g.location_address || null,
    start: g.start_at ? new Date(g.start_at) : null,
    end: g.end_at ? new Date(g.end_at) : null,
    courseId: codes.map(courseIdOf).find((id): id is string => !!id) ?? null,
    contextCodes: codes,
    forGroups: g.participant_type === 'Group',
    maxPerStudent: g.max_appointments_per_participant ?? null,
    requiringAction: !!g.requiring_action,
    slotCount: g.appointments_count ?? g.appointments?.length ?? 0,
    reserved: (g.reserved_times ?? [])
      .map((r) => ({ id: String(r.id), start: new Date(r.start_at), end: new Date(r.end_at) }))
      .filter((r) => r.end.getTime() > now)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
    htmlUrl: g.html_url ?? null,
  };
}

function toSlot(s: CanvasAppointmentSlot): AppointmentSlot {
  const own =
    s.child_events?.find((c) => c.own_reservation) ?? (s.reserved ? s.child_events?.[0] : undefined);
  const capacity = s.participants_per_appointment ?? null;
  return {
    id: String(s.id),
    start: new Date(s.start_at),
    end: new Date(s.end_at),
    open: capacity === null ? null : (s.available_slots ?? capacity),
    capacity,
    reserved: !!s.reserved,
    reservationId: own ? String(own.id) : null,
    comments: own?.comments || s.reserve_comments || null,
    reserveUrl: s.reserve_url ?? null,
  };
}

export const appointmentKeys = {
  all: ['appointments'] as const,
  groups: ['appointments', 'groups'] as const,
  group: (id: string) => ['appointments', 'group', id] as const,
};

export async function fetchAppointmentGroups(client: CanvasClient, signal?: AbortSignal) {
  const groups = await client.getAll<CanvasAppointmentGroup>(
    '/api/v1/appointment_groups',
    { scope: 'reservable', include: ['reserved_times'] },
    { signal, maxPages: 10 },
  );
  return groups
    .filter((g) => g.workflow_state !== 'deleted')
    .map(toGroup)
    .sort(
      (a, b) =>
        Number(b.requiringAction) - Number(a.requiringAction) ||
        (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) ||
        a.title.localeCompare(b.title),
    );
}

/** Sign-up sheets the student can reserve a time in, ones that need a sign-up first. */
export function useAppointmentGroups(options?: { enabled?: boolean }) {
  return useCanvasQuery(appointmentKeys.groups, fetchAppointmentGroups, options);
}

export async function fetchAppointmentGroup(
  client: CanvasClient,
  id: string,
  signal?: AbortSignal,
): Promise<AppointmentGroupDetail> {
  const g = await client.get<CanvasAppointmentGroup>(
    `/api/v1/appointment_groups/${id}`,
    { include: ['appointments', 'child_events', 'reserved_times'] },
    signal,
  );
  const now = Date.now();
  const slots = (g.appointments ?? [])
    .map(toSlot)
    // Past slots can't be reserved or changed (check_for_past_signup).
    .filter((s) => s.end.getTime() > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return { ...toGroup(g), slots };
}

/** One sign-up sheet with its upcoming time slots. */
export function useAppointmentGroup(id: string) {
  return useCanvasQuery(appointmentKeys.group(id), (client, signal) =>
    fetchAppointmentGroup(client, id, signal),
  );
}

/** Thrown when Canvas turns a reservation down, with a message a student can act on. */
export class ReservationError extends Error {
  constructor(message: string, readonly reason?: 'unavailable' | 'started') {
    super(message);
    this.name = 'ReservationError';
  }
}

function useInvalidateAppointments() {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [accountKey, ...appointmentKeys.all] }),
      // Reservations show on the calendar.
      queryClient.invalidateQueries({ queryKey: [accountKey, 'calendar'] }),
      queryClient.invalidateQueries({ queryKey: [accountKey, 'planner'] }),
    ]);
}

export type ReserveInput = {
  slot: AppointmentSlot;
  comments: string;
  /** Give up the student's other reservation in this group first (`cancel_existing`). */
  replaceExisting: boolean;
};

/** Reserves a time slot, optionally with a note for the instructor. */
export function useReserveSlot() {
  const { account } = useCanvas();
  const invalidate = useInvalidateAppointments();
  return useCanvasMutation(
    async (client, { slot, comments, replaceExisting }: ReserveInput) => {
      // Canvas fills in the participant (the student, or their group) in reserve_url.
      let path = `/api/v1/calendar_events/${slot.id}/reservations`;
      if (slot.reserveUrl) {
        try {
          const url = new URL(slot.reserveUrl, account.baseUrl);
          if (url.host === new URL(account.baseUrl).host && !url.pathname.includes('{{')) path = url.pathname;
        } catch {
          // Use the default path.
        }
      }
      try {
        return await client.post<unknown>(path, {
          comments: comments.trim() || undefined,
          cancel_existing: replaceExisting,
        });
      } catch (error) {
        if (error instanceof CanvasError && error.status === 400)
          throw new ReservationError(
            'Canvas couldn’t reserve this time. It may have just filled up, or you may already have a time in this group. Refresh and try again.',
            'unavailable',
          );
        if (error instanceof CanvasError && error.status === 403)
          throw new ReservationError('This time has already started, so it can’t be reserved.', 'started');
        throw error;
      }
    },
    { onSuccess: () => invalidate() },
  );
}

/** Cancels one of the student's reservations. */
export function useCancelSlot() {
  const invalidate = useInvalidateAppointments();
  return useCanvasMutation(
    (client, reservationId: string) => client.delete<unknown>(`/api/v1/calendar_events/${reservationId}`),
    { onSuccess: () => invalidate() },
  );
}
