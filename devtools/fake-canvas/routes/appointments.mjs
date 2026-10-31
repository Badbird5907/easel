/**
 * The appointment scheduler (owned by the Calendar workstream): sign-up sheets
 * (appointment groups), their time slots, and the student's reservations.
 *
 * Shapes and rules follow canvas-lms:
 *   app/controllers/appointment_groups_controller.rb#index, #show
 *   app/controllers/calendar_events_api_controller.rb#reserve, #destroy
 *   app/models/calendar_event.rb#reserve_for              limits and errors
 *   lib/api/v1/calendar_event.rb                          appointment_group_json, calendar_event_json
 *
 * Groups:
 *   61 Project check-in    CS 225    1 per slot, max 1: the student holds one, one slot is full
 *   62 Midterm conference  ENGL 110  1 per slot, min 1: needs a sign-up; two slots are full
 *   63 Office hours        MATH 241  3 per slot, no limit per student
 *
 * A reservation is the student's own calendar event (context user_1001) whose
 * parent is the slot. calendar.mjs lists, shows, and deletes them through
 * globalThis.__easelFakeAppointments; this file loads first.
 */
import { BASE, courseById, user } from '../data.mjs';
import { paginate } from './core.mjs';

/**
 * A date `days` from today at hh:mm local time. Relative to when this file
 * loaded rather than to server start, so "today" stays today in a long-running server.
 */
