/** Planner items, overrides, and notes (owned by the To Do and Calendar workstream). */
import { at, courseById, user, work } from '../data.mjs';
import { paginate } from './core.mjs';

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

/** Canvas's `value_to_boolean`: "true", "1", true are true; anything else, including missing, is false. */
const toBool = (value) =>
  value === true || ['true', 't', '1', 'yes', 'on'].includes(String(value).toLowerCase());

/** `start_date` / `end_date` as Canvas reads them: a bare date covers that whole day. */
function dateRange(query) {
  const start = query.start_date ? new Date(query.start_date) : new Date(0);
  let end = query.end_date ? new Date(query.end_date) : new Date(8.64e15);
  if (query.end_date && /^\d{4}-\d{2}-\d{2}$/.test(query.end_date))
    end = new Date(end.getTime() + 86_399_999);
  return { start, end };
}

// Mutation state lives in module scope; it resets when this file reloads.
let nextId = 6001;
const stamp = () => new Date().toISOString();

/** Planner overrides (app/models/planner_override.rb). */
const overrides = [];

/** Planner notes (lib/api/v1/planner_note.rb). */
const notes = [
  {
    id: '4001',
    title: 'Buy lab goggles',
    details: 'The bookstore keeps them next to the lab coats.',
    todo_date: at(1, 8),
    course_id: '201',
  },
  {
    id: '4002',
    title: 'Email advisor about spring schedule',
    details: 'Ask whether CS 374 can count toward the minor.',
    todo_date: at(2, 23, 59),
    course_id: null,
  },
  {
    id: '4003',
    title: 'Print essay draft for workshop',
    details: null,
    todo_date: at(4, 12),
    course_id: '110',
  },
].map((n) => ({
  ...n,
  user_id: user.id,
  workflow_state: 'active',
  created_at: at(-3, 9),
  updated_at: at(-3, 9),
}));

const findOverride = (type, id) =>
  overrides.find((o) => o.plannable_type === type && o.plannable_id === String(id) && !o.deleted_at);

/** lib/api/v1/planner_override.rb */
const overrideJson = (o) =>
  o
    ? {
        id: o.id,
        plannable_type: o.plannable_type,
        plannable_id: o.plannable_id,
        user_id: user.id,
        assignment_id: o.assignment_id ?? null,
        workflow_state: o.workflow_state,
        marked_complete: o.marked_complete,
        dismissed: o.dismissed,
        created_at: o.created_at,
        updated_at: o.updated_at,
        deleted_at: o.deleted_at ?? null,
      }
    : null;

const noteJson = (n) => ({
  id: n.id,
  todo_date: n.todo_date,
  title: n.title,
  details: n.details,
  user_id: n.user_id,
  course_id: n.course_id,
  workflow_state: n.workflow_state,
  created_at: n.created_at,
  updated_at: n.updated_at,
});

const htmlPath = (w) =>
  `/courses/${w.course}/${w.type === 'quiz' ? 'quizzes' : w.type === 'discussion_topic' ? 'discussion_topics' : 'assignments'}/${w.id}`;

function plannerItem(w) {
  const course = courseById(w.course);
  const quizAttempts = globalThis.__easelFakeQuizzes?.attempts?.[`${w.course}:${w.id}`] ?? [];
  const assignmentAttempts = globalThis.__easelFakeSubmissions?.attempts?.[w.id] ?? [];
  const submitted = quizAttempts.some((a) => ['complete', 'pending_review'].includes(a.workflow)) || assignmentAttempts.length > 0;
  const status = submitted ? { submitted: true } : (w.sub ?? {});
  return {
    plannable_id: w.id,
    plannable_type: w.type,
    plannable_date: w.due,
    context_type: 'Course',
    course_id: w.course,
    context_name: course?.name,
    html_url: htmlPath(w),
    new_activity: false,
    planner_override: overrideJson(findOverride(w.type, w.id)),
    submissions: {
      submitted: !!status.submitted,
      excused: false,
      graded: !!status.graded,
      late: false,
      missing: !!status.missing,
      needs_grading: !!status.submitted && !status.graded,
      has_feedback: !!status.graded,
      redo_request: false,
    },
    plannable: {
      id: w.id,
      title: w.title,
      points_possible: w.points,
      due_at: w.due,
      course_id: w.course,
      // Graded quizzes and discussions carry their assignment's ID; the fixtures reuse one ID.
      assignment_id: w.id,
    },
  };
}

/** Planner notes in the planner feed have no html_url (lib/api/v1/planner_item.rb). */
function noteItem(n) {
  const course = n.course_id ? courseById(n.course_id) : null;
  return {
    ...(course
      ? { context_type: 'Course', course_id: n.course_id, context_name: course.name }
      : { context_type: 'User', user_id: user.id }),
    plannable_id: n.id,
    plannable_type: 'planner_note',
    plannable_date: n.todo_date,
    new_activity: false,
    planner_override: overrideJson(findOverride('planner_note', n.id)),
    submissions: false,
    plannable: {
      id: n.id,
      title: n.title,
      course_id: n.course_id,
      todo_date: n.todo_date,
      details: n.details,
      user_id: n.user_id,
      created_at: n.created_at,
      updated_at: n.updated_at,
    },
  };
}

function badRequest(attribute, message) {
  return { status: 400, body: { errors: { [attribute]: [{ attribute, type: 'invalid', message }] } } };
}

function applyNoteParams(note, body) {
  if (body.title !== undefined) note.title = String(body.title);
  if (body.details !== undefined) note.details = body.details === '' ? null : body.details;
  if (body.todo_date !== undefined) note.todo_date = new Date(body.todo_date).toISOString();
  if (body.course_id !== undefined) {
    const id = body.course_id === null || body.course_id === '' ? null : String(body.course_id);
    if (id && !courseById(id)) return notFound();
    note.course_id = id;
  }
  note.updated_at = stamp();
  return null;
}

