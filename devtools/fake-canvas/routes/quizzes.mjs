/**
 * Classic quizzes (owned by the web view, LTI, and quizzes workstream): the quiz list and
 * details, the Quiz Submissions API used to take a quiz natively, quiz file uploads, and
 * the web pages the app falls back to (quiz page, one-question-at-a-time take page,
 * results).
 *
 * Shapes and rules follow canvas-lms:
 *   app/serializers/quizzes/quiz_serializer.rb            quiz JSON
 *   app/controllers/quizzes/quiz_submissions_api_controller.rb   start, show, time, complete
 *   app/models/quizzes/quiz_submission_service.rb          takeability and error messages
 *   app/controllers/quizzes/quiz_submission_questions_controller.rb  questions, answer, flag
 *   app/controllers/quizzes/quiz_submission_events_api_controller.rb  event log
 *   app/controllers/quizzes/quiz_submission_files_controller.rb  file preflight
 *   lib/api/v1/quiz_submission.rb, quiz_submission_question.rb, quiz_question.rb (censoring)
 *   app/models/quizzes/quiz_question_builder.rb            blanks, dropdowns, calculated text
 *   app/models/quizzes/quiz_question/answer_serializers/   answer formats and errors
 *
 * Errors are RequestError JSON, `{ status: "forbidden", message: "invalid access code" }`.
 * The one-question-at-a-time 401 has no WWW-Authenticate header, so it doesn't read as a
 * dead token. Answers, flags, and complete need `validation_token`, the latest `attempt`,
 * and (for access-code quizzes) `access_code` on every request, as Canvas does.
 *
 * Quiz file preflight answers `{ attachments: [{ upload_url, upload_params, file_param }] }`
 * (api_attachment_preflight_json), not the bare preflight other upload endpoints return.
 *
 * Quizzes:
 *   9008 (201)  graded, 30 min, 2 attempts, attempt 1 done (22/25)
 *   9301 (201)  practice, unlimited attempts
 *   9302 (201)  locked until a future date
 *   9006 (241)  access code "2718", one question at a time, can't go back: start answers
 *               501 (the API can't take it), the web page takes it
 *   9303 (241)  anonymous survey
 *   9310 (241)  practice with every question type (numerical exact, range, precision,
 *               calculated, essay, file upload, text-only, inline math)
 *   9311 (241)  one-minute time limit, unlimited attempts
 *   9312 (241)  access code "4417"
 *   9313 (241)  IP filter: start answers 403 "IP address denied"
 *   9314 (241)  LockDown Browser: start answers 403 "this quiz requires the lockdown browser"
 *   9315 (241)  three attempts, attempt 1 done (6/10)
 *
 * Timing: an untaken attempt past `end_at` plus 60 seconds is overdue. Answers then fail
 * with "quiz submission is overdue", and the next read of the submission turns it in, the
 * way Canvas's timer auto-submits. (Canvas allows five minutes of grace; one keeps tests short.)
 *
 * Attempts, answers, flags, events, and uploads live on globalThis (`__easelFakeQuizzes`)
 * so they survive reloads and course-content.mjs sees completed attempts for module
 * requirements. `POST /fake/quizzes/reset` drops them. `POST /fake/quizzes/answers-down` makes
 * answer requests drop their connection (to test the offline queue); `answers-up` restores them.
 */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

import { at, BASE, courseById, user } from '../data.mjs';
import { paginate } from './core.mjs';

const state = (globalThis.__easelFakeQuizzes ??= {
  /** `${course}:${quiz}` -> attempt records, oldest first. */
  attempts: {},
  /** Uploaded quiz files: id -> { id, name, type, bytes, created }. */
  files: new Map(),
  uploads: new Map(),
  nextId: 1,
});

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});

const statusNames = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  501: 'not_implemented',
};
/** lib/request_error.rb#error_json */
const reject = (message, status) => ({ status, body: { status: statusNames[status], message } });

const canvasDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const canvasDate = (iso) => canvasDateFormat.format(new Date(iso)).replace(', ', ' at ');
const isFuture = (iso) => !!iso && new Date(iso) > Date.now();
const isPast = (iso) => !!iso && new Date(iso) < Date.now();

// ---------------------------------------------------------------------------
// Question banks
// ---------------------------------------------------------------------------

const mc = (text, choices, correct, extra = {}) => ({
  type: 'multiple_choice_question',
  text,
  points: 1,
  answers: choices.map((c, i) => ({ ...(typeof c === 'string' ? { text: c } : c), weight: i === correct ? 100 : 0 })),
  ...extra,
});
const tf = (text, isTrue, extra = {}) => ({
  type: 'true_false_question',
  text,
  points: 1,
  answers: [
    { text: 'True', weight: isTrue ? 100 : 0 },
    { text: 'False', weight: isTrue ? 0 : 100 },
  ],
  ...extra,
});
const short = (text, accepted, extra = {}) => ({
  type: 'short_answer_question',
  text,
  points: 1,
  answers: accepted.map((t) => ({ text: t, weight: 100 })),
  ...extra,
});
const essay = (text, points = 3) => ({ type: 'essay_question', text, points, answers: [] });

const everyType = [
  mc(
    '<p>Which point is a critical point of \\(f(x, y) = x^2 + y^2\\)?</p>',
    [
      { text: '(0, 0)', html: '<p>\\((0, 0)\\)</p>' },
      { text: '(1, 1)', html: '<p>\\((1, 1)\\)</p>' },
      { text: '(0, 1)', html: '<p>\\((0, 1)\\)</p>' },
      'It has no critical points',
    ],
    0,
  ),
  tf('<p>The gradient of a function points in the direction of steepest ascent.</p>', true),
  {
    type: 'multiple_answers_question',
    text: '<p>Select every function whose partial derivative with respect to <em>x</em> is 2<em>x</em>.</p>',
    points: 1,
    answers: [
      { text: 'x² + y', weight: 100 },
      { text: 'x² − 4y²', weight: 100 },
      { text: '2xy', weight: 0 },
      { text: 'x²y', weight: 0 },
    ],
  },
  {
    type: 'matching_question',
    text: '<p>Match each expression to its name.</p>',
    points: 1,
    answers: [
      { text: '∇f', match: 'Gradient' },
      { text: '∇ · F', match: 'Divergence' },
      { text: '∇ × F', match: 'Curl' },
    ],
    distractors: ['Laplacian'],
  },
  {
    type: 'multiple_dropdowns_question',
    text: '<p>Second derivative test: if <em>D</em> &gt; 0 and <em>f<sub>xx</sub></em> [sign] 0, the point is a local [extremum].</p>',
    points: 1,
    answers: [
      { blank_id: 'sign', text: '>', weight: 100 },
      { blank_id: 'sign', text: '<', weight: 0 },
      { blank_id: 'sign', text: '=', weight: 0 },
      { blank_id: 'extremum', text: 'minimum', weight: 100 },
      { blank_id: 'extremum', text: 'maximum', weight: 0 },
      { blank_id: 'extremum', text: 'saddle point', weight: 0 },
    ],
  },
  {
    type: 'fill_in_multiple_blanks_question',
    text: '<p>For <em>f</em>(<em>x</em>, <em>y</em>) = x³y, the partial derivative with respect to <em>x</em> is [dx], and with respect to <em>y</em> it is [dy].</p>',
    points: 1,
    answers: [
      { blank_id: 'dx', text: '3x^2y', weight: 100 },
      { blank_id: 'dx', text: '3x²y', weight: 100 },
      { blank_id: 'dy', text: 'x^3', weight: 100 },
      { blank_id: 'dy', text: 'x³', weight: 100 },
    ],
  },
  short('<p>What is the matrix of second partial derivatives called?</p>', ['Hessian', 'Hessian matrix', 'the Hessian']),
  {
    type: 'text_only_question',
    text: '<p><strong>Part 2: Computation.</strong> You can use a calculator for the rest of this quiz.</p>',
    points: 0,
    answers: [],
  },
  {
    type: 'numerical_question',
    text: '<p>Evaluate <em>f</em>(2, 3) for <em>f</em>(<em>x</em>, <em>y</em>) = x² + y.</p>',
    points: 1,
    answers: [{ numerical_answer_type: 'exact_answer', exact: 7, margin: 0, weight: 100 }],
  },
  {
    type: 'numerical_question',
    text: '<p>Estimate √50 to one decimal place.</p>',
    points: 1,
    answers: [{ numerical_answer_type: 'range_answer', start: 7, end: 7.2, weight: 100 }],
  },
  {
    type: 'numerical_question',
    text: '<p>What is π to three significant figures?</p>',
    points: 1,
    answers: [{ numerical_answer_type: 'precision_answer', approximate: 3.14159, precision: 3, weight: 100 }],
  },
  {
    type: 'calculated_question',
    text: '<p>A rectangle is [w] cm wide and [h] cm tall. What is its area in square centimeters?</p>',
    points: 1,
    variables: [
      { name: 'w', min: 2, max: 9, scale: 0 },
      { name: 'h', min: 2, max: 9, scale: 0 },
    ],
    formulas: [{ formula: 'w*h' }],
    tolerance: 0,
    decimals: 0,
    combos: [
      { w: 4, h: 7 },
      { w: 3, h: 9 },
      { w: 6, h: 5 },
      { w: 8, h: 2 },
    ],
  },
  essay('<p>In two or three sentences, explain what a saddle point is.</p>'),
  { type: 'file_upload_question', text: '<p>Upload a photo of your work for the rectangle problem.</p>', points: 2, answers: [] },
];

