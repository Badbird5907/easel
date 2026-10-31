/**
 * Calendar events, the student's groups, and the calendar feed (owned by the To Do and
 * Calendar workstream). Follows app/controllers/calendar_events_api_controller.rb and
 * lib/api/v1/calendar_event.rb, including recurring series: POST with
 * `calendar_event[rrule]` creates every event of the series up front, and PUT and DELETE
 * take `which=one|all|following`.
 *
 * Fixtures around today: three overlapping events this afternoon and two tomorrow, an
 * all-day event in two days and another in twelve, and a weekly personal series. Reserved
 * appointments come from appointments.mjs.
 */
import { BASE, courseById, user, work } from '../data.mjs';
import { paginate } from './core.mjs';
import { studentGroups } from './group-content.mjs';

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
const unauthorized = () => ({
  status: 401,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});

/** Canvas honors only the first 10 context codes (calendar_events_api_controller.rb). */
const CONTEXT_LIMIT = 10;

/** `GET /api/v1/users/self/groups` (lib/api/v1/group.rb) */
const groups = [{ id: '501', name: 'Osmosis Lab Group', course_id: '201', members_count: 4 }];

/** A local calendar day as `YYYY-MM-DD`, for all-day events. */
function day(days) {
  const d = new Date(at(days, 12));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Mutation state lives in module scope; it resets when this file reloads.
let nextId = 10001;
const stamp = () => new Date().toISOString();

const events = [
  {
    id: '8001',
    context_code: 'course_201',
    title: 'Lab section: Osmosis',
    start_at: at(1, 14),
    end_at: at(1, 16),
    location_name: 'Room 214, Life Sciences',
    location_address: '1206 W Gregory Dr, Urbana, IL',
    description:
      '<p>Bring your <strong>lab notebook</strong> and goggles. We’ll run the potato-core osmosis experiment in pairs.</p><ul><li>Read sections 5.2 and 5.3 first</li><li>Pre-lab quiz opens at noon</li></ul>',
  },
  {
    id: '8002',
    context_code: 'course_241',
    title: 'Office hours',
    start_at: at(2, 15),
    end_at: at(2, 16, 30),
    location_name: 'Altgeld Hall 245',
    description: '<p>Drop in with questions about Lagrange multipliers or Problem Set 7.</p>',
  },
  {
    id: '8003',
    context_code: 'course_225',
    title: 'MP3 review session',
    start_at: at(3, 18),
    end_at: at(3, 19, 30),
    location_name: 'Siebel 1404',
    description:
      '<p>We’ll walk through open addressing and resizing. Join online: <a href="https://example.zoom.us/j/123456789">example.zoom.us/j/123456789</a></p>',
  },
  {
    id: '8004',
    context_code: 'course_150',
    title: 'Midterm exam',
    start_at: at(8, 10),
    end_at: at(8, 11, 50),
    location_name: 'Lincoln Hall Theater',
    description:
      '<p>Covers weeks 1 to 7. Bring a pencil and your student ID.</p><table><tr><th>Part</th><th>Weight</th></tr><tr><td>Multiple choice</td><td>40%</td></tr><tr><td>Short answer</td><td>60%</td></tr></table>',
  },
  {
    id: '8005',
    context_code: 'course_110',
    title: 'Writing center workshop',
    start_at: at(-3, 13),
    end_at: at(-3, 14),
    location_name: 'Undergrad Library, Room 251',
    description: '<p>Thesis statements that hold up.</p>',
  },
  {
    id: '8006',
    context_code: 'course_201',
    title: 'No class: Fall break',
    all_day: true,
    all_day_date: day(12),
    start_at: at(12, 0),
    end_at: at(12, 0),
    description: '<p>Campus is closed. Labs resume the following Monday.</p>',
  },
  {
    id: '8007',
    context_code: `user_${user.id}`,
    title: 'Study group',
    start_at: at(0, 19),
    end_at: at(0, 21),
    location_name: 'Grainger Library',
    description: '<p>Calc study group, second floor.</p>',
  },
  {
    id: '8008',
    context_code: `user_${user.id}`,
    title: 'Dentist appointment',
    start_at: at(4, 9),
    end_at: at(4, 10),
    location_name: 'McKinley Health Center',
    description: null,
  },
  {
    id: '8009',
    context_code: 'group_501',
    title: 'Lab group meeting',
    start_at: at(2, 18),
    end_at: at(2, 19),
    location_name: 'Discord',
    description: '<p>Split up the results section of the lab report.</p>',
  },
  {
    id: '8011',
    context_code: 'course_201',
    title: 'Lab safety training',
    start_at: at(0, 13),
    end_at: at(0, 14, 30),
    location_name: 'Life Sciences 1001',
    description: '<p>Required before your first wet lab. Closed-toe shoes.</p>',
  },
  {
    id: '8012',
    context_code: 'course_241',
    title: 'Problem session',
    start_at: at(0, 13, 30),
    end_at: at(0, 14, 30),
    location_name: 'Altgeld Hall 143',
    description: '<p>Work through Problem Set 7 with the TAs.</p>',
  },
  {
    id: '8013',
    context_code: 'course_225',
    title: 'CS tutoring',
    start_at: at(0, 14),
    end_at: at(0, 15),
    location_name: 'Siebel 0216',
    description: null,
  },
  {
    id: '8014',
    context_code: 'group_501',
    title: 'Lab group: data review',
    start_at: at(1, 15),
    end_at: at(1, 16),
    location_name: 'Grainger Library, room 3',
    description: '<p>Check the osmosis data before we write it up.</p>',
  },
  {
    id: '8015',
    context_code: 'course_110',
    title: 'Peer review day',
    all_day: true,
    all_day_date: day(2),
    start_at: at(2, 0),
    end_at: at(2, 0),
    description: '<p>Bring two printed copies of your draft.</p>',
  },
].map((e) => ({ created_at: at(-10, 9), updated_at: at(-10, 9), all_day: false, ...e }));

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
/** Canvas's own limit on events in a series (RruleHelper::RECURRING_EVENT_LIMIT). */
const SERIES_LIMIT = 400;

const rruleFields = (rule) =>
  Object.fromEntries(
    String(rule)
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((p) => p.split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, v]) => [k.toUpperCase(), v]),
  );