const qaQuiz = { id: '9399', course: '201', type: 'quiz', title: 'QA: One question quiz', due: new Date(Date.now() + 3600000).toISOString(), points: 1 };
let qaDelay = 0;

export const routes = [
  { path: '/fake/planner-delay', method: 'POST', public: true, handler: ({ body }) => {
    qaDelay = Math.min(30000, Math.max(0, Number(body?.ms) || 0));
    return { ms: qaDelay };
  } },
  {
    path: '/api/v1/planner/items',
    handler: async ({ query, url }) => {
      if (qaDelay) await new Promise((resolve) => setTimeout(resolve, qaDelay));
      const { start, end } = dateRange(query);
      const inRange = (iso) => new Date(iso) >= start && new Date(iso) <= end;
      const items = [
        ...[qaQuiz, ...work].filter((w) => inRange(w.due)).map(plannerItem),
        ...notes.filter((n) => inRange(n.todo_date)).map(noteItem),
      ].sort((a, b) => a.plannable_date.localeCompare(b.plannable_date));
      return paginate(items, query, url);
    },
  },

  // Planner overrides (app/controllers/planner_overrides_controller.rb).
  {
    path: '/api/v1/planner/overrides',
    handler: ({ query, url }) =>
      paginate(overrides.filter((o) => !o.deleted_at).map(overrideJson), query, url),
  },
  {
    path: '/api/v1/planner/overrides/:id',
    handler: ({ params }) => {
      const o = overrides.find((x) => x.id === params.id && !x.deleted_at);
      return o ? overrideJson(o) : notFound();
    },
  },
  {
    method: 'POST',
    path: '/api/v1/planner/overrides',
    handler: ({ body = {} }) => {
      const type = String(body.plannable_type ?? '');
      const id = String(body.plannable_id ?? '');
      const known =
        (type === 'planner_note' && notes.some((n) => n.id === id)) ||
        work.some((w) => w.type === type && w.id === id);
      if (!known) return notFound();
      if (findOverride(type, id))
        return badRequest('plannable_id', 'A planner override for this item already exists');
      const o = {
        id: String(nextId++),
        plannable_type: type,
        plannable_id: id,
        assignment_id: type === 'planner_note' ? null : id,
        workflow_state: 'active',
        marked_complete: toBool(body.marked_complete),
        dismissed: toBool(body.dismissed),
        created_at: stamp(),
        updated_at: stamp(),
      };
      overrides.push(o);
      return { status: 201, body: overrideJson(o) };
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/planner/overrides/:id',
    handler: ({ params, body = {} }) => {
      const o = overrides.find((x) => x.id === params.id && !x.deleted_at);
      if (!o) return notFound();
      // Canvas sets both flags on every update; a missing one becomes false.
      o.marked_complete = toBool(body.marked_complete);
      o.dismissed = toBool(body.dismissed);
      o.updated_at = stamp();
      return overrideJson(o);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/planner/overrides/:id',
    handler: ({ params }) => {
      const o = overrides.find((x) => x.id === params.id && !x.deleted_at);
      if (!o) return notFound();
      o.deleted_at = stamp();
      o.workflow_state = 'deleted';
      return overrideJson(o);
    },
  },

  // Planner notes (app/controllers/planner_notes_controller.rb).
  {
    path: '/api/v1/planner_notes',
    handler: ({ query, url }) => {
      const { start, end } = dateRange(query);
      const codes = query.context_codes;
      const items = notes
        .filter((n) => new Date(n.todo_date) >= start && new Date(n.todo_date) <= end)
        .filter((n) => !codes || codes.includes(n.course_id ? `course_${n.course_id}` : `user_${user.id}`))
        .sort((a, b) => a.todo_date.localeCompare(b.todo_date))
        .map(noteJson);
      return paginate(items, query, url);
    },
  },
  {
    path: '/api/v1/planner_notes/:id',
    handler: ({ params }) => {
      const n = notes.find((x) => x.id === params.id);
      return n ? noteJson(n) : notFound();
    },
  },
  {
    method: 'POST',
    path: '/api/v1/planner_notes',
    handler: ({ body = {} }) => {
      if (!body.title || !String(body.title).trim()) return badRequest('title', "can't be blank");
      if (!body.todo_date || Number.isNaN(new Date(body.todo_date).getTime()))
        return badRequest('todo_date', "can't be blank");
      const note = {
        id: String(nextId++),
        title: '',
        details: null,
        todo_date: null,
        course_id: null,
        user_id: user.id,
        workflow_state: 'active',
        created_at: stamp(),
        updated_at: stamp(),
      };
      const error = applyNoteParams(note, body);
      if (error) return error;
      notes.push(note);
      return { status: 200, body: noteJson(note) };
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/planner_notes/:id',
    handler: ({ params, body = {} }) => {
      const note = notes.find((x) => x.id === params.id);
      if (!note) return notFound();
      if (body.title !== undefined && !String(body.title).trim())
        return badRequest('title', "can't be blank");
      const error = applyNoteParams(note, body);
      return error ?? noteJson(note);
    },
  },
  {
    method: 'DELETE',
    path: '/api/v1/planner_notes/:id',
    handler: ({ params }) => {
      const index = notes.findIndex((x) => x.id === params.id);
      if (index === -1) return notFound();
      const [note] = notes.splice(index, 1);
      return { ...noteJson(note), workflow_state: 'deleted' };
    },
  },
];