const timedCheck = [
  mc('<p>What is \\(\\frac{d}{dx} \\sin x\\)?</p>', ['cos x', '−cos x', 'sin x', 'tan x'], 0),
  tf('<p>Every continuous function on a closed interval has a maximum.</p>', true),
  short('<p>Name the theorem that guarantees the answer above.</p>', ['Extreme value theorem', 'extreme value']),
];

const lagrange = [
  mc('<p>Lagrange multipliers find extrema of <em>f</em> subject to which kind of condition?</p>', ['A constraint g(x, y) = c', 'A bounded domain', 'A periodic boundary', 'No condition'], 0),
  tf('<p>At a constrained extremum, ∇f is parallel to ∇g.</p>', true),
  {
    type: 'numerical_question',
    text: '<p>Maximize <em>xy</em> subject to <em>x</em> + <em>y</em> = 10. What is the maximum?</p>',
    points: 1,
    answers: [{ numerical_answer_type: 'exact_answer', exact: 25, margin: 0, weight: 100 }],
  },
  essay('<p>Why does the method need ∇g ≠ 0?</p>', 2),
];

const gradients = [
  mc('<p>What is ∇f for <em>f</em> = x² + 3y?</p>', ['(2x, 3)', '(x, 3y)', '(2, 3)', '(2x, 3y)'], 0, { points: 2 }),
  tf('<p>The gradient is perpendicular to level curves.</p>', true, { points: 2 }),
  short('<p>What is the directional derivative in the direction of ∇f called, in words?</p>', ['the maximum rate of change', 'maximum rate of change', 'max rate of change'], { points: 2 }),
  {
    type: 'numerical_question',
    text: '<p>|∇f| at (1, 0) for <em>f</em> = x² + 3y, to two decimal places.</p>',
    points: 2,
    answers: [{ numerical_answer_type: 'range_answer', start: 3.6, end: 3.62, weight: 100 }],
  },
  mc('<p>Which vector is a unit vector?</p>', ['(3/5, 4/5)', '(1, 1)', '(1/2, 1/2)', '(0, 2)'], 0, { points: 2 }),
];

const surveyQuestions = [
  mc('<p>How clear are the lectures?</p>', ['Very clear', 'Mostly clear', 'Sometimes unclear', 'Often unclear'], -1, { points: 0 }),
  mc('<p>How useful is the homework?</p>', ['Very useful', 'Somewhat useful', 'Not useful'], -1, { points: 0 }),
  mc('<p>How many hours a week do you spend on this course?</p>', ['0–3', '4–6', '7–9', '10 or more'], -1, { points: 0 }),
  essay('<p>What is working well?</p>', 0),
  essay('<p>What would you change?</p>', 0),
  essay('<p>Anything else?</p>', 0),
];

const biology = [
  (n) => mc(`<p>(${n}) Which kind of transport needs ATP?</p>`, ['Active transport', 'Simple diffusion', 'Facilitated diffusion', 'Osmosis'], 0),
  (n) => tf(`<p>(${n}) Water moves toward lower water potential.</p>`, true),
  (n) => mc(`<p>(${n}) Which organelle makes most of a cell’s ATP?</p>`, ['Mitochondrion', 'Golgi apparatus', 'Lysosome', 'Ribosome'], 0),
  (n) => short(`<p>(${n}) What is the name for diffusion of water across a membrane?</p>`, ['osmosis']),
];
const calculus = [
  (n) => mc(`<p>(${n}) What is \\(\\partial f / \\partial x\\) for \\(f = x^2 y\\)?</p>`, ['2xy', 'x²', '2x', 'y'], 0),
  (n) => mc(`<p>(${n}) What is \\(\\partial f / \\partial y\\) for \\(f = x^2 y\\)?</p>`, ['x²', '2xy', '0', 'y'], 0),
];

/** Fills a bank to `count` questions from templates, for quizzes that only had a count. */
const repeat = (templates, count, points) =>
  Array.from({ length: count }, (_, i) => ({ ...templates[i % templates.length](i + 1), points }));

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

const quizzes = [
  {
    id: '9008',
    course: '201',
    assignment: '9608',
    title: 'Quiz 4: Membrane Transport',
    type: 'assignment',
    due: at(-4, 10),
    points: 25,
    questions: 12,
    timeLimit: 30,
    attempts: 2,
    scoring: 'keep_highest',
    description:
      '<p>Twelve questions on passive and active transport. You have 30 minutes once you start.</p><p>Your highest score counts.</p>',
    taken: [{ attempt: 1, score: 22, started: at(-4, 9, 12), finished: at(-4, 9, 42) }],
  },
  {
    id: '9301',
    course: '201',
    title: 'Practice: Cell Organelles',
    lock: at(92, 23, 59),
    type: 'practice_quiz',
    points: 10,
    questions: 10,
    attempts: -1,
    description: '<p>Ungraded practice. Take it as many times as you like.</p>',
    taken: [],
  },
  {
    id: '9302',
    course: '201',
    title: 'Quiz 5: Cellular Respiration',
    type: 'assignment',
    due: at(16, 10),
    unlock: at(9, 8),
    points: 25,
    questions: 15,
    timeLimit: 30,
    attempts: 1,
    description: '<p>Covers glycolysis, the Krebs cycle, and the electron transport chain.</p>',
    taken: [],
  },
  {
    id: '9006',
    course: '241',
    assignment: '9606',
    title: 'Quiz 3: Partial Derivatives',
    type: 'assignment',
    due: at(5, 10),
    points: 15,
    questions: 8,
    timeLimit: 20,
    attempts: 1,
    accessCode: true,
    code: '2718',
    oneAtATime: true,
    description:
      '<p>Covers 14.3 to 14.5. Your instructor gives you the access code at the start of class.</p><p>One question at a time; you can’t go back.</p>',
    taken: [],
  },
  {
    id: '9303',
    course: '241',
    title: 'Course feedback survey',
    type: 'survey',
    points: 0,
    questions: 6,
    attempts: 1,
    lockdown: false,
    description: '<p>Anonymous. Tell us what is working and what isn’t.</p>',
    taken: [],
    bank: surveyQuestions,
  },
  {
    id: '9310',
    course: '241',
    title: 'Practice: Every question type',
    type: 'practice_quiz',
    attempts: -1,
    shuffle: false,
    description:
      '<p>One of each kind of question, for practice. Nothing here counts toward your grade.</p>',
    taken: [],
    bank: everyType,
  },
  {
    id: '9311',
    course: '241',
    title: 'Timed check: one minute',
    type: 'practice_quiz',
    attempts: -1,
    timeLimit: 1,
    description: '<p>Three quick questions. You have one minute; the quiz turns itself in when time runs out.</p>',
    taken: [],
    bank: timedCheck,
  },
  {
    id: '9312',
    course: '241',
    title: 'Quiz 6: Lagrange Multipliers',
    type: 'assignment',
    due: at(7, 10),
    attempts: 1,
    accessCode: true,
    code: '4417',
    description: '<p>Your instructor writes the access code on the board at the start of class.</p>',
    taken: [],
    bank: lagrange,
  },
  {
    id: '9313',
    course: '241',
    title: 'Lab quiz: On campus only',
    type: 'assignment',
    due: at(3, 15),
    attempts: 1,
    ipFilter: '192.0.2.0/24',
    description: '<p>Take this in the math lab. It only opens on the campus network.</p>',
    taken: [],
    bank: lagrange,
  },
  {
    id: '9314',
    course: '241',
    title: 'Midterm 2',
    type: 'assignment',
    due: at(12, 9),
    attempts: 1,
    timeLimit: 75,
    lockdown: true,
    description: '<p>Chapters 14 and 15. You need Respondus LockDown Browser for this exam.</p>',
    taken: [],
    bank: [...lagrange, ...gradients],
  },
  {
    id: '9315',
    course: '241',
    title: 'Quiz 7: Gradients',
    type: 'assignment',
    due: at(9, 10),
    attempts: 3,
    scoring: 'keep_highest',
    // Students see their scores, but not which answers were right (QUIZ-9).
    showCorrect: false,
    description: '<p>Three attempts. Your highest score counts.</p>',
    taken: [{ attempt: 1, score: 6, started: at(-1, 14, 2), finished: at(-1, 14, 19) }],
    bank: gradients,
  },
];