function untilDate(value) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '23', mi = '59', sec = '59', z] = m;
  return z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)) : new Date(+y, +mo - 1, +d, +h, +mi, +sec);
}

/** rrule_validate_common_opts */
function validateRrule(rule) {
  const f = rruleFields(rule);
  if (!f.INTERVAL) return 'Missing INTERVAL';
  if (!(Number(f.INTERVAL) > 0)) return 'INTERVAL must be > 0';
  if (!f.COUNT && !f.UNTIL) return 'Missing COUNT or UNTIL';
  if (f.COUNT && !(Number(f.COUNT) > 0)) return 'COUNT must be > 0';
  if (f.COUNT && Number(f.COUNT) > SERIES_LIMIT) return `COUNT must be <= ${SERIES_LIMIT}`;
  if (f.UNTIL && !untilDate(f.UNTIL)) return `Invalid UNTIL '${f.UNTIL}'`;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(f.FREQ)) return `Invalid FREQ '${f.FREQ}'`;
  return null;
}

/** The start of each event in a series, from the first event's start (local time, like the user's zone). */
function expandRrule(rule, start) {
  const f = rruleFields(rule);
  const interval = Number(f.INTERVAL ?? 1);
  const count = f.COUNT ? Number(f.COUNT) : SERIES_LIMIT;
  const until = f.UNTIL ? untilDate(f.UNTIL) : null;
  const first = new Date(start);
  const out = [];
  const add = (d) => {
    if (d < first || (until && d > until) || out.length >= Math.min(count, SERIES_LIMIT)) return false;
    out.push(new Date(d));
    return true;
  };
  const withTime = (d) => {
    const x = new Date(d);
    x.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0);
    return x;
  };
  for (let i = 0; i < 2000 && out.length < Math.min(count, SERIES_LIMIT); i++) {
    if (f.FREQ === 'DAILY') {
      const d = new Date(first);
      d.setDate(first.getDate() + i * interval);
      if (until && d > until) break;
      add(d);
    } else if (f.FREQ === 'WEEKLY') {
      const days = (f.BYDAY ?? DAY_CODES[first.getDay()]).split(',');
      const weekStart = new Date(first);
      weekStart.setDate(first.getDate() - first.getDay() + i * 7 * interval);
      if (until && weekStart > until) break;
      for (let k = 0; k < 7; k++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + k);
        if (days.includes(DAY_CODES[d.getDay()])) add(withTime(d));
      }
    } else if (f.FREQ === 'MONTHLY') {
      const month = new Date(first.getFullYear(), first.getMonth() + i * interval, 1);
      if (until && month > until) break;
      let d = null;
      if (f.BYMONTHDAY) d = new Date(month.getFullYear(), month.getMonth(), Number(f.BYMONTHDAY));
      else {
        const code = (f.BYDAY ?? DAY_CODES[first.getDay()]).replace(/^[-+]?\d+/, '');
        const pos = Number(
          f.BYSETPOS ?? (f.BYDAY ?? '').match(/^[-+]?\d+/)?.[0] ?? Math.ceil(first.getDate() / 7),
        );
        const matches = [];
        for (let day = 1; day <= 31; day++) {
          const x = new Date(month.getFullYear(), month.getMonth(), day);
          if (x.getMonth() !== month.getMonth()) break;
          if (DAY_CODES[x.getDay()] === code) matches.push(x);
        }
        d = pos === -1 ? matches[matches.length - 1] : matches[pos - 1];
      }
      if (d && d.getMonth() === month.getMonth()) add(withTime(d));
    } else if (f.FREQ === 'YEARLY') {
      const year = first.getFullYear() + i * interval;
      const d = new Date(
        year,
        Number(f.BYMONTH ?? first.getMonth() + 1) - 1,
        Number(f.BYMONTHDAY ?? first.getDate()),
      );
      if (until && d > until) break;
      if (d.getDate() === Number(f.BYMONTHDAY ?? first.getDate())) add(withTime(d));
    }
  }
  return out;
}