const LOADED = new Date();
function at(days, hours, minutes = 0) {
  const d = new Date(LOADED);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

/** reserve_for's errors: an array, as the controller renders them. */
const reservationError = (message, reservations = []) => ({
  status: 400,
  body: [{ attribute: 'reservation', type: 'calendar_event', message, reservations }],
});

const groups = [
  {
    id: '61',
    title: 'Project check-in',
    course: '225',
    description:
      '<p>Ten minutes to go over your final project proposal. Bring a draft of your milestones.</p>',
    location_name: 'Siebel 2124',
    location_address: '201 N Goodwin Ave, Urbana, IL',
    participants_per_appointment: 1,
    max_appointments_per_participant: 1,
    min_appointments_per_participant: null,
    slots: [
      { id: '7601', start: at(5, 14, 0), end: at(5, 14, 15), taken: 0 },
      { id: '7602', start: at(5, 14, 15), end: at(5, 14, 30), taken: 1 },
      { id: '7603', start: at(5, 14, 30), end: at(5, 14, 45), taken: 0 },
      { id: '7604', start: at(5, 14, 45), end: at(5, 15, 0), taken: 0 },
      { id: '7605', start: at(6, 10, 0), end: at(6, 10, 15), taken: 0 },
    ],
  },
  {
    id: '62',
    title: 'Midterm essay conference',
    course: '110',
    description:
      '<p>Sign up for a 20-minute conference about your midterm essay. <strong>Everyone needs one time.</strong></p>',
    location_name: 'English Building 109',
    location_address: null,
    participants_per_appointment: 1,
    max_appointments_per_participant: 1,
    min_appointments_per_participant: 1,
    slots: [
      { id: '7621', start: at(2, 10, 0), end: at(2, 10, 20), taken: 1 },
      { id: '7622', start: at(2, 10, 20), end: at(2, 10, 40), taken: 0 },
      { id: '7623', start: at(2, 10, 40), end: at(2, 11, 0), taken: 1 },
      { id: '7624', start: at(3, 13, 0), end: at(3, 13, 20), taken: 0 },
      { id: '7625', start: at(3, 13, 20), end: at(3, 13, 40), taken: 0 },
    ],
  },
  {
    id: '63',
    title: 'Office hours',
    course: '241',
    description: '<p>Small-group office hours. Up to three students per time.</p>',
    location_name: 'Altgeld Hall 245',
    location_address: null,
    participants_per_appointment: 3,
    max_appointments_per_participant: null,
    min_appointments_per_participant: null,
    slots: [
      { id: '7641', start: at(1, 16, 0), end: at(1, 16, 30), taken: 2 },
      { id: '7642', start: at(1, 16, 30), end: at(1, 17, 0), taken: 3 },
      { id: '7643', start: at(4, 16, 0), end: at(4, 16, 30), taken: 0 },
    ],
  },
];

// Reservations live on globalThis so they survive this file reloading.
const state = (globalThis.__easelFakeAppointmentState ??= {
  nextId: 8501,
  reservations: [
    {
      id: '8500',
      slotId: '7601',
      groupId: '61',
      comments: 'I’d like feedback on the milestone dates.',
      created_at: at(-1, 9),
    },
  ],
});

const stamp = () => new Date().toISOString();
const findSlot = (id) => {
  for (const g of groups) {
    const slot = g.slots.find((s) => s.id === id);
    if (slot) return { group: g, slot };
  }
  return null;
};
const reservationsFor = (groupId) => state.reservations.filter((r) => r.groupId === groupId);
const slotReservation = (slotId) => state.reservations.find((r) => r.slotId === slotId);
const takenCount = (slot) => slot.taken + (slotReservation(slot.id) ? 1 : 0);

/** The student's reservation, as their own calendar event (calendar_event_json). */
function reservationJson(r) {
  const { group, slot } = findSlot(r.slotId);
  const course = courseById(group.course);
  return {
    id: r.id,
    title: group.title,
    start_at: slot.start,
    end_at: slot.end,
    all_day: false,
    all_day_date: null,
    created_at: r.created_at,
    updated_at: r.created_at,
    workflow_state: 'locked',
    comments: r.comments ?? null,
    series_uuid: null,
    rrule: null,
    location_name: group.location_name,
    location_address: group.location_address,
    type: 'event',
    description: group.description,
    child_events_count: 0,
    all_context_codes: `course_${group.course}`,
    context_code: `user_${user.id}`,
    effective_context_code: `course_${group.course}`,
    context_name: course?.name ?? null,
    context_color: course?.color ?? null,
    parent_event_id: slot.id,
    hidden: false,
    appointment_group_id: group.id,
    appointment_group_url: `${BASE}/api/v1/appointment_groups/${group.id}`,
    can_manage_appointment_group: false,
    participant_type: 'User',
    own_reservation: true,
    child_events: [],
    url: `${BASE}/api/v1/calendar_events/${r.id}`,
    html_url: `${BASE}/calendar?event_id=${r.id}&include_contexts=course_${group.course}`,
  };
}

/** A time slot (calendar_event_json with the group as context). */
function slotJson(group, slot) {
  const own = slotReservation(slot.id);
  const taken = takenCount(slot);
  const limit = group.participants_per_appointment;
  return {
    id: slot.id,
    title: group.title,
    start_at: slot.start,
    end_at: slot.end,
    all_day: false,
    workflow_state: taken > 0 ? 'locked' : 'active',
    location_name: group.location_name,
    location_address: group.location_address,
    description: group.description,
    type: 'event',
    context_code: `appointment_group_${group.id}`,
    effective_context_code: `course_${group.course}`,
    all_context_codes: `course_${group.course}`,
    appointment_group_id: group.id,
    appointment_group_url: `${BASE}/api/v1/appointment_groups/${group.id}`,
    can_manage_appointment_group: false,
    participant_type: 'User',
    reserved: !!own,
    reserve_comments: own?.comments ?? '',
    reserve_url: `${BASE}/api/v1/calendar_events/${slot.id}/reservations/${user.id}`,
    ...(limit ? { available_slots: Math.max(limit - taken, 0), participants_per_appointment: limit } : {}),
    child_events_count: taken,
    child_events: own ? [reservationJson(own)] : [],
    hidden: false,
    url: `${BASE}/api/v1/calendar_events/${slot.id}`,
    html_url: `${BASE}/calendar?event_id=${slot.id}&include_contexts=appointment_group_${group.id}`,
  };
}

/** appointment_group_json */
function groupJson(group, include = []) {
  const mine = reservationsFor(group.id);
  const now = Date.now();
  const upcoming = group.slots.filter((s) => new Date(s.end).getTime() > now);
  const starts = group.slots.map((s) => s.start).sort();
  const ends = group.slots.map((s) => s.end).sort();
  return {
    id: group.id,
    title: group.title,
    description: group.description,
    location_name: group.location_name,
    location_address: group.location_address,
    start_at: starts[0] ?? null,
    end_at: ends[ends.length - 1] ?? null,
    created_at: at(-7, 9),
    updated_at: at(-7, 9),
    workflow_state: 'active',
    participant_visibility: 'private',
    participants_per_appointment: group.participants_per_appointment,
    max_appointments_per_participant: group.max_appointments_per_participant,
    min_appointments_per_participant: group.min_appointments_per_participant,
    sub_context_codes: [],
    context_codes: [`course_${group.course}`],
    requiring_action:
      !!group.min_appointments_per_participant && mine.length < group.min_appointments_per_participant,
    appointments_count: group.slots.length,
    participant_type: 'User',
    url: `${BASE}/api/v1/appointment_groups/${group.id}`,
    html_url: `${BASE}/appointment_groups/${group.id}`,
    ...(include.includes('participant_count')
      ? { participant_count: group.slots.reduce((n, s) => n + takenCount(s), 0) }
      : {}),
    ...(include.includes('reserved_times')
      ? {
          reserved_times: mine.map((r) => {
            const { slot } = findSlot(r.slotId);
            return { id: r.id, start_at: slot.start, end_at: slot.end };
          }),
        }
      : {}),
    ...(include.includes('appointments') ? { appointments: upcoming.map((s) => slotJson(group, s)) } : {}),
  };
}

function reserve({ params, body = {} }) {
  const found = findSlot(params.id);
  if (!found) return notFound();
  const { group, slot } = found;
  if (params.participantId && params.participantId !== user.id)
    return reservationError('invalid participant');
  if (new Date(slot.end).getTime() < Date.now())
    return { status: 403, body: { message: 'Cannot create or change reservation for past appointment' } };
  const cancelExisting = body.cancel_existing === true || body.cancel_existing === 'true';
  if (cancelExisting) state.reservations = state.reservations.filter((r) => r.groupId !== group.id);
  const mine = reservationsFor(group.id);
  if (group.max_appointments_per_participant && mine.length >= group.max_appointments_per_participant)
    return reservationError('participant has met per-participant limit', mine.map(reservationJson));
  if (group.participants_per_appointment && takenCount(slot) >= group.participants_per_appointment)
    return reservationError('all slots filled', mine.map(reservationJson));
  if (slotReservation(slot.id)) return reservationError('participant has already reserved this appointment');
  const r = {
    id: String(state.nextId++),
    slotId: slot.id,
    groupId: group.id,
    comments: typeof body.comments === 'string' && body.comments.trim() ? body.comments.trim() : null,
    created_at: stamp(),
  };
  state.reservations.push(r);
  return reservationJson(r);
}

globalThis.__easelFakeAppointments = {
  /** The student's reservations as calendar events, for the calendar feed. */
  events: () => state.reservations.filter((r) => findSlot(r.slotId)).map(reservationJson),
  event: (id) => {
    const r = state.reservations.find((x) => x.id === id);
    return r && findSlot(r.slotId) ? reservationJson(r) : null;
  },
  /** Cancels a reservation. Null when it isn't one; a response when it's refused. */
  cancel: (id) => {
    const r = state.reservations.find((x) => x.id === id);
    if (!r) return null;
    const found = findSlot(r.slotId);
    if (found && new Date(found.slot.end).getTime() < Date.now())
      return { status: 403, body: { message: 'Cannot create or change reservation for past appointment' } };
    const json = { ...reservationJson(r), workflow_state: 'deleted' };
    state.reservations = state.reservations.filter((x) => x.id !== id);
    return json;
  },
};

export const routes = [
  {
    path: '/api/v1/appointment_groups',
    handler: ({ query, url }) => {
      // Students only see reservable groups; "manageable" is for instructors.
      if (query.scope === 'manageable') return paginate([], query, url);
      const include = query.include ?? [];
      const now = Date.now();
      // Without include_past_appointments, groups whose times have all passed drop off.
      const current = groups.filter(
        (g) =>
          query.include_past_appointments === 'true' || g.slots.some((s) => new Date(s.end).getTime() > now),
      );
      return paginate(
        current.map((g) => groupJson(g, include)),
        query,
        url,
      );
    },
  },
  {
    path: '/api/v1/appointment_groups/:id',
    handler: ({ params, query }) => {
      const group = groups.find((g) => g.id === params.id);
      return group ? groupJson(group, query.include ?? []) : notFound();
    },
  },
  { method: 'POST', path: '/api/v1/calendar_events/:id/reservations', handler: reserve },
  { method: 'POST', path: '/api/v1/calendar_events/:id/reservations/:participantId', handler: reserve },
];