const banks = {
  9008: repeat(biology, 12, 25 / 12),
  9301: repeat(biology, 10, 1),
  9302: repeat(biology, 15, 25 / 15),
  9006: repeat(calculus, 8, 15 / 8),
};

/** The quiz's questions with stable IDs: question 931003, answer 93100301, match 93100391. */
function questionsOf(q) {
  const bank = q.bank ?? banks[q.id] ?? [];
  return bank.map((src, i) => {
    const id = `${q.id}${String(i + 1).padStart(2, '0')}`;
    const question = { ...src, id, answers: (src.answers ?? []).map((a, j) => ({ ...a, id: `${id}${String(j + 1).padStart(2, '0')}` })) };
    if (src.type === 'matching_question') {
      const names = [...src.answers.map((a) => a.match), ...(src.distractors ?? [])];
      question.matches = names.map((text, j) => ({ match_id: `${id}9${j}`, text }));
      question.answers = question.answers.map((a) => ({ ...a, match_id: question.matches.find((m) => m.text === a.match).match_id }));
    }
    if (src.type === 'calculated_question') {
      question.answers = src.combos.map((combo, j) => ({
        id: `${id}${String(j + 1).padStart(2, '0')}`,
        variables: Object.entries(combo).map(([name, value]) => ({ name, value })),
        answer: evaluate(src.formulas[0].formula, combo),
        weight: 100,
      }));
    }
    return question;
  });
}

/** The fixture formulas are products and sums of variables. */
function evaluate(formula, values) {
  const expr = formula.replace(/[a-z]+/gi, (name) => String(values[name] ?? 0));
  if (!/^[\d+\-*/ ().]+$/.test(expr)) return 0;
  return Function(`return (${expr})`)();
}

const pointsOf = (q) =>
  q.points ?? Math.round(questionsOf(q).reduce((sum, x) => sum + (x.points ?? 0), 0) * 100) / 100;
const countOf = (q) => q.questions ?? questionsOf(q).filter((x) => x.type !== 'text_only_question').length;

const key = (q) => `${q.course}:${q.id}`;
const fixtureById = (courseId, id) => quizzes.find((x) => x.course === String(courseId) && x.id === String(id));

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

const token = () => randomBytes(20).toString('hex');
/** One quiz submission per student per quiz; attempts are its versions (same ID). */
const submissionId = (q) => `5${q.id}`;

function attemptsOf(q) {
  if (!state.attempts[key(q)]) {
    state.attempts[key(q)] = q.taken.map((t) => ({
      attempt: t.attempt,
      started: t.started,
      finished: t.finished,
      endAt: q.timeLimit ? new Date(Date.parse(t.started) + q.timeLimit * 60_000).toISOString() : null,
      score: t.score,
      workflow: 'complete',
      token: token(),
      quizData: buildQuizData(q, t.attempt),
      answers: {},
      flags: {},
      graded: null,
      events: [],
      seeded: true,
    }));
  }
  const records = state.attempts[key(q)];
  // Seeded attempts have a score but no answers; give each question a result that adds up to it.
  for (const rec of records) if (rec.seeded && !rec.graded) rec.graded = seededGrades(q, rec);
  return records;
}

/**
 * Per-question results for a fixture attempt, matching its score: questions in a seeded
 * order earn full points until the score runs out, then one partly, then none.
 */
function seededGrades(q, rec) {
  const questions = rec.quizData.filter((x) => x.type !== 'text_only_question');
  const order = shuffled(questions, seeded(Number(q.id) * 7 + rec.attempt));
  let left = rec.score ?? 0;
  const graded = {};
  for (const question of order) {
    const points = question.points ?? 0;
    if (q.type === 'survey' || q.type === 'graded_survey' || ['essay_question', 'file_upload_question'].includes(question.type)) {
      graded[question.id] = { correct: 'undefined', points: 0 };
    } else if (left >= points - 1e-9) {
      graded[question.id] = { correct: true, points: Math.round(points * 100) / 100 };
      left -= points;
    } else if (left > 0) {
      graded[question.id] = { correct: 'partial', points: Math.round(left * 100) / 100 };
      left = 0;
    } else {
      graded[question.id] = { correct: false, points: 0 };
    }
  }
  return graded;
}

const latestOf = (q) => attemptsOf(q).at(-1) ?? null;
const completed = (rec) => rec.workflow === 'complete' || rec.workflow === 'pending_review';
const untaken = (rec) => rec.workflow === 'untaken';
const OVERDUE_GRACE_MS = 60_000;
const overdue = (rec) => !!rec.endAt && Date.now() > Date.parse(rec.endAt) + OVERDUE_GRACE_MS;

/** Turns in an overdue attempt, as Canvas does when the timer runs out. */
function settle(q) {
  const rec = latestOf(q);
  if (rec && untaken(rec) && overdue(rec) && !q.timerAutosubmitDisabled) finish(q, rec, rec.endAt);
}

function keptScore(q) {
  const scores = attemptsOf(q).filter(completed).map((r) => r.score ?? 0);
  if (!scores.length) return null;
  const policy = q.scoring ?? 'keep_highest';
  if (policy === 'keep_latest') return scores.at(-1);
  if (policy === 'keep_average') return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
  return Math.max(...scores);
}

const attemptsLeft = (q, rec) => (q.attempts < 0 ? -1 : Math.max(0, q.attempts - (rec?.attempt ?? 0)));

/** QuizSubmission#results_visible? for the student. */
function resultsVisible(q, rec) {
  if (q.oneTimeResults && (rec.seenResults || rec.seeded)) return false;
  if (q.hideResults === 'always') return false;
  if (q.hideResults !== 'until_after_last_attempt') return true;
  return q.attempts < 1 || rec.attempt > q.attempts || (completed(rec) && rec.attempt >= q.attempts);
}

/** lib/api/v1/quiz_submission.rb#quiz_submission_json */
function submissionJson(q, rec) {
  const id = submissionId(q);
  const done = completed(rec);
  const json = {
    id,
    user_id: user.id,
    submission_id: q.assignment ? `s${q.assignment}` : null,
    quiz_id: q.id,
    quiz_points_possible: pointsOf(q),
    quiz_version: 1,
    attempt: rec.attempt,
    extra_attempts: null,
    extra_time: null,
    manually_unlocked: null,
    started_at: rec.started,
    finished_at: rec.finished ?? null,
    end_at: rec.endAt,
    fudge_points: null,
    kept_score: keptScore(q),
    score: done ? rec.score : null,
    score_before_regrade: null,
    has_seen_results: done ? !!rec.seenResults || !!rec.seeded : false,
    validation_token: rec.token,
    workflow_state: rec.workflow,
    time_spent: rec.finished ? Math.round((Date.parse(rec.finished) - Date.parse(rec.started)) / 1000) : null,
    attempts_left: attemptsLeft(q, rec),
    overdue_and_needs_submission: untaken(rec) && !!rec.endAt && Date.parse(rec.endAt) < Date.now(),
    'excused?': false,
    html_url: `${BASE}/courses/${q.course}/quizzes/${q.id}/submissions/${id}`,
  };
  if (done) json.result_url = `${BASE}/courses/${q.course}/quizzes/${q.id}/history?quiz_submission_id=${id}&version=${rec.attempt}`;
  return json;
}

// ---------------------------------------------------------------------------
// Quiz data for an attempt (quiz_question_builder.rb)
// ---------------------------------------------------------------------------

/** AssessmentQuestion.variable_id */
export const variableId = (variable) =>
  createHash('md5').update(['dropdown', variable, 'instructure-key'].join(',')).digest('hex');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const roundIfWhole = (n) => (Number.isInteger(n) ? String(n) : String(n));