/** rrule_to_natural_language, in English. */
function naturalLanguage(rule) {
  const f = rruleFields(rule);
  const n = Number(f.INTERVAL ?? 1);
  const end = f.COUNT
    ? `, ${f.COUNT} times`
    : ` until ${untilDate(f.UNTIL)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const days = (f.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((d) => DAY_NAMES[d.replace(/^[-+]?\d+/, '')] ?? d)
    .join(', ');
  switch (f.FREQ) {
    case 'DAILY':
      return n === 1 ? `Daily${end}` : `Every ${n} days${end}`;
    case 'WEEKLY':
      return `${n === 1 ? 'Weekly' : `Every ${n} weeks`}${days ? ` on ${days}` : ''}${end}`;
    case 'MONTHLY':
      return `${n === 1 ? 'Monthly' : `Every ${n} months`}${days ? ` on the ${{ 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' }[f.BYSETPOS] ?? ''} ${days}` : ''}${end}`;
    case 'YEARLY':
      return `Annually${end}`;
    default:
      return null;
  }
}

/** Builds a series of events from one event's attributes (create_event_series). */
function seriesFrom(base, rule) {
  const uuid = `series-${nextId}-${Date.now().toString(36)}`;
  const duration = new Date(base.end_at) - new Date(base.start_at);
  return expandRrule(rule, base.start_at).map((start, i) => ({
    ...base,
    id: String(nextId++),
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + duration).toISOString(),
    all_day_date: base.all_day ? localDate(start) : base.all_day_date,
    series_uuid: uuid,
    rrule: rule,
    series_head: i === 0,
  }));
}

const localDate = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A weekly personal series: every week on today's weekday, starting two weeks ago.
if (!events.some((e) => e.series_uuid === 'series-fixture-spanish')) {
  const rule = `FREQ=WEEKLY;BYDAY=${DAY_CODES[new Date().getDay()]};INTERVAL=1;COUNT=8`;
  expandRrule(rule, at(-14, 17)).forEach((start, i) =>
    events.push({
      id: String(8201 + i),
      context_code: `user_${user.id}`,
      title: 'Spanish conversation table',
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
      all_day: false,
      location_name: 'Lincoln Hall 1002',
      description: '<p>Practice speaking with other learners. All levels welcome.</p>',
      series_uuid: 'series-fixture-spanish',
      rrule: rule,
      series_head: i === 0,
      created_at: at(-20, 9),
      updated_at: at(-20, 9),
    }),
  );
}

function contextInfo(code) {
  const [type, id] = code.split('_');
  if (type === 'course') {
    const c = courseById(id);
    return c ? { name: c.name, color: c.color } : null;
  }
  if (type === 'group') {
    const g = groups.find((x) => x.id === id);
    return g ? { name: g.name, color: null } : null;
  }
  if (type === 'user' && id === user.id) return { name: user.name, color: null };
  return null;
}

/** lib/api/v1/calendar_event.rb#calendar_event_json */
function eventJson(e, excludes = [], include = []) {
  const context = contextInfo(e.context_code);
  return {
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: !!e.all_day,
    all_day_date: e.all_day ? e.all_day_date : null,
    created_at: e.created_at,
    updated_at: e.updated_at,
    workflow_state: 'active',
    comments: null,
    series_uuid: e.series_uuid ?? null,
    rrule: e.rrule ?? null,
    ...(e.series_uuid && e.rrule
      ? {
          series_head: !!e.series_head,
          ...(include.includes('series_natural_language')
            ? { series_natural_language: naturalLanguage(e.rrule) }
            : {}),
        }
      : {}),
    blackout_date: false,
    location_address: e.location_address ?? null,
    location_name: e.location_name ?? null,
    type: 'event',
    ...(excludes.includes('description') ? {} : { description: e.description ?? null }),
    child_events_count: 0,
    all_context_codes: e.context_code,
    context_code: e.context_code,
    context_name: context?.name ?? null,
    context_color: context?.color ?? null,
    parent_event_id: null,
    hidden: false,
    child_events: [],
    url: `${BASE}/api/v1/calendar_events/${e.id}`,
    html_url: `${BASE}/calendar?event_id=${e.id}&include_contexts=${e.context_code}`,
    duplicates: [],
    important_dates: false,
  };
}

/** lib/api/v1/calendar_event.rb#assignment_event_json */
function assignmentEventJson(w, excludes = []) {
  const course = courseById(w.course);
  const htmlUrl = `${BASE}/courses/${w.course}/assignments/${w.id}`;
  return {
    id: `assignment_${w.id}`,
    type: 'assignment',
    title: w.title,
    created_at: at(-20, 9),
    updated_at: at(-20, 9),
    all_day: false,
    all_day_date: w.due.slice(0, 10),
    workflow_state: 'published',
    submission_types:
      w.type === 'quiz'
        ? 'online_quiz'
        : w.type === 'discussion_topic'
          ? 'discussion_topic'
          : 'online_upload',
    ...(excludes.includes('description')
      ? {}
      : { description: '<p>See the assignment page for details.</p>' }),
    ...(excludes.includes('assignment')
      ? {}
      : {
          assignment: {
            id: w.id,
            name: w.title,
            due_at: w.due,
            points_possible: w.points,
            course_id: w.course,
            html_url: htmlUrl,
            submission_types: [w.type === 'quiz' ? 'online_quiz' : 'online_upload'],
          },
        }),
    html_url: htmlUrl,
    context_code: `course_${w.course}`,
    context_name: course?.name ?? null,
    context_color: course?.color ?? null,
    start_at: w.due,
    end_at: w.due,
    url: `${BASE}/api/v1/calendar_events/assignment_${w.id}`,
    important_dates: false,
  };
}

/** Bare dates mean whole days; `end_date` is inclusive. */
function dateRange(query) {
  const start = query.start_date ? new Date(query.start_date) : new Date(new Date().setHours(0, 0, 0, 0));
  let end = query.end_date ? new Date(query.end_date) : new Date(start.getTime() + 86_399_999);
  if (query.end_date && /^\d{4}-\d{2}-\d{2}$/.test(query.end_date))
    end = new Date(end.getTime() + 86_399_999);
  return { start, end };
}

const badRequest = (message) => ({ status: 400, body: { message } });

function editable(code) {
  return code === `user_${user.id}`;
}

function applyEventParams(e, params = {}) {
  for (const key of ['title', 'description', 'location_name', 'location_address']) {
    if (params[key] !== undefined) e[key] = params[key] === '' ? null : String(params[key]);
  }
  if (params.start_at !== undefined) e.start_at = new Date(params.start_at).toISOString();
  if (params.end_at !== undefined) e.end_at = new Date(params.end_at).toISOString();
  if (params.all_day !== undefined) e.all_day = params.all_day === true || params.all_day === 'true';
  if (e.all_day) {
    const start = new Date(e.start_at);
    start.setHours(0, 0, 0, 0);
    e.start_at = e.end_at = start.toISOString();
    const pad = (n) => String(n).padStart(2, '0');
    e.all_day_date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  }
  if (new Date(e.end_at) < new Date(e.start_at)) e.end_at = e.start_at;
  e.updated_at = stamp();
}

export const routes = [
  {
    path: '/api/v1/users/self/groups',
    handler: ({ query, url }) => paginate(studentGroups(query), query, url),
  },
  {
    path: '/api/v1/calendar_events',
    handler: ({ query, url }) => {
      const { start, end } = dateRange(query);
      // Without context codes Canvas shows only the personal calendar.
      const codes = new Set((query.context_codes ?? [`user_${user.id}`]).slice(0, CONTEXT_LIMIT));
      const excludes = query.excludes ?? [];
      const include = query.include ?? [];
      let items;
      if (query.type === 'assignment') {
        items = work
          .filter((w) => codes.has(`course_${w.course}`))
          .filter((w) => new Date(w.due) >= start && new Date(w.due) <= end)
          .sort((a, b) => a.due.localeCompare(b.due))
          .map((w) => assignmentEventJson(w, excludes));
      } else {
        // Reservations are the student's own events, so they come with the personal calendar.
        const reserved = codes.has(`user_${user.id}`)
          ? (globalThis.__easelFakeAppointments?.events() ?? [])
          : [];
        items = [
          ...events.filter((e) => codes.has(e.context_code)).map((e) => eventJson(e, excludes, include)),
          ...reserved,
        ]
          // Overlapping the range counts, as in Canvas.
          .filter((e) => new Date(e.end_at) >= start && new Date(e.start_at) <= end)
          .sort((a, b) => a.start_at.localeCompare(b.start_at));
      }
      return paginate(items, query, url);
    },
  },
  {
    path: '/api/v1/calendar_events/:id',
    handler: ({ params, query }) => {
      if (params.id.startsWith('assignment_')) {
        const w = work.find((x) => `assignment_${x.id}` === params.id);
        return w ? assignmentEventJson(w) : notFound();
      }
      const reservation = globalThis.__easelFakeAppointments?.event(params.id);
      if (reservation) return reservation;
      const e = events.find((x) => x.id === params.id);
      return e ? eventJson(e, [], query.include ?? []) : notFound();
    },
  },
  {
    method: 'POST',
    path: '/api/v1/calendar_events',
    handler: ({ body = {} }) => {
      const params = body.calendar_event ?? {};
      if (!params.context_code || !contextInfo(params.context_code)) return notFound();
      // Students can only add events to their own calendar.
      if (!editable(params.context_code)) return unauthorized();
      const e = {
        id: String(nextId++),
        context_code: params.context_code,
        title: 'Untitled',
        start_at: stamp(),
        end_at: stamp(),
        all_day: false,
        created_at: stamp(),
      };
      applyEventParams(e, params);
      if (params.rrule) {
        const problem = validateRrule(params.rrule);
        if (problem) return badRequest(problem);
        const series = seriesFrom(e, params.rrule);
        if (!series.length) return badRequest('The recurrence rule has no events');
        events.push(...series);
        return {
          status: 201,
          body: { ...eventJson(series[0], [], ['series_natural_language']), duplicates: [] },
        };
      }
      events.push(e);
      return { status: 201, body: eventJson(e) };
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/calendar_events/:id',
    handler: ({ params, body = {} }) => {
      const e = events.find((x) => x.id === params.id);
      if (!e) return notFound();
      if (!editable(e.context_code)) return unauthorized();
      const changes = body.calendar_event ?? {};
      const which = body.which ?? 'one';
      const include = ['series_natural_language'];

      // A single event that gains a schedule becomes a series (change_to_series_event).
      if (!e.series_uuid && changes.rrule) {
        const problem = validateRrule(changes.rrule);
        if (problem) return badRequest(problem);
        applyEventParams(e, changes);
        const series = seriesFrom(e, changes.rrule);
        // The edited event stays the head and keeps its ID.
        series[0].id = e.id;
        events.splice(events.indexOf(e), 1, ...series);
        return series.map((x) => eventJson(x, [], include));
      }
      if (!e.series_uuid) {
        applyEventParams(e, changes);
        return eventJson(e);
      }

      // update_from_series
      const rruleGiven = Object.prototype.hasOwnProperty.call(changes, 'rrule');
      const rule = rruleGiven ? changes.rrule : e.rrule;
      const ruleChanged = rruleGiven && rule !== e.rrule;
      if (which === 'one' && rule && ruleChanged)
        return badRequest('You may not update one event with a new schedule.');
      const startChanged =
        changes.start_at && localDate(new Date(changes.start_at)) !== localDate(new Date(e.start_at));
      if (which === 'all' && startChanged && !e.series_head)
        return badRequest('You may not change the start date when changing all events in the series');
      if (which === 'one' && !(ruleChanged && !rule)) {
        applyEventParams(e, changes);
        return eventJson(e, [], include);
      }

      const all = events
        .filter((x) => x.series_uuid === e.series_uuid)
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const affected = which === 'following' ? all.filter((x) => x.start_at >= e.start_at) : all;
      const untouched = all.filter((x) => !affected.includes(x));

      // A blank rule turns the series back into this one event.
      if (ruleChanged && !rule) {
        for (const x of all) if (x !== e) events.splice(events.indexOf(x), 1);
        applyEventParams(e, { ...changes, rrule: undefined });
        e.series_uuid = null;
        e.rrule = null;
        e.series_head = false;
        return [eventJson(e)];
      }

      // Times move together; the first affected event anchors the dates.
      const anchor = affected[0];
      const target = { ...e };
      applyEventParams(target, changes);
      const offset = new Date(target.start_at) - new Date(e.start_at);
      const duration = new Date(target.end_at) - new Date(target.start_at);
      if (ruleChanged || startChanged) {
        // A new schedule (or moved dates) rebuilds the affected events as a new series.
        const startAt = new Date(new Date(anchor.start_at).getTime() + offset);
        for (const x of affected) events.splice(events.indexOf(x), 1);
        const base = {
          ...target,
          start_at: startAt.toISOString(),
          end_at: new Date(startAt.getTime() + duration).toISOString(),
        };
        // Moving the back half keeps its length (update_rrule_count).
        const nextRule =
          !ruleChanged && which === 'following'
            ? rule.replace(/COUNT=\d+/, `COUNT=${affected.length}`)
            : rule;
        const series = seriesFrom(base, nextRule);
        events.push(...series);
        for (const x of untouched)
          x.rrule = rule.replace(/COUNT=\d+|UNTIL=[^;]+/, `COUNT=${untouched.length}`);
        return [...untouched, ...series].map((x) => eventJson(x, [], include));
      }
      for (const x of affected) {
        const start = new Date(new Date(x.start_at).getTime() + offset);
        applyEventParams(x, {
          ...changes,
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + duration).toISOString(),
        });
      }
      return affected.map((x) => eventJson(x, [], include));
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/calendar_events/:id',
    handler: ({ params, query, body = {} }) => {
      const cancelled = globalThis.__easelFakeAppointments?.cancel(params.id);
      if (cancelled) return cancelled;
      const e = events.find((x) => x.id === params.id);
      if (!e) return notFound();
      if (!editable(e.context_code)) return unauthorized();
      const which = query.which ?? body.which ?? 'one';
      if (!e.series_uuid || which === 'one') {
        events.splice(events.indexOf(e), 1);
        return { ...eventJson(e), workflow_state: 'deleted' };
      }
      const all = events.filter((x) => x.series_uuid === e.series_uuid);
      const removed = which === 'following' ? all.filter((x) => x.start_at >= e.start_at) : all;
      for (const x of removed) events.splice(events.indexOf(x), 1);
      const left = all.filter((x) => !removed.includes(x));
      // The series that's left just got shorter.
      for (const x of left) x.rrule = x.rrule.replace(/COUNT=\d+|UNTIL=[^;]+/, `COUNT=${left.length}`);
      return [
        ...removed.map((x) => ({ ...eventJson(x), workflow_state: 'deleted' })),
        ...left.map((x) => eventJson(x)),
      ];
    },
  },

  // The calendar feed (users/self/profile `calendar.ics`): events and due dates as iCalendar.
  {
    path: '/feeds/calendars/:name',
    public: true,
    handler: () => {
      const ics = (iso) =>
        new Date(iso)
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}/, '');
      const text = (value) =>
        String(value ?? '')
          .replace(/\\/g, '\\\\')
          .replace(/\n/g, '\\n')
          .replace(/[,;]/g, (c) => `\\${c}`);
      const plain = (html) =>
        String(html ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Fake Canvas//EN',
        'X-WR-CALNAME:Evan Student Calendar (Fake University)',
        'METHOD:PUBLISH',
      ];
      for (const e of [...events, ...(globalThis.__easelFakeAppointments?.events() ?? [])]) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:event-calendar-event-${e.id}`,
          `DTSTAMP:${ics(e.updated_at ?? e.created_at ?? new Date().toISOString())}`,
          ...(e.all_day && e.all_day_date
            ? [`DTSTART;VALUE=DATE:${e.all_day_date.replace(/-/g, '')}`]
            : [`DTSTART:${ics(e.start_at)}`, `DTEND:${ics(e.end_at)}`]),
          `SUMMARY:${text(e.title)}`,
          ...(e.location_name ? [`LOCATION:${text(e.location_name)}`] : []),
          ...(e.description ? [`DESCRIPTION:${text(plain(e.description))}`] : []),
          `URL:${BASE}/calendar?event_id=${e.id}`,
          'END:VEVENT',
        );
      }
      for (const w of work) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:event-assignment-${w.id}`,
          `DTSTAMP:${ics(w.due)}`,
          `DTSTART:${ics(w.due)}`,
          `DTEND:${ics(w.due)}`,
          `SUMMARY:${text(`${w.title} [${courseById(w.course)?.code ?? 'Course'}]`)}`,
          `URL:${BASE}/courses/${w.course}/assignments/${w.id}`,
          'END:VEVENT',
        );
      }
      lines.push('END:VCALENDAR');
      return {
        status: 200,
        body: `${lines.join('\r\n')}\r\n`,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      };
    },
  },
];