/** mulberry32: a stable shuffle per quiz and attempt. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const blanksOf = (question) => [...new Set(question.answers.map((a) => a.blank_id))];

function buildQuizData(q, attempt) {
  const random = seeded(Number(q.id) * 31 + attempt);
  let position = 0;
  return questionsOf(q).map((src) => {
    const question = structuredClone(src);
    const textOnly = question.type === 'text_only_question';
    if (!textOnly) position += 1;
    question.position = position;
    question.question_name = textOnly ? 'Spacer' : `Question ${position}`;
    let text = question.text;
    if (question.type === 'fill_in_multiple_blanks_question') {
      for (const blank of blanksOf(question)) {
        const vid = variableId(blank);
        text = text.replace(
          new RegExp(`\\[${escapeRegExp(blank)}\\]`),
          `<input\n  class='question_input'\n  type='text'\n  autocomplete='off'\n  style='width: 120px;'\n  name='question_${question.id}_${vid}'\n  value='{{question_${question.id}_${vid}}}' />\n`,
        );
      }
    }
    if (question.type === 'multiple_dropdowns_question') {
      for (const blank of blanksOf(question)) {
        const vid = variableId(blank);
        const options = question.answers
          .filter((a) => a.blank_id === blank)
          .map((a) => `<option value='${a.id}'>${escapeHtml(a.text)}</option>`)
          .join('');
        text = text.replace(
          new RegExp(`\\[${escapeRegExp(blank)}\\]`),
          `<select class='question_input' name='question_${question.id}_${vid}'>\n  <option value=''>\n    [ Select ]\n  </option>\n  ${options}\n</select>\n`,
        );
      }
    }
    if (question.type === 'calculated_question') {
      const pick = question.answers[(attempt - 1) % question.answers.length];
      question.answers = pick ? [pick] : [];
      for (const variable of pick?.variables ?? []) {
        text = text.replace(new RegExp(`\\[${escapeRegExp(variable.name)}\\]`, 'g'), roundIfWhole(variable.value));
      }
    }
    if (q.shuffle !== false && ['multiple_choice_question', 'multiple_answers_question'].includes(question.type)) {
      question.answers = shuffled(question.answers, random);
    }
    if (question.matches) question.matches = shuffled(question.matches, random);
    question.question_text = text;
    return question;
  });
}

// ---------------------------------------------------------------------------
// Censored question JSON (lib/api/v1/quiz_question.rb, quiz_submission_question.rb)
// ---------------------------------------------------------------------------

const ANSWERS_ALLOWED = new Set([
  'multiple_choice_question',
  'true_false_question',
  'multiple_answers_question',
  'matching_question',
  'multiple_dropdowns_question',
  'calculated_question',
]);
const ANSWER_ATTRS = ['id', 'text', 'html', 'blank_id', 'variables'];

/** Answer in the format AnswerSerializers#deserialize(full: true) returns. */
function deserialize(question, answers) {
  const value = answers[question.id];
  switch (question.type) {
    case 'multiple_choice_question':
    case 'true_false_question':
      return value ?? null;
    case 'multiple_answers_question':
      return value ?? [];
    case 'matching_question':
      return question.answers.map((a) => ({
        answer_id: a.id,
        match_id: value?.find((p) => p.answer_id === a.id)?.match_id ?? null,
      }));
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question':
      return Object.fromEntries(blanksOf(question).map((b) => [b, value?.[b] ?? null]));
    case 'file_upload_question':
      return value?.find((v) => v !== '' && v != null) ?? null;
    case 'text_only_question':
      return null;
    default:
      return value ?? null;
  }
}

function questionJson(q, question, rec) {
  const json = {
    id: question.id,
    quiz_id: q.id,
    position: question.position,
    quiz_group_id: null,
    assessment_question_id: `${question.id}7`,
    question_name: question.question_name,
    question_type: question.type,
    question_text: question.question_text,
    points_possible: Math.round((question.points ?? 0) * 100) / 100,
    matches: question.matches ? question.matches.map((m) => ({ match_id: m.match_id, text: m.text })) : null,
    formulas: question.formulas ?? null,
    variables: question.variables ?? null,
    answer_tolerance: question.type === 'calculated_question' ? (question.tolerance ?? 0) : null,
    formula_decimal_places: question.type === 'calculated_question' ? (question.decimals ?? 0) : null,
  };
  if (ANSWERS_ALLOWED.has(question.type)) {
    json.answers = question.answers.map((a) =>
      Object.fromEntries(ANSWER_ATTRS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
    );
  }
  if (completed(rec)) {
    json.flagged = false;
    const graded = rec.graded?.[question.id];
    if (graded) json.correct = graded.correct;
  } else {
    json.flagged = !!rec.flags[question.id];
    json.answer = deserialize(question, rec.answers);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Answer serializers (validation and storage)
// ---------------------------------------------------------------------------

const toInteger = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : null) : /^-?\d+$/.test(String(v ?? '')) ? Number(v) : null);
const MAX_TEXT = 16 * 1024;
const sanitizeText = (s) => String(s).replace(/<[^>]*>/g, '');

function toDecimalString(raw) {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return '0.0';
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** Returns { value } to merge, or { error } like SerializedAnswer#reject. */
function serialize(question, input, previous) {
  const ids = new Set(question.answers.map((a) => String(a.id)));
  switch (question.type) {
    case 'multiple_choice_question':
    case 'true_false_question': {
      const id = toInteger(input);
      if (id === null) return { error: 'answer must be of type Integer' };
      if (!ids.has(String(id))) return { error: `Unknown answer '${id}'` };
      return { value: String(id) };
    }
    case 'multiple_answers_question': {
      if (!Array.isArray(input)) return { error: 'answer must be of type Array' };
      const out = [];
      for (const raw of input) {
        const id = toInteger(raw);
        if (id === null) return { error: 'answer must be of type Integer' };
        if (!ids.has(String(id))) return { error: `Unknown answer '${id}'` };
        out.push(String(id));
      }
      // Stored per answer as "1"/"0" by Canvas; deserialized in answer order.
      return { value: question.answers.map((a) => String(a.id)).filter((id) => out.includes(id)) };
    }
    case 'matching_question': {
      if (!Array.isArray(input)) return { error: 'answer must be of type Array' };
      const matchIds = new Set((question.matches ?? []).map((m) => String(m.match_id)));
      const merged = [...(previous ?? [])];
      for (const [index, entry] of input.entries()) {
        if (!entry || typeof entry !== 'object') return { error: `answer[${index}] must be of type Hash` };
        for (const param of ['answer_id', 'match_id'])
          if (!(param in entry)) return { error: `Matching pair is missing parameter "${param}"` };
        const answerId = toInteger(entry.answer_id);
        if (answerId === null) return { error: 'answer_id must be of type Integer' };
        if (!ids.has(String(answerId))) return { error: `Unknown answer '${answerId}'` };
        const matchId = toInteger(entry.match_id);
        if (matchId === null) return { error: 'match_id must be of type Integer' };
        if (!matchIds.has(String(matchId))) return { error: `Unknown match '${matchId}'` };
        const at = merged.findIndex((p) => p.answer_id === String(answerId));
        const pair = { answer_id: String(answerId), match_id: String(matchId) };
        if (at >= 0) merged[at] = pair;
        else merged.push(pair);
      }
      return { value: merged };
    }
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question': {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'answer must be of type Hash' };
      const blanks = new Set(blanksOf(question));
      const merged = { ...(previous ?? {}) };
      for (const [blank, raw] of Object.entries(input)) {
        if (!blanks.has(blank)) return { error: `Unknown blank '${blank}'` };
        if (question.type === 'multiple_dropdowns_question') {
          const id = toInteger(raw);
          if (id === null) return { error: `answer.${blank} must be of type Integer` };
          if (!question.answers.some((a) => a.blank_id === blank && String(a.id) === String(id)))
            return { error: `Unknown answer '${id}'` };
          merged[blank] = String(id);
        } else {
          if (typeof raw !== 'string') return { error: `${blank}.answer must be of type String` };
          if (raw.length >= MAX_TEXT) return { error: 'Text is too long.' };
          merged[blank] = sanitizeText(raw);
        }
      }
      return { value: merged };
    }
    case 'short_answer_question':
      if (typeof input !== 'string') return { error: 'answer must be of type String' };
      if (input.length >= MAX_TEXT) return { error: 'Text is too long.' };
      return { value: sanitizeText(input) || null };
    case 'essay_question':
      if (typeof input !== 'string') return { error: 'answer must be of type String' };
      if (input.length >= MAX_TEXT) return { error: 'Text is too long.' };
      return { value: input.replace(/<script[\s\S]*?<\/script>/gi, '') || null };
    case 'numerical_question':
    case 'calculated_question':
      if (input === null || input === undefined || (Array.isArray(input) && input.length === 0)) return { value: null };
      return { value: toDecimalString(input) };
    case 'file_upload_question':
      return { value: (Array.isArray(input) ? input : [input]).map((v) => (v == null ? '' : String(v))) };
    default:
      return { value: null };
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function sigRound(n, digits) {
  if (n === 0) return 0;
  const scale = 10 ** (digits - Math.ceil(Math.log10(Math.abs(n))));
  return Math.round(n * scale) / scale;
}

/** Fraction of the question's points earned, or null when it needs an instructor. */
function fractionFor(question, value) {
  const correctIds = question.answers.filter((a) => a.weight === 100).map((a) => String(a.id));
  switch (question.type) {
    case 'multiple_choice_question':
    case 'true_false_question':
      return value && correctIds.includes(String(value)) ? 1 : 0;
    case 'multiple_answers_question': {
      const chosen = value ?? [];
      const right = chosen.filter((id) => correctIds.includes(id)).length;
      const wrong = chosen.length - right;
      return correctIds.length ? Math.max(0, (right - wrong) / correctIds.length) : 0;
    }
    case 'matching_question': {
      const pairs = question.answers.map((a) => value?.find((p) => p.answer_id === a.id)?.match_id === a.match_id);
      return pairs.filter(Boolean).length / question.answers.length;
    }
    case 'multiple_dropdowns_question': {
      const blanks = blanksOf(question);
      const right = blanks.filter((b) =>
        question.answers.some((a) => a.blank_id === b && a.weight === 100 && String(a.id) === String(value?.[b])),
      );
      return right.length / blanks.length;
    }
    case 'fill_in_multiple_blanks_question': {
      const blanks = blanksOf(question);
      const right = blanks.filter((b) =>
        question.answers.some((a) => a.blank_id === b && a.weight === 100 && norm(a.text) === norm(value?.[b])),
      );
      return right.length / blanks.length;
    }
    case 'short_answer_question':
      return question.answers.some((a) => norm(a.text) === norm(value)) ? 1 : 0;
    case 'numerical_question': {
      if (value == null) return 0;
      const n = Number(value);
      return question.answers.some((a) => {
        if (a.numerical_answer_type === 'range_answer') return n >= a.start && n <= a.end;
        if (a.numerical_answer_type === 'precision_answer') return sigRound(n, a.precision) === sigRound(a.approximate, a.precision);
        return Math.abs(n - a.exact) <= (a.margin ?? 0);
      })
        ? 1
        : 0;
    }
    case 'calculated_question': {
      if (value == null) return 0;
      const target = question.answers[0]?.answer ?? 0;
      return Math.abs(Number(value) - target) <= (question.tolerance ?? 0) ? 1 : 0;
    }
    case 'essay_question':
    case 'file_upload_question':
      return null;
    default:
      return null;
  }
}

function grade(q, rec) {
  const graded = {};
  let score = 0;
  let pending = false;
  for (const question of rec.quizData) {
    if (question.type === 'text_only_question') continue;
    const value = deserialize(question, rec.answers);
    // Surveys: any answer earns the (zero) points; nothing to review.
    if (q.type === 'survey' || q.type === 'graded_survey') {
      graded[question.id] = { correct: 'undefined', points: 0 };
      continue;
    }
    const fraction = fractionFor(question, value);
    if (fraction === null) {
      pending = true;
      graded[question.id] = { correct: 'undefined', points: 0 };
      continue;
    }
    const points = fraction * (question.points ?? 0);
    score += points;
    graded[question.id] = {
      correct: fraction === 1 ? true : fraction === 0 ? false : 'partial',
      points: Math.round(points * 100) / 100,
    };
  }
  return { graded, score: Math.round(score * 100) / 100, pending };
}

function finish(q, rec, when = new Date().toISOString()) {
  const { graded, score, pending } = grade(q, rec);
  rec.graded = graded;
  rec.score = score;
  rec.finished = when;
  rec.workflow = pending ? 'pending_review' : 'complete';
}

// ---------------------------------------------------------------------------
// Takeability (QuizSubmissionService#assert_takeability!, QuizEligibility)
// ---------------------------------------------------------------------------

/** Locked by dates or by its module (course-content.mjs registers the module check). */
function quizLock(q) {
  if (isFuture(q.unlock))
    return {
      locked_for_user: true,
      lock_info: { asset_string: `quizzes:quiz_${q.id}`, unlock_at: q.unlock },
      lock_explanation: `This quiz is locked until ${canvasDate(q.unlock)}.`,
    };
  if (isPast(q.lock))
    return {
      locked_for_user: true,
      lock_info: { asset_string: `quizzes:quiz_${q.id}`, lock_at: q.lock },
      lock_explanation: `This quiz was locked ${canvasDate(q.lock)}.`,
    };
  const moduleLock = globalThis.__easelFakeModules?.lockForContent?.(q.course, 'Quiz', q.id);
  if (moduleLock) return { ...moduleLock, lock_explanation: moduleLock.lock_explanation('quiz') };
  return { locked_for_user: false, lock_info: null, lock_explanation: null };
}

const ldbRejection = (q) => (q.lockdown ? reject('this quiz requires the lockdown browser', 403) : null);

/** Every request that changes an attempt runs these checks, in Canvas's order. */
function takeability(q, accessCode) {
  if (q.oneAtATime) return reject('that type of quizzes is not supported yet', 501);
  if (q.accessCode && accessCode !== q.code) return reject('invalid access code', 403);
  if (q.ipFilter) return reject('IP address denied', 403);
  if (quizLock(q).locked_for_user) return reject('quiz is locked', 400);
  return null;
}

function checkAttempt(rec, params) {
  if (rec.token !== params.validation_token) return reject('invalid token', 403);
  const attempt = toInteger(params.attempt);
  if (attempt === null) return reject('invalid attempt', 400);
  if (attempt !== rec.attempt) return reject(`attempt ${attempt} can not be modified`, 400);
  return null;
}

// ---------------------------------------------------------------------------
// Quiz JSON (app/serializers/quizzes/quiz_serializer.rb)
// ---------------------------------------------------------------------------

function quizJson(q) {
  const html = `${BASE}/courses/${q.course}/quizzes/${q.id}`;
  return {
    id: q.id,
    title: q.title,
    html_url: html,
    mobile_url: `${html}?force_user=1&persist_headless=1`,
    description: q.description,
    quiz_type: q.type,
    time_limit: q.timeLimit ?? null,
    timer_autosubmit_disabled: q.timerAutosubmitDisabled ?? false,
    shuffle_answers: q.shuffle ?? true,
    show_correct_answers: q.showCorrect ?? true,
    show_correct_answers_at: q.showCorrectAt ?? null,
    hide_correct_answers_at: q.hideCorrectAt ?? null,
    show_correct_answers_last_attempt: q.showCorrectLastAttempt ?? false,
    scoring_policy: q.scoring ?? 'keep_highest',
    allowed_attempts: q.attempts,
    one_question_at_a_time: q.oneAtATime ?? false,
    question_count: countOf(q),
    points_possible: pointsOf(q),
    cant_go_back: q.oneAtATime ?? false,
    access_code: null,
    has_access_code: q.accessCode ?? false,
    ip_filter: q.ipFilter ?? null,
    due_at: q.due ?? null,
    lock_at: q.lock ?? null,
    unlock_at: q.unlock ?? null,
    published: true,
    hide_results: q.hideResults ?? null,
    assignment_id: q.assignment ?? null,
    require_lockdown_browser: q.lockdown ?? false,
    require_lockdown_browser_for_results: false,
    one_time_results: q.oneTimeResults ?? false,
    only_visible_to_overrides: false,
    anonymous_submissions: q.type === 'survey',
    permissions: {
      read: true,
      submit: true,
      create: false,
      manage: false,
      read_statistics: false,
      update: false,
    },
    ...quizLock(q),
  };
}

/** For course-content.mjs: the fixture plus every completed attempt, in fixture `taken` shape. */
function quizById(courseId, id) {
  const q = fixtureById(courseId, id);
  if (!q) return undefined;
  const taken = attemptsOf(q)
    .filter(completed)
    .map((r) => ({ attempt: r.attempt, score: r.score, started: r.started, finished: r.finished }));
  return { ...q, points: pointsOf(q), questions: countOf(q), taken };
}

state.api = { quizById, quizJson };

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

const withQuiz = (handler) => (ctx) => {
  const q = fixtureById(ctx.params.courseId, ctx.params.quizId);
  if (!q) return notFound();
  return handler(q, ctx);
};

/** The quiz submission named in the path, by its (stable) ID. */
function bySubmissionId(id) {
  const q = quizzes.find((x) => submissionId(x) === String(id));
  if (!q || !latestOf(q)) return null;
  return q;
}

const params = ({ body, query }) => ({ ...(query ?? {}), ...(body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {}) });

function start(q, ctx) {
  const p = params(ctx);
  const ldb = ldbRejection(q);
  if (ldb) return ldb;
  // QuizSubmissionsApiController#create: module_locked? (also covers dates).
  if (quizLock(q).locked_for_user) return reject('you are not allowed to participate in this quiz', 400);
  const blocked = takeability(q, p.access_code);
  if (blocked) return blocked;
  settle(q);
  const latest = latestOf(q);
  if (latest && !(completed(latest) && (q.attempts < 0 || attemptsLeft(q, latest) > 0)))
    return reject('a quiz submission already exists', 409);
  const attempt = (latest?.attempt ?? 0) + 1;
  const started = new Date();
  let endAt = q.timeLimit ? new Date(started.getTime() + q.timeLimit * 60_000) : null;
  if (q.lock && (!endAt || Date.parse(q.lock) < endAt.getTime())) endAt = new Date(q.lock);
  const rec = {
    attempt,
    started: started.toISOString(),
    finished: null,
    endAt: endAt ? endAt.toISOString() : null,
    score: null,
    workflow: 'untaken',
    token: token(),
    quizData: buildQuizData(q, attempt),
    answers: {},
    flags: {},
    graded: null,
    events: [{ id: String(state.nextId++), event_type: 'submission_created', event_data: null, created_at: started.toISOString() }],
    webPosition: 0,
  };
  attemptsOf(q).push(rec);
  return { quiz_submissions: [submissionJson(q, rec)] };
}

function index(q) {
  settle(q);
  const all = attemptsOf(q);
  const latest = all.at(-1);
  // An attempt in progress is the only one listed; otherwise every finished attempt.
  const list = latest && untaken(latest) ? [latest] : all.filter(completed);
  return { quiz_submissions: list.map((r) => submissionJson(q, r)) };
}

function show(q, ctx) {
  if (ctx.params.submissionId !== submissionId(q) || !latestOf(q)) return notFound();
  settle(q);
  return { quiz_submissions: [submissionJson(q, latestOf(q))] };
}

function time(q, ctx) {
  if (ctx.params.submissionId !== submissionId(q) || !latestOf(q)) return notFound();
  const rec = latestOf(q);
  return {
    end_at: rec.endAt,
    time_left: rec.endAt ? Math.round((Date.parse(rec.endAt) - Date.now()) / 1000) : null,
  };
}

function complete(q, ctx) {
  if (ctx.params.submissionId !== submissionId(q) || !latestOf(q)) return notFound();
  const p = params(ctx);
  const ldb = ldbRejection(q);
  if (ldb) return ldb;
  const blocked = takeability(q, p.access_code);
  if (blocked) return blocked;
  const rec = latestOf(q);
  if (rec.token !== p.validation_token) return reject('invalid token', 403);
  if (!untaken(rec)) return reject('quiz submission is already complete', 400);
  const bad = checkAttempt(rec, p);
  if (bad) return bad;
  finish(q, rec);
  return { quiz_submissions: [submissionJson(q, rec)] };
}

function postEvents(q, ctx) {
  if (ctx.params.submissionId !== submissionId(q) || !latestOf(q)) return notFound();
  const rec = latestOf(q);
  const events = params(ctx).quiz_submission_events;
  for (const datum of Array.isArray(events) ? events : []) {
    rec.events.push({
      id: String(state.nextId++),
      event_type: datum?.event_type ?? null,
      event_data: datum?.event_data ?? null,
      client_timestamp: datum?.client_timestamp ?? null,
      created_at: new Date().toISOString(),
    });
  }
  return { status: 204, body: '', headers: {} };
}

/** Canvas only lets instructors read the log (view_log); the fake serves it for checking. */
function getEvents(q, ctx) {
  if (ctx.params.submissionId !== submissionId(q) || !latestOf(q)) return notFound();
  const n = toInteger(ctx.query.attempt);
  const rec = n ? attemptsOf(q).find((r) => r.attempt === n) : latestOf(q);
  if (!rec) return notFound();
  return {
    quiz_submission_events: rec.events.map(({ id, event_type, event_data, created_at }) => ({
      id,
      event_type,
      event_data,
      created_at,
    })),
  };
}

function questionsIndex(ctx) {
  const q = bySubmissionId(ctx.params.submissionId);
  if (!q) return notFound();
  settle(q);
  if (q.oneAtATime) return reject('Cannot receive one question at a time questions in the API', 401);
  const n = toInteger(ctx.query.quiz_submission_attempt);
  const rec = n ? attemptsOf(q).find((r) => r.attempt === n) : latestOf(q);
  if (!rec) return { status: 404, body: { errors: [{ message: 'Unable to find a submission with that attempt' }] } };
  if (completed(rec) && !resultsVisible(q, rec)) return reject('Cannot view questions due to quiz settings', 401);
  return { quiz_submission_questions: rec.quizData.map((question) => questionJson(q, question, rec)) };
}

/** Shared checks for answering and flagging (QuizSubmissionService#update_question). */
function updateGuard(q, rec, p) {
  const ldb = ldbRejection(q);
  if (ldb) return ldb;
  if (completed(rec)) return reject('quiz submission is already complete', 400);
  if (overdue(rec)) return reject('quiz submission is overdue', 400);
  return takeability(q, p.access_code) ?? checkAttempt(rec, p);
}

function answer(ctx) {
  const q = bySubmissionId(ctx.params.submissionId);
  if (!q) return notFound();
  const rec = latestOf(q);
  const p = params(ctx);
  const list = Array.isArray(p.quiz_questions) ? p.quiz_questions : [];
  // Canvas serializes every answer before saving any.
  const changes = [];
  for (const entry of list) {
    if (entry?.id === undefined || entry?.id === null || entry?.id === '') continue;
    const question = rec.quizData.find((x) => x.id === String(entry.id));
    if (!question) continue;
    const result = serialize(question, entry.answer ?? [], rec.answers[question.id]);
    if (result.error) return reject(result.error, 400);
    changes.push([question, result.value]);
  }
  const blocked = updateGuard(q, rec, p);
  if (blocked) return blocked;
  for (const [question, value] of changes) {
    rec.answers[question.id] = value;
  }
  return {
    quiz_submission_questions: changes.map(([question]) => questionJson(q, question, rec)),
  };
}

const flagger = (flagged) => (ctx) => {
  const q = bySubmissionId(ctx.params.submissionId);
  if (!q) return notFound();
  const rec = latestOf(q);
  const question = rec.quizData.find((x) => x.id === ctx.params.questionId);
  if (!question) return notFound();
  const blocked = updateGuard(q, rec, params(ctx));
  if (blocked) return blocked;
  rec.flags[question.id] = flagged;
  return { quiz_submission_questions: [questionJson(q, question, rec)] };
};

// Quiz file uploads (quiz_submission_files_controller.rb)

function filePreflight(q, ctx) {
  if (!latestOf(q)) return notFound();
  const p = params(ctx);
  if (!p.name) return { status: 400, body: { errors: [{ message: 'name is required' }] } };
  const uploadToken = `qu${state.nextId++}`;
  state.uploads.set(uploadToken, { name: String(p.name), type: p.content_type || 'application/octet-stream' });
  return {
    attachments: [
      {
        upload_url: `${BASE}/fake/quiz-upload/${uploadToken}`,
        upload_params: { filename: String(p.name), content_type: p.content_type || 'application/octet-stream' },
        file_param: 'file',
      },
    ],
  };
}

function uploadBytes({ params: route, body, req }) {
  const pending = state.uploads.get(route.token);
  if (!pending) return notFound();
  state.uploads.delete(route.token);
  const raw = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] ?? '')?.[1];
  let bytes = raw;
  if (boundary) {
    const text = raw.toString('latin1');
    const part = text.split(`--${boundary}`).find((p) => /name="file"/.test(p));
    if (part) {
      const begin = part.indexOf('\r\n\r\n') + 4;
      bytes = Buffer.from(part.slice(begin, part.lastIndexOf('\r\n')), 'latin1');
    }
  }
  const id = String(9900 + state.nextId++);
  const file = { id, name: pending.name, type: pending.type, bytes, created: new Date().toISOString() };
  state.files.set(id, file);
  return { status: 201, body: attachmentJson(file) };
}

function attachmentJson(f) {
  const url = `${BASE}/fake/quiz-files/${f.id}/${encodeURIComponent(f.name)}`;
  return {
    id: f.id,
    uuid: `quizfile${f.id}`,
    folder_id: null,
    display_name: f.name,
    filename: f.name.replace(/\s+/g, '+'),
    upload_status: 'success',
    'content-type': f.type,
    url,
    size: f.bytes.length,
    created_at: f.created,
    updated_at: f.created,
    unlock_at: null,
    locked: false,
    hidden: false,
    lock_at: null,
    hidden_for_user: false,
    thumbnail_url: null,
    modified_at: f.created,
    mime_class: f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'pdf' : 'file',
    media_entry_id: null,
    category: 'uncategorized',
    locked_for_user: false,
  };
}

function quizFile({ params: route }) {
  const f = state.files.get(route.fileId);
  if (!f) return notFound();
  return {
    status: 200,
    body: f.bytes,
    headers: {
      'Content-Type': f.type,
      'Content-Disposition': `inline; filename="${f.name.replace(/"/g, '')}"`,
    },
  };
}

// ---------------------------------------------------------------------------
// Web pages (the app's fallback for quizzes the API can't take)
// ---------------------------------------------------------------------------

const html = (body, status = 200, headers = {}) => ({
  status,
  body,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const redirect = (location) => ({ status: 302, body: '', headers: { Location: location } });

function page(title, content, { script = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f5; --card: #fff; --fg: #2d3b45; --muted: #6b7780; --line: #d7dade; --brand: #0b6fb5; --warn: #fff4e5; --warn-fg: #8a4b00; --ok: #0b874b; --bad: #c4291c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111417; --card: #1c2126; --fg: #e8ecef; --muted: #a2adb6; --line: #2f363d; --brand: #5aa9e6; --warn: #3a2a12; --warn-fg: #f6c37a; --ok: #4cc38a; --bad: #ff7b6e; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  header { background: #394b58; color: #fff; padding: 12px 16px; font-weight: 600; }
  main { max-width: 720px; margin: 0 auto; padding: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; } h2 { font-size: 18px; margin: 0 0 8px; }
  .muted { color: var(--muted); } .warn { background: var(--warn); color: var(--warn-fg); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
  .btn { display: inline-block; background: var(--brand); color: #fff; border: 0; border-radius: 6px; padding: 12px 18px; font: inherit; font-weight: 600; text-decoration: none; min-height: 44px; cursor: pointer; }
  .btn.secondary { background: transparent; color: var(--brand); border: 1px solid var(--line); }
  label.choice { display: flex; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--line); border-radius: 6px; margin: 8px 0; min-height: 44px; }
  input[type=text], input[type=number], textarea, select { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
  textarea { width: 100%; min-height: 120px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; } dt { color: var(--muted); }
  .timer { position: sticky; top: 0; background: var(--card); border-bottom: 1px solid var(--line); padding: 8px 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
</style></head><body><header>Canvas</header>${content}${script ? `<script>${script}</script>` : ''}</body></html>`;
}

function facts(q) {
  const rows = [
    ['Due', q.due ? canvasDate(q.due) : 'No due date'],
    ['Points', String(pointsOf(q))],
    ['Questions', String(countOf(q))],
    ['Time limit', q.timeLimit ? `${q.timeLimit} minutes` : 'None'],
    ['Allowed attempts', q.attempts < 0 ? 'Unlimited' : String(q.attempts)],
  ];
  return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

const ldbPage = (q) =>
  page(
    q.title,
    `<main><div class="card"><h1>${escapeHtml(q.title)}</h1>
     <div class="warn"><strong>This quiz requires Respondus LockDown Browser.</strong> Open LockDown Browser,
     sign in to Canvas there, and start the quiz from that browser. It can't be taken in a regular browser.</div>
     ${facts(q)}</div></main>`,
  );

function quizPage(q) {
  settle(q);
  const lock = quizLock(q);
  const latest = latestOf(q);
  const inProgress = latest && untaken(latest);
  const left = latest ? attemptsLeft(q, latest) : q.attempts;
  let action = `<a class="btn" href="/courses/${q.course}/quizzes/${q.id}/take">${inProgress ? 'Resume Quiz' : latest ? 'Take the Quiz Again' : 'Take the Quiz'}</a>`;
  if (lock.locked_for_user) action = `<p class="warn">${lock.lock_explanation}</p>`;
  else if (q.lockdown)
    action = `<div class="warn"><strong>Requires Respondus LockDown Browser.</strong> Open this quiz in LockDown Browser to take it.</div>`;
  else if (!inProgress && left === 0) action = '<p class="muted">You have no attempts left.</p>';
  const history = attemptsOf(q).filter(completed);
  return page(
    q.title,
    `<main><div class="card"><h1>${escapeHtml(q.title)}</h1>${facts(q)}</div>
     <div class="card">${q.description ?? ''}</div>
     <div class="card">${action}
     ${history.length ? `<p><a href="/courses/${q.course}/quizzes/${q.id}/history">See your results</a></p>` : ''}</div></main>`,
  );
}

const webAccess = (globalThis.__easelFakeQuizWeb ??= { codes: {}, notices: {} });

function webInput(question, rec) {
  const value = deserialize(question, rec.answers);
  const name = `answer_${question.id}`;
  switch (question.type) {
    case 'multiple_choice_question':
    case 'true_false_question':
      return question.answers
        .map((a) => `<label class="choice"><input type="radio" name="${name}" value="${a.id}" ${String(value) === a.id ? 'checked' : ''} /> ${a.html || escapeHtml(a.text)}</label>`)
        .join('');
    case 'multiple_answers_question':
      return question.answers
        .map((a) => `<label class="choice"><input type="checkbox" name="${name}_${a.id}" ${value.includes(a.id) ? 'checked' : ''} /> ${escapeHtml(a.text)}</label>`)
        .join('');
    case 'matching_question':
      return question.answers
        .map((a) => {
          const chosen = value.find((p) => p.answer_id === a.id)?.match_id;
          const options = question.matches
            .map((m) => `<option value="${m.match_id}" ${chosen === m.match_id ? 'selected' : ''}>${escapeHtml(m.text)}</option>`)
            .join('');
          return `<p>${escapeHtml(a.text)} <select name="match_${question.id}_${a.id}"><option value="">[ Choose ]</option>${options}</select></p>`;
        })
        .join('');
    case 'essay_question':
      return `<textarea name="${name}">${escapeHtml(value ?? '')}</textarea>`;
    case 'file_upload_question':
      return '<p class="muted">File uploads aren’t available on this page.</p>';
    case 'text_only_question':
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question':
      return '';
    default:
      return `<input type="text" name="${name}" value="${escapeHtml(value ?? '')}" />`;
  }
}

/** Question text with Canvas's own inline inputs filled in. */
function webQuestionText(question, rec) {
  const value = deserialize(question, rec.answers);
  let text = question.question_text;
  if (question.type === 'fill_in_multiple_blanks_question') {
    for (const blank of blanksOf(question)) {
      text = text.replace(`{{question_${question.id}_${variableId(blank)}}}`, escapeHtml(value[blank] ?? ''));
    }
  }
  if (question.type === 'multiple_dropdowns_question') {
    for (const blank of blanksOf(question)) {
      if (value[blank]) text = text.replace(`<option value='${value[blank]}'>`, `<option value='${value[blank]}' selected>`);
    }
  }
  return text;
}

function readWebAnswers(rec, questions, body) {
  for (const question of questions) {
    const name = `answer_${question.id}`;
    const fields = body ?? {};
    let input;
    switch (question.type) {
      case 'multiple_choice_question':
      case 'true_false_question':
        input = fields[name];
        break;
      case 'multiple_answers_question':
        input = question.answers.filter((a) => fields[`${name}_${a.id}`]).map((a) => a.id);
        break;
      case 'matching_question':
        input = question.answers
          .filter((a) => fields[`match_${question.id}_${a.id}`])
          .map((a) => ({ answer_id: a.id, match_id: fields[`match_${question.id}_${a.id}`] }));
        break;
      case 'multiple_dropdowns_question':
      case 'fill_in_multiple_blanks_question':
        input = Object.fromEntries(
          blanksOf(question)
            .map((b) => [b, fields[`question_${question.id}_${variableId(b)}`]])
            .filter(([, v]) => v !== undefined && v !== ''),
        );
        break;
      case 'text_only_question':
      case 'file_upload_question':
        continue;
      default:
        input = fields[name];
    }
    if (input === undefined || input === '' || (Array.isArray(input) && !input.length && question.type !== 'multiple_answers_question'))
      continue;
    const result = serialize(question, input, rec.answers[question.id]);
    if (!result.error) rec.answers[question.id] = result.value;
  }
}

function takeGate(q) {
  if (q.lockdown) return html(ldbPage(q));
  const lock = quizLock(q);
  if (lock.locked_for_user)
    return html(page(q.title, `<main><div class="card"><h1>${escapeHtml(q.title)}</h1><p class="warn">${lock.lock_explanation}</p></div></main>`));
  if (q.ipFilter)
    return html(
      page(
        q.title,
        `<main><div class="card"><h1>${escapeHtml(q.title)}</h1><div class="warn">This quiz is protected and is only available from certain locations.
         The computer you are currently using does not appear to be at a valid location for taking this quiz.</div></div></main>`,
      ),
      403,
    );
  if (q.accessCode && webAccess.codes[key(q)] !== q.code)
    return html(
      page(
        q.title,
        `<main><div class="card"><h1>${escapeHtml(q.title)}</h1>
         ${webAccess.notices[key(q)] ? `<p class="bad">${webAccess.notices[key(q)]}</p>` : ''}
         <form method="post" action="/courses/${q.course}/quizzes/${q.id}/take"><p><label>Access code<br />
         <input type="text" name="access_code" autocomplete="off" autocapitalize="off" /></label></p>
         <button class="btn" type="submit">Continue</button></form></div></main>`,
      ),
    );
  return null;
}

function takePage(q, ctx) {
  const gate = takeGate(q);
  if (gate) return gate;
  settle(q);
  let rec = latestOf(q);
  if (!rec || !untaken(rec)) {
    if (rec && !(q.attempts < 0 || attemptsLeft(q, rec) > 0))
      return html(page(q.title, `<main><div class="card"><h1>${escapeHtml(q.title)}</h1><p>You have no attempts left.</p></div></main>`));
    // The web takes any quiz, including ones the API refuses.
    const result = start({ ...q, oneAtATime: false, accessCode: false, ipFilter: null }, { body: {}, query: {} });
    if (result.status) return html(page(q.title, `<main><div class="card"><p>${escapeHtml(result.body.message)}</p></div></main>`), result.status);
    rec = latestOf(q);
  }
  const questions = rec.quizData;
  const real = questions.filter((x) => x.type !== 'text_only_question');
  const notice = webAccess.notices[key(q)];
  webAccess.notices[key(q)] = null;
  const timer = rec.endAt
    ? `<div class="timer" id="timer" data-end="${rec.endAt}">Time left</div>`
    : '';
  const script = rec.endAt
    ? `(function () {
        var el = document.getElementById('timer'); var end = Date.parse(el.dataset.end);
        function tick() {
          var s = Math.max(0, Math.round((end - Date.now()) / 1000));
          el.textContent = 'Time left: ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
          if (s === 0) { var f = document.getElementById('quiz'); var i = document.createElement('input'); i.type = 'hidden'; i.name = 'action'; i.value = 'submit'; f.appendChild(i); f.submit(); return; }
          setTimeout(tick, 1000);
        }
        tick();
      })();`
    : '';
  const action = `/courses/${q.course}/quizzes/${q.id}/take`;
  if (q.oneAtATime) {
    const requested = toInteger(ctx.query.question);
    let index = rec.webPosition ?? 0;
    let back = '';
    if (requested !== null && requested - 1 < index && q.oneAtATime)
      back = '<p class="warn">You can’t go back to earlier questions in this quiz.</p>';
    else if (requested !== null && requested - 1 > index) index = rec.webPosition;
    const question = real[index];
    const last = index >= real.length - 1;
    return html(
      page(
        q.title,
        `${timer}<main>${notice ? `<p class="warn">${notice}</p>` : ''}${back}
         <form id="quiz" method="post" action="${action}"><div class="card">
         <h2>${question.question_name} <span class="muted">of ${real.length}</span></h2>
         ${webQuestionText(question, rec)}${webInput(question, rec)}</div>
         <input type="hidden" name="question_id" value="${question.id}" />
         <p class="muted">This quiz shows one question at a time. Once you move on, you can’t come back.</p>
         <button class="btn" type="submit" name="action" value="${last ? 'submit' : 'next'}">${last ? 'Submit Quiz' : 'Next'}</button>
         </form></main>`,
        { script },
      ),
    );
  }
  return html(
    page(
      q.title,
      `${timer}<main><form id="quiz" method="post" action="${action}">
       ${questions
         .map(
           (question) =>
             `<div class="card"><h2>${question.question_name}</h2>${webQuestionText(question, rec)}${webInput(question, rec)}</div>`,
         )
         .join('')}
       <button class="btn" type="submit" name="action" value="submit">Submit Quiz</button></form></main>`,
      { script },
    ),
  );
}

function takePost(q, ctx) {
  const body = ctx.body && typeof ctx.body === 'object' && !Buffer.isBuffer(ctx.body) ? ctx.body : {};
  const here = `/courses/${q.course}/quizzes/${q.id}/take`;
  if (body.access_code !== undefined) {
    if (String(body.access_code).trim() === q.code) webAccess.codes[key(q)] = q.code;
    else webAccess.notices[key(q)] = 'That access code isn’t right. Check it with your instructor.';
    return redirect(here);
  }
  const gate = takeGate(q);
  if (gate) return gate;
  const rec = latestOf(q);
  if (!rec || !untaken(rec)) return redirect(here);
  if (q.oneAtATime) {
    const real = rec.quizData.filter((x) => x.type !== 'text_only_question');
    const current = real[rec.webPosition ?? 0];
    if (body.question_id === current?.id) readWebAnswers(rec, [current], body);
    rec.webPosition = Math.min((rec.webPosition ?? 0) + 1, real.length - 1);
  } else {
    readWebAnswers(rec, rec.quizData, body);
  }
  if (body.action === 'submit' || overdue(rec)) {
    finish(q, rec);
    return redirect(`/courses/${q.course}/quizzes/${q.id}/history`);
  }
  return redirect(here);
}

function historyPage(q, ctx) {
  settle(q);
  const done = attemptsOf(q).filter(completed);
  const version = toInteger(ctx.query.version);
  const rec = (version && done.find((r) => r.attempt === version)) || done.at(-1);
  if (!rec)
    return html(page(q.title, `<main><div class="card"><h1>${escapeHtml(q.title)}</h1><p>You haven’t taken this quiz yet.</p></div></main>`));
  rec.seenResults = true;
  const rows = rec.quizData
    .filter((x) => x.type !== 'text_only_question')
    .map((question) => {
      const g = rec.graded?.[question.id];
      const mark =
        g?.correct === true
          ? '<span class="ok">Correct</span>'
          : g?.correct === 'partial'
            ? '<span class="muted">Partly correct</span>'
            : g?.correct === 'undefined'
              ? '<span class="muted">Waiting for your instructor</span>'
              : '<span class="bad">Incorrect</span>';
      return `<div class="card"><h2>${question.question_name}</h2>${question.question_text}<p>${mark}${g ? ` · ${g.points} / ${Math.round((question.points ?? 0) * 100) / 100} pts` : ''}</p></div>`;
    })
    .join('');
  return html(
    page(
      `${q.title}: results`,
      `<main><div class="card"><h1>${escapeHtml(q.title)}</h1>
       <p><strong>Score for attempt ${rec.attempt}:</strong> ${rec.score ?? 0} out of ${pointsOf(q)}${rec.workflow === 'pending_review' ? ' (some questions still need grading)' : ''}</p>
       <p class="muted">Submitted ${canvasDate(rec.finished)}</p>
       <a class="btn secondary" href="/courses/${q.course}/quizzes/${q.id}">Back to the quiz</a></div>${rows}</main>`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const api = '/api/v1/courses/:courseId/quizzes';

export const routes = [
  {
    path: api,
    handler: ({ params: p, query, url }) =>
      courseById(p.courseId)
        ? paginate(quizzes.filter((q) => q.course === p.courseId).map(quizJson), query, url)
        : notFound(),
  },
  { path: `${api}/:quizId`, handler: withQuiz((q) => quizJson(q)) },
  // A student sees only their own quiz submissions.
  { path: `${api}/:quizId/submissions`, handler: withQuiz(index) },
  { path: `${api}/:quizId/submissions`, method: 'POST', handler: withQuiz(start) },
  {
    path: `${api}/:quizId/submission`,
    handler: withQuiz((q) => {
      settle(q);
      const rec = latestOf(q);
      return { quiz_submissions: rec ? [submissionJson(q, rec)] : [] };
    }),
  },
  { path: `${api}/:quizId/submissions/self/files`, method: 'POST', handler: withQuiz(filePreflight) },
  { path: `${api}/:quizId/submissions/:submissionId`, handler: withQuiz(show) },
  { path: `${api}/:quizId/submissions/:submissionId/time`, handler: withQuiz(time) },
  { path: `${api}/:quizId/submissions/:submissionId/complete`, method: 'POST', handler: withQuiz(complete) },
  { path: `${api}/:quizId/submissions/:submissionId/events`, method: 'POST', handler: withQuiz(postEvents) },
  { path: `${api}/:quizId/submissions/:submissionId/events`, handler: withQuiz(getEvents) },
  { path: '/api/v1/quiz_submissions/:submissionId/questions', handler: questionsIndex },
  {
    path: '/api/v1/quiz_submissions/:submissionId/questions',
    method: 'POST',
    // With answers "down" (POST /fake/quizzes/answers-down), the connection drops like a lost network.
    handler: (ctx) => {
      if (!state.answersDown) return answer(ctx);
      ctx.req.socket.destroy();
      return new Promise(() => {});
    },
  },
  { path: '/api/v1/quiz_submissions/:submissionId/questions/:questionId/flag', method: 'PUT', handler: flagger(true) },
  { path: '/api/v1/quiz_submissions/:submissionId/questions/:questionId/unflag', method: 'PUT', handler: flagger(false) },
  { path: '/fake/quiz-upload/:token', method: 'POST', public: true, handler: uploadBytes },
  { path: '/fake/quiz-files/:fileId/:name', public: true, handler: quizFile },
  ...['down', 'up'].map((mode) => ({
    path: `/fake/quizzes/answers-${mode}`,
    method: 'POST',
    public: true,
    handler: () => {
      state.answersDown = mode === 'down';
      return { status: 204, body: '', headers: {} };
    },
  })),
  {
    path: '/fake/quizzes/reset',
    method: 'POST',
    public: true,
    handler: () => {
      state.attempts = {};
      webAccess.codes = {};
      webAccess.notices = {};
      return { status: 204, body: '', headers: {} };
    },
  },
  // Web pages
  { path: '/courses/:courseId/quizzes/:quizId', public: true, handler: withQuiz((q) => html(quizPage(q))) },
  { path: '/courses/:courseId/quizzes/:quizId/take', public: true, handler: withQuiz(takePage) },
  { path: '/courses/:courseId/quizzes/:quizId/take', method: 'POST', public: true, handler: withQuiz(takePost) },
  { path: '/courses/:courseId/quizzes/:quizId/history', public: true, handler: withQuiz(historyPage) },
];

