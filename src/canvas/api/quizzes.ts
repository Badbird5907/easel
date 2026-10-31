import { useListPlaceholder } from './cacheSeed';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import { htmlToText } from '../html';
import { type CanvasClient, CanvasError } from '../client';
import { useCanvasQuery } from '../query';

/** Classic quiz (app/serializers/quizzes/quiz_serializer.rb) */
export type CanvasQuiz = {
  id: string;
  title: string;
  html_url: string;
  mobile_url?: string;
  description: string | null;
  quiz_type: 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey';
  /** Minutes, or null for no limit. */
  time_limit: number | null;
  /** -1 means unlimited. */
  allowed_attempts: number;
  question_count: number;
  points_possible: number | null;
  due_at: string | null;
  unlock_at: string | null;
  lock_at: string | null;
  locked_for_user?: boolean;
  lock_explanation?: string | null;
  assignment_id?: string | null;
  one_question_at_a_time?: boolean;
  cant_go_back?: boolean;
  has_access_code?: boolean;
  require_lockdown_browser?: boolean;
  require_lockdown_browser_for_results?: boolean;
  scoring_policy?: 'keep_highest' | 'keep_latest' | 'keep_average' | null;
  /** When true, Canvas lets the clock run out without submitting. */
  timer_autosubmit_disabled?: boolean;
  /** Set when the quiz only opens from some networks. Students may not see the value. */
  ip_filter?: string | null;
  show_correct_answers?: boolean;
  /** Correct answers show only after this time. */
  show_correct_answers_at?: string | null;
  /** Correct answers stop showing after this time. */
  hide_correct_answers_at?: string | null;
  /** Correct answers show only once the last attempt is in. */
  show_correct_answers_last_attempt?: boolean;
  /** Results show once, right after submitting. */
  one_time_results?: boolean;
  hide_results?: 'always' | 'until_after_last_attempt' | null;
};

/** lib/api/v1/quiz_submission.rb */
export type CanvasQuizSubmission = {
  id: string;
  quiz_id?: string;
  attempt: number | null;
  /** Proves the student started this attempt; every answer and the submit send it back. */
  validation_token?: string | null;
  quiz_points_possible?: number | null;
  time_spent?: number | null;
  extra_time?: number | null;
  html_url?: string;
  result_url?: string;
  score: number | null;
  kept_score: number | null;
  started_at: string | null;
  finished_at: string | null;
  end_at: string | null;
  workflow_state: 'untaken' | 'pending_review' | 'complete' | 'settings_only' | 'preview';
  /** -1 means unlimited. */
  attempts_left?: number;
  overdue_and_needs_submission?: boolean;
  has_seen_results?: boolean | null;
};

export type QuizType = CanvasQuiz['quiz_type'];

export type Quiz = {
  id: string;
  title: string;
  html: string;
  htmlUrl: string;
  type: QuizType;
  timeLimitMinutes: number | null;
  /** Null when unlimited. */
  allowedAttempts: number | null;
  questionCount: number;
  points: number | null;
  dueAt: Date | null;
  unlockAt: Date | null;
  lockAt: Date | null;
  locked: boolean;
  lockExplanation: string | null;
  assignmentId: string | null;
  oneQuestionAtATime: boolean;
  cantGoBack: boolean;
  requiresAccessCode: boolean;
  requiresLockdownBrowser: boolean;
  scoringPolicy: CanvasQuiz['scoring_policy'];
  /** Canvas web's page for the quiz, built for phones. */
  mobileUrl: string | null;
  timerAutosubmitDisabled: boolean;
  /** The quiz only opens from some networks (QUIZ-5). */
  ipFiltered: boolean;
  /** Results policy (QUIZ-9): what the student sees after an attempt. */
  results: {
    /** Results open only in LockDown Browser. */
    lockdownOnly: boolean;
    showCorrectAnswers: boolean;
    showCorrectAnswersAt: Date | null;
    hideCorrectAnswersAt: Date | null;
    showCorrectAnswersLastAttempt: boolean;
    oneTimeResults: boolean;
    hide: 'always' | 'until_after_last_attempt' | null;
  };
};

export type QuizAttempts = {
  /** Attempts the student has finished or started. */
  used: number;
  /** Null when unlimited; undefined before the first attempt (use the quiz's allowed attempts). */
  left: number | null | undefined;
  /** The score Canvas keeps per the scoring policy. */
  keptScore: number | null;
  latestScore: number | null;
  inProgress: boolean;
  pendingReview: boolean;
};

const toDate = (value?: string | null) => (value ? new Date(value) : null);

function toQuiz(q: CanvasQuiz): Quiz {
  return {
    id: String(q.id),
    title: q.title,
    html: q.description ?? '',
    htmlUrl: q.html_url,
    type: q.quiz_type,
    timeLimitMinutes: q.time_limit ?? null,
    allowedAttempts: q.allowed_attempts < 0 ? null : q.allowed_attempts,
    questionCount: q.question_count,
    points: q.points_possible,
    dueAt: toDate(q.due_at),
    unlockAt: toDate(q.unlock_at),
    lockAt: toDate(q.lock_at),
    locked: q.locked_for_user ?? false,
    lockExplanation: q.lock_explanation ? htmlToText(q.lock_explanation) : null,
    assignmentId: q.assignment_id ? String(q.assignment_id) : null,
    oneQuestionAtATime: q.one_question_at_a_time ?? false,
    cantGoBack: q.cant_go_back ?? false,
    requiresAccessCode: q.has_access_code ?? false,
    requiresLockdownBrowser: q.require_lockdown_browser ?? false,
    scoringPolicy: q.scoring_policy ?? null,
    mobileUrl: q.mobile_url ?? null,
    timerAutosubmitDisabled: q.timer_autosubmit_disabled ?? false,
    ipFiltered: !!q.ip_filter,
    results: {
      lockdownOnly: q.require_lockdown_browser_for_results ?? false,
      // Canvas defaults to showing correct answers when the setting is absent.
      showCorrectAnswers: q.show_correct_answers ?? true,
      showCorrectAnswersAt: toDate(q.show_correct_answers_at),
      hideCorrectAnswersAt: toDate(q.hide_correct_answers_at),
      showCorrectAnswersLastAttempt: q.show_correct_answers_last_attempt ?? false,
      oneTimeResults: q.one_time_results ?? false,
      hide: q.hide_results ?? null,
    },
  };
}

export async function fetchQuizzes(client: CanvasClient, courseId: string, signal?: AbortSignal) {
  const quizzes = await client.getAll<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes`, undefined, {
    signal,
  });
  return quizzes.map(toQuiz);
}

/** The course's classic quizzes (QUIZ-1). New Quizzes show up as assignments. */
export function useQuizzes(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'quizzes'], (client, signal) =>
    fetchQuizzes(client, courseId, signal),
  );
}

export async function fetchQuiz(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  signal?: AbortSignal,
) {
  return toQuiz(
    await client.get<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`, undefined, signal),
  );
}

export function useQuiz(courseId: string, quizId: string | null | undefined) {
  const placeholderData = useListPlaceholder<Quiz[], Quiz>(
    ['courses', courseId, 'quizzes'],
    (list) => Array.isArray(list) ? list.find((item) => item.id === quizId) : undefined,
  );
  return useCanvasQuery<Quiz>(
    ['courses', courseId, 'quizzes', quizId],
    (client, signal) => fetchQuiz(client, courseId, quizId!, signal),
    { enabled: !!quizId, placeholderData },
  );
}

export async function fetchQuizAttempts(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  signal?: AbortSignal,
): Promise<QuizAttempts> {
  const data = await client.get<{ quiz_submissions?: CanvasQuizSubmission[] }>(
    `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`,
    undefined,
    signal,
  );
  const subs = (data.quiz_submissions ?? []).filter((s) => s.workflow_state !== 'settings_only');
  const latest = subs.reduce<CanvasQuizSubmission | null>(
    (best, s) => (!best || (s.attempt ?? 0) > (best.attempt ?? 0) ? s : best),
    null,
  );
  const used = latest?.attempt ?? 0;
  const left = latest?.attempts_left;
  return {
    used,
    left: left === undefined ? undefined : left < 0 ? null : left,
    keptScore: latest?.kept_score ?? null,
    latestScore: latest?.score ?? null,
    inProgress: latest?.workflow_state === 'untaken' && !latest.finished_at,
    pendingReview: latest?.workflow_state === 'pending_review',
  };
}

/** The student's attempts on a quiz: how many used, how many left, and the kept score. */
export function useQuizAttempts(courseId: string, quizId: string | null | undefined) {
  return useCanvasQuery(
    ['courses', courseId, 'quizzes', quizId, 'attempts'],
    (client, signal) => fetchQuizAttempts(client, courseId, quizId!, signal),
    { enabled: !!quizId },
  );
}

// ---------------------------------------------------------------------------
// Taking a classic quiz (QUIZ-2 to QUIZ-5): Quiz Submissions API.
// app/controllers/quizzes/quiz_submissions_api_controller.rb,
// quiz_submission_questions_controller.rb, quiz_submission_events_api_controller.rb,
// and app/models/quizzes/quiz_submission_service.rb for the refusals.
// ---------------------------------------------------------------------------

export type QuizSubmission = {
  id: string;
  quizId: string | null;
  attempt: number;
  validationToken: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** When the attempt is due back: the time limit, or the quiz closing, whichever is first. */
  endAt: Date | null;
  workflowState: CanvasQuizSubmission['workflow_state'];
  /** Null when unlimited. */
  attemptsLeft: number | null;
  score: number | null;
  keptScore: number | null;
  pointsPossible: number | null;
  /** Seconds. */
  timeSpent: number | null;
  /** Canvas web's results page for this attempt. */
  resultUrl: string | null;
  /** Started and not yet submitted. */
  inProgress: boolean;
  overdue: boolean;
  hasSeenResults: boolean;
};

function toQuizSubmission(s: CanvasQuizSubmission): QuizSubmission {
  const left = s.attempts_left;
  return {
    id: String(s.id),
    quizId: s.quiz_id ? String(s.quiz_id) : null,
    attempt: s.attempt ?? 1,
    validationToken: s.validation_token ?? null,
    startedAt: toDate(s.started_at),
    finishedAt: toDate(s.finished_at),
    endAt: toDate(s.end_at),
    workflowState: s.workflow_state,
    attemptsLeft: left === undefined || left < 0 ? null : left,
    score: s.score ?? null,
    keptScore: s.kept_score ?? null,
    pointsPossible: s.quiz_points_possible ?? null,
    timeSpent: s.time_spent ?? null,
    resultUrl: s.result_url ?? null,
    inProgress: s.workflow_state === 'untaken' && !s.finished_at,
    overdue: s.overdue_and_needs_submission ?? false,
    hasSeenResults: s.has_seen_results ?? false,
  };
}

const submissionsPath = (courseId: string, quizId: string) =>
  `/api/v1/courses/${courseId}/quizzes/${quizId}/submissions`;

/** The student's attempts. Canvas returns only the in-progress one when there is one. */
export async function fetchQuizSubmissions(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  signal?: AbortSignal,
): Promise<QuizSubmission[]> {
  const data = await client.get<{ quiz_submissions?: CanvasQuizSubmission[] }>(
    submissionsPath(courseId, quizId),
    undefined,
    signal,
  );
  return (data.quiz_submissions ?? [])
    .filter((s) => s.workflow_state !== 'settings_only')
    .map(toQuizSubmission)
    .sort((a, b) => b.attempt - a.attempt);
}

export function useQuizSubmissions(courseId: string, quizId: string) {
  return useCanvasQuery(['courses', courseId, 'quizzes', quizId, 'submissions'], (client, signal) =>
    fetchQuizSubmissions(client, courseId, quizId, signal),
  );
}

/** Why Canvas won't start or accept an attempt, from the service's refusals. */
export type QuizRefusal =
  | 'access_code'
  | 'ip_filter'
  | 'lockdown'
  | 'locked'
  | 'unsupported'
  | 'exists'
  | 'one_at_a_time'
  | 'ended'
  | 'token';

export class QuizRefusedError extends Error {
  constructor(
    readonly reason: QuizRefusal,
    /** What Canvas said, shown as is for IP filters (QUIZ-5). */
    readonly serverMessage: string,
    readonly status: number,
  ) {
    super(serverMessage);
    this.name = 'QuizRefusedError';
  }
}

/** Maps a Canvas error to a refusal Easel can explain, or returns it unchanged. */
export function asQuizRefusal(error: unknown): unknown {
  if (!(error instanceof CanvasError)) return error;
  const message = error.message;
  const reason: QuizRefusal | null = /access code/i.test(message)
    ? 'access_code'
    : /ip address/i.test(message)
      ? 'ip_filter'
      : /lockdown/i.test(message)
        ? 'lockdown'
        : error.status === 501 || /not supported/i.test(message)
          ? 'unsupported'
          : error.status === 409
            ? 'exists'
            : /one question at a time/i.test(message)
              ? 'one_at_a_time'
              : /already complete|overdue/i.test(message)
                ? 'ended'
                : /invalid token/i.test(message)
                  ? 'token'
                  : /locked|not allowed to participate/i.test(message)
                    ? 'locked'
                    : null;
  return reason ? new QuizRefusedError(reason, message, error.status) : error;
}

/** Starts an attempt (`POST …/submissions`). Throws `QuizRefusedError` when Canvas says no. */
export async function startQuizSubmission(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  accessCode?: string,
): Promise<QuizSubmission> {
  try {
    const data = await client.post<{ quiz_submissions: CanvasQuizSubmission[] }>(
      submissionsPath(courseId, quizId),
      accessCode ? { access_code: accessCode } : {},
    );
    return toQuizSubmission(data.quiz_submissions[0]);
  } catch (error) {
    throw asQuizRefusal(error);
  }
}

export async function fetchQuizSubmission(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  submissionId: string,
  signal?: AbortSignal,
): Promise<QuizSubmission> {
  const data = await client.get<{ quiz_submissions: CanvasQuizSubmission[] }>(
    `${submissionsPath(courseId, quizId)}/${submissionId}`,
    undefined,
    signal,
  );
  return toQuizSubmission(data.quiz_submissions[0]);
}

export function useQuizSubmission(courseId: string, quizId: string, submissionId: string | undefined) {
  return useCanvasQuery(
    ['courses', courseId, 'quizzes', quizId, 'submissions', submissionId],
    (client, signal) => fetchQuizSubmission(client, courseId, quizId, submissionId!, signal),
    { enabled: !!submissionId },
  );
}

/** What every write to an attempt carries. */
export type AttemptAuth = { attempt: number; validationToken: string; accessCode?: string | null };

const authBody = (auth: AttemptAuth) => ({
  attempt: auth.attempt,
  validation_token: auth.validationToken,
  ...(auth.accessCode ? { access_code: auth.accessCode } : {}),
});

/** Turns the attempt in. Canvas grades what it can right away. */
export async function completeQuizSubmission(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  submissionId: string,
  auth: AttemptAuth,
): Promise<QuizSubmission> {
  try {
    const data = await client.post<{ quiz_submissions: CanvasQuizSubmission[] }>(
      `${submissionsPath(courseId, quizId)}/${submissionId}/complete`,
      authBody(auth),
    );
    return toQuizSubmission(data.quiz_submissions[0]);
  } catch (error) {
    throw asQuizRefusal(error);
  }
}

/** `GET …/submissions/:id/time`: seconds left, from Canvas's clock. Null when untimed. */
export async function fetchQuizTime(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  submissionId: string,
): Promise<{ endAt: Date | null; secondsLeft: number | null }> {
  const data = await client.get<{ end_at: string | null; time_left: number | null }>(
    `${submissionsPath(courseId, quizId)}/${submissionId}/time`,
  );
  return { endAt: toDate(data.end_at), secondsLeft: data.time_left ?? null };
}

/** The quiz log (`quiz_submission_event.rb`): focus changes, answers, flags, views. */
export type QuizEvent = {
  type:
    | 'page_focused'
    | 'page_blurred'
    | 'question_answered'
    | 'question_flagged'
    | 'question_viewed'
    | 'session_started';
  data?: unknown;
  at: string;
};

export async function postQuizEvents(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  submissionId: string,
  events: QuizEvent[],
) {
  if (events.length === 0) return;
  await client.post<unknown>(`${submissionsPath(courseId, quizId)}/${submissionId}/events`, {
    quiz_submission_events: events.map((e) => ({
      event_type: e.type,
      event_data: e.data ?? null,
      client_timestamp: e.at,
    })),
  });
}

/** Where file upload answers are uploaded first (`uploadToCanvas`). */
export const quizFilePreflightPath = (courseId: string, quizId: string) =>
  `${submissionsPath(courseId, quizId)}/self/files`;

// Results and history (QUIZ-9) -----------------------------------------------
// Quizzes::QuizSubmissionsApiController#index gives a student every submitted
// attempt (`submitted_attempts`, one version each, same ID). Per-question
// results come from the questions API with `quiz_submission_attempt`; Canvas
// marks each question `correct` (true, false, "partial", or "undefined" while
// it waits for grading) and refuses when the quiz hides results.

/** The student's finished attempts, newest first. */
export async function fetchQuizHistory(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  signal?: AbortSignal,
): Promise<QuizSubmission[]> {
  const all = await fetchQuizSubmissions(client, courseId, quizId, signal);
  return all.filter((s) => !s.inProgress && (s.finishedAt !== null || s.workflowState !== 'untaken'));
}

export function useQuizHistory(courseId: string, quizId: string) {
  return useCanvasQuery(['courses', courseId, 'quizzes', quizId, 'history'], (client, signal) =>
    fetchQuizHistory(client, courseId, quizId, signal),
  );
}

/** Whether Canvas shows this attempt's results at all (`QuizSubmission#results_visible?`). */
export function resultsVisible(
  quiz: Pick<Quiz, 'results' | 'allowedAttempts'>,
  attempt: Pick<QuizSubmission, 'attempt' | 'hasSeenResults' | 'workflowState'>,
): boolean {
  const { results } = quiz;
  if (results.oneTimeResults && attempt.hasSeenResults) return false;
  if (results.hide === 'always') return false;
  if (results.hide !== 'until_after_last_attempt') return true;
  const allowed = quiz.allowedAttempts;
  const completed = attempt.workflowState === 'complete' || attempt.workflowState === 'pending_review';
  return allowed === null || attempt.attempt > allowed || (completed && attempt.attempt >= allowed);
}

/**
 * Whether the student may see which answers were right (`Quizzes::Quiz#show_correct_answers?`).
 * `attemptsLeft` is the student's current count, null when unlimited.
 */
export function showsCorrectAnswers(
  quiz: Pick<Quiz, 'results' | 'allowedAttempts'>,
  attempt: Pick<QuizSubmission, 'attempt' | 'hasSeenResults' | 'workflowState'>,
  attemptsLeft: number | null,
  now = new Date(),
): boolean {
  if (!resultsVisible(quiz, attempt)) return false;
  const { results } = quiz;
  if (!results.showCorrectAnswers) return false;
  if (results.showCorrectAnswersLastAttempt)
    return attemptsLeft === 0 && (attempt.workflowState === 'complete' || attempt.workflowState === 'pending_review');
  if (results.oneTimeResults) return true;
  if (results.hideCorrectAnswersAt && now > results.hideCorrectAnswersAt) return false;
  return results.showCorrectAnswersAt ? now > results.showCorrectAnswersAt : true;
}

/** How a question came out: `correct` from the questions API. */
export type QuestionOutcome = 'correct' | 'incorrect' | 'partial' | 'pending';

export type AttemptQuestion = {
  /** Present only for an Easel-generated fallback; absent in older caches/raw names. */
  generatedNameOrdinal?: number;
  id: string;
  position: number;
  name: string;
  /** Question text as plain text, for a summary line. */
  text: string;
  points: number | null;
  /** Null for questions with no answer to grade (text only, surveys). */
  outcome: QuestionOutcome | null;
};

export type AttemptQuestions =
  | { status: 'ok'; questions: AttemptQuestion[] }
  /** The quiz's settings hide results for this attempt. */
  | { status: 'hidden'; message: string }
  /** The API can't list these questions (one question at a time). */
  | { status: 'unavailable'; message: string };

function toOutcome(raw: unknown): QuestionOutcome | null {
  if (raw === true) return 'correct';
  if (raw === false) return 'incorrect';
  if (raw === 'partial') return 'partial';
  if (raw === 'undefined') return 'pending';
  return null;
}

/** `\(x^2\)` and `$$…$$` math reads better without its delimiters in a one-line summary. */
const plainMath = (text: string) => text.replace(/\\[()[\]]/g, '').replace(/\$\$/g, '');

/** One attempt's questions with whether each was right (QUIZ-9). */
export async function fetchAttemptQuestions(
  client: CanvasClient,
  submissionId: string,
  attempt: number,
  signal?: AbortSignal,
): Promise<AttemptQuestions> {
  let data: { quiz_submission_questions?: (CanvasQuizSubmissionQuestion & { correct?: unknown })[] };
  try {
    data = await client.get(
      `/api/v1/quiz_submissions/${submissionId}/questions`,
      { quiz_submission_attempt: attempt },
      signal,
    );
  } catch (error) {
    if (error instanceof CanvasError) {
      if (/quiz settings/i.test(error.message)) return { status: 'hidden', message: error.message };
      if (/one question at a time/i.test(error.message)) return { status: 'unavailable', message: error.message };
    }
    throw error;
  }
  const questions = [...(data.quiz_submission_questions ?? [])]
    .filter((q) => q.question_type !== 'text_only_question')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(
      (q, index): AttemptQuestion => ({
        id: String(q.id),
        position: q.position ?? index + 1,
        name: q.question_name || `Question ${index + 1}`,
        ...(!q.question_name ? { generatedNameOrdinal: index + 1 } : {}),
        text: plainMath(htmlToText(q.question_text ?? '')),
        points: q.points_possible ?? null,
        outcome: toOutcome(q.correct),
      }),
    );
  return { status: 'ok', questions };
}

export function useAttemptQuestions(
  courseId: string,
  quizId: string,
  submissionId: string | undefined,
  attempt: number,
  enabled = true,
) {
  return useCanvasQuery(
    ['courses', courseId, 'quizzes', quizId, 'history', attempt, 'questions'],
    (client, signal) => fetchAttemptQuestions(client, submissionId!, attempt, signal),
    { enabled: enabled && !!submissionId },
  );
}

/** Canvas web's page for one attempt, with the student's answers (`course_quiz_history_url`). */
export function attemptHistoryUrl(
  baseUrl: string,
  courseId: string,
  quizId: string,
  submissionId: string,
  attempt: number,
): string {
  return `${baseUrl}/courses/${courseId}/quizzes/${quizId}/history?quiz_submission_id=${encodeURIComponent(submissionId)}&version=${attempt}`;
}

// Questions ------------------------------------------------------------------

export type QuestionType =
  | 'multiple_choice_question'
  | 'true_false_question'
  | 'multiple_answers_question'
  | 'matching_question'
  | 'multiple_dropdowns_question'
  | 'fill_in_multiple_blanks_question'
  | 'short_answer_question'
  | 'numerical_question'
  | 'calculated_question'
  | 'essay_question'
  | 'file_upload_question'
  | 'text_only_question';

const QUESTION_TYPES: ReadonlySet<string> = new Set<QuestionType>([
  'multiple_choice_question',
  'true_false_question',
  'multiple_answers_question',
  'matching_question',
  'multiple_dropdowns_question',
  'fill_in_multiple_blanks_question',
  'short_answer_question',
  'numerical_question',
  'calculated_question',
  'essay_question',
  'file_upload_question',
  'text_only_question',
]);

/** `lib/api/v1/quiz_submission_question.rb`, censored for students. */
export type CanvasQuizSubmissionQuestion = {
  id: string;
  quiz_id?: string;
  position?: number | null;
  question_name?: string | null;
  question_type: string;
  question_text: string;
  points_possible?: number | null;
  answers?: {
    id: string;
    text?: string;
    html?: string;
    blank_id?: string;
    variables?: { name: string; value: number | string }[];
  }[];
  matches?: { match_id: string; text: string }[];
  variables?: { name: string; min?: number; max?: number; scale?: number }[];
  formulas?: { formula: string }[];
  formula_decimal_places?: number;
  flagged?: boolean;
  /** The saved answer, in the answer serializer's format for the question type. */
  answer?: unknown;
};

export type MatchingPair = { answerId: string; matchId: string | null };

/**
 * An answer as Easel holds it. Same shapes the serializers use, typed:
 * choice IDs, ID lists, matching pairs, blank maps, or text.
 */
export type AnswerValue =
  | { kind: 'choice'; id: string | null }
  | { kind: 'choices'; ids: string[] }
  | { kind: 'matching'; pairs: MatchingPair[] }
  | { kind: 'blanks'; values: Record<string, string | null> }
  | { kind: 'text'; value: string }
  | { kind: 'file'; attachmentId: string | null; name?: string | null }
  | { kind: 'none' };

export type QuizBlank = {
  /** The blank's name in the question, e.g. `color1`. Answers are keyed by it. */
  id: string;
  /** Number shown in the question text and beside the field. */
  number: number;
  /** Multiple dropdowns: the choices for this blank. */
  options: { id: string; text: string }[];
};

export type QuizQuestion = {
  id: string;
  position: number;
  /** Canvas's own label, e.g. "Question 3". */
  name: string;
  type: QuestionType | 'unsupported';
  rawType: string;
  /** Question text as HTML. Blanks and dropdowns appear as numbered markers. */
  html: string;
  points: number | null;
  answers: { id: string; text: string; html: string | null }[];
  matches: { id: string; text: string }[];
  blanks: QuizBlank[];
  /** Calculated questions: the values Canvas picked for this attempt. */
  variables: { name: string; value: string }[];
  flagged: boolean;
  answer: AnswerValue;
};

const INPUT_TAG =
  /<select\b[^>]*\bname=['"]question_\d+_([0-9a-f]+)['"][^>]*>[\s\S]*?<\/select>|<input\b[^>]*\bname=['"]question_\d+_([0-9a-f]+)['"][^>]*>/gi;

const md5Cache = new Map<string, string>();
async function blankHash(blank: string): Promise<string> {
  const cached = md5Cache.get(blank);
  if (cached) return cached;
  // AssessmentQuestion.variable_id: MD5 of "dropdown,<blank>,instructure-key".
  const hash = await digestStringAsync(CryptoDigestAlgorithm.MD5, `dropdown,${blank},instructure-key`);
  md5Cache.set(blank, hash);
  return hash;
}

/**
 * Canvas renders blanks and dropdowns into the question text as form fields
 * (`quiz_question_builder.rb`). Easel swaps each for a numbered marker and
 * matches it to its blank by the field's hashed name.
 */
async function parseBlanks(q: CanvasQuizSubmissionQuestion): Promise<{ html: string; blanks: QuizBlank[] }> {
  const keys = new Set<string>();
  if (q.answer && typeof q.answer === 'object' && !Array.isArray(q.answer))
    Object.keys(q.answer as Record<string, unknown>).forEach((k) => keys.add(k));
  q.answers?.forEach((a) => a.blank_id && keys.add(a.blank_id));
  const byHash = new Map<string, string>();
  await Promise.all([...keys].map(async (k) => byHash.set(await blankHash(k), k)));

  const remaining = [...keys];
  const blanks: QuizBlank[] = [];
  const html = q.question_text.replace(INPUT_TAG, (_tag, selectHash?: string, inputHash?: string) => {
    const hash = selectHash ?? inputHash ?? '';
    const id =
      byHash.get(hash) ??
      remaining.find((k) => !blanks.some((b) => b.id === k)) ??
      `blank${blanks.length + 1}`;
    const existing = blanks.find((b) => b.id === id);
    const number = existing?.number ?? blanks.length + 1;
    if (!existing)
      blanks.push({
        id,
        number,
        options: (q.answers ?? [])
          .filter((a) => a.blank_id === id)
          .map((a) => ({ id: String(a.id), text: a.text ?? htmlToText(a.html ?? '') })),
      });
    return `<span class="easel-blank" role="img" aria-label="Blank ${number}">${number}</span>`;
  });
  // Text that still has [blank] placeholders (no server-rendered fields).
  if (blanks.length === 0 && keys.size > 0) {
    let n = 0;
    const replaced = html.replace(/\[([^\]\s]+)\]/g, (whole, name: string) => {
      if (!keys.has(name)) return whole;
      const existing = blanks.find((b) => b.id === name);
      if (!existing) {
        n += 1;
        blanks.push({
          id: name,
          number: n,
          options: (q.answers ?? [])
            .filter((a) => a.blank_id === name)
            .map((a) => ({ id: String(a.id), text: a.text ?? htmlToText(a.html ?? '') })),
        });
      }
      const number = (existing ?? blanks[blanks.length - 1]).number;
      return `<span class="easel-blank" role="img" aria-label="Blank ${number}">${number}</span>`;
    });
    return { html: replaced, blanks };
  }
  return { html, blanks };
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function toAnswer(type: QuizQuestion['type'], raw: unknown, blanks: QuizBlank[]): AnswerValue {
  switch (type) {
    case 'multiple_choice_question':
    case 'true_false_question':
      return { kind: 'choice', id: asString(raw) };
    case 'multiple_answers_question':
      return { kind: 'choices', ids: Array.isArray(raw) ? raw.map(String) : [] };
    case 'matching_question':
      return {
        kind: 'matching',
        pairs: Array.isArray(raw)
          ? (raw as { answer_id: unknown; match_id: unknown }[]).map((p) => ({
              answerId: String(p.answer_id),
              matchId: asString(p.match_id),
            }))
          : [],
      };
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question': {
      const values: Record<string, string | null> = {};
      for (const b of blanks) values[b.id] = null;
      if (raw && typeof raw === 'object')
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) values[k] = asString(v);
      return { kind: 'blanks', values };
    }
    case 'file_upload_question':
      return { kind: 'file', attachmentId: asString(Array.isArray(raw) ? raw[0] : raw) };
    case 'text_only_question':
    case 'unsupported':
      return { kind: 'none' };
    default:
      return { kind: 'text', value: asString(raw) ?? '' };
  }
}

async function toQuestion(q: CanvasQuizSubmissionQuestion, index: number): Promise<QuizQuestion> {
  const type = QUESTION_TYPES.has(q.question_type) ? (q.question_type as QuestionType) : 'unsupported';
  const parsed =
    type === 'fill_in_multiple_blanks_question' || type === 'multiple_dropdowns_question'
      ? await parseBlanks(q)
      : { html: q.question_text ?? '', blanks: [] };
  const variables =
    type === 'calculated_question'
      ? (q.answers?.[0]?.variables ?? []).map((v) => ({ name: v.name, value: String(v.value) }))
      : [];
  // Calculated text normally arrives with the values filled in; fill any left.
  let html = parsed.html;
  for (const v of variables) html = html.split(`[${v.name}]`).join(v.value);
  return {
    id: String(q.id),
    position: q.position ?? index + 1,
    name: q.question_name || `Question ${index + 1}`,
    type,
    rawType: q.question_type,
    html,
    points: q.points_possible ?? null,
    answers:
      type === 'multiple_dropdowns_question' || type === 'calculated_question'
        ? []
        : (q.answers ?? []).map((a) => ({ id: String(a.id), text: a.text ?? '', html: a.html || null })),
    matches: (q.matches ?? []).map((m) => ({ id: String(m.match_id), text: m.text })),
    blanks: parsed.blanks,
    variables,
    flagged: q.flagged ?? false,
    answer: toAnswer(type, q.answer, parsed.blanks),
  };
}

/** The attempt's questions with saved answers and flags. Refuses one-question-at-a-time quizzes. */
export async function fetchSubmissionQuestions(
  client: CanvasClient,
  submissionId: string,
  signal?: AbortSignal,
): Promise<QuizQuestion[]> {
  let data: { quiz_submission_questions?: CanvasQuizSubmissionQuestion[] };
  try {
    data = await client.get(`/api/v1/quiz_submissions/${submissionId}/questions`, undefined, signal);
  } catch (error) {
    throw asQuizRefusal(error);
  }
  const raw = [...(data.quiz_submission_questions ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  return Promise.all(raw.map(toQuestion));
}

/** An answer in the shape `POST /quiz_submissions/:id/questions` takes for its type. */
export function answerPayload(answer: AnswerValue): unknown {
  switch (answer.kind) {
    case 'choice':
      return answer.id;
    case 'choices':
      return answer.ids;
    case 'matching':
      return answer.pairs
        .filter((p) => p.matchId)
        .map((p) => ({ answer_id: p.answerId, match_id: p.matchId }));
    case 'blanks':
      return answer.values;
    case 'text':
      return answer.value;
    case 'file':
      return answer.attachmentId ? [answer.attachmentId] : [];
    case 'none':
      return null;
  }
}

/** Saves answers. One request for several, so a reconnect replays the queue at once. */
export async function answerQuestions(
  client: CanvasClient,
  submissionId: string,
  auth: AttemptAuth,
  answers: { questionId: string; answer: AnswerValue; type: QuizQuestion['type'] }[],
): Promise<void> {
  try {
    await client.post(`/api/v1/quiz_submissions/${submissionId}/questions`, {
      ...authBody(auth),
      quiz_questions: answers.map((a) => {
        let payload = answerPayload(a.answer);
        // Dropdown blanks must hold answer IDs; leave out the ones not chosen yet.
        if (a.type === 'multiple_dropdowns_question' && payload && typeof payload === 'object')
          payload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v));
        if (a.type === 'fill_in_multiple_blanks_question' && payload && typeof payload === 'object')
          payload = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, v ?? '']));
        return { id: a.questionId, answer: payload };
      }),
    });
  } catch (error) {
    throw asQuizRefusal(error);
  }
}

export async function flagQuestion(
  client: CanvasClient,
  submissionId: string,
  questionId: string,
  flagged: boolean,
  auth: AttemptAuth,
) {
  try {
    await client.put(
      `/api/v1/quiz_submissions/${submissionId}/questions/${questionId}/${flagged ? 'flag' : 'unflag'}`,
      authBody(auth),
    );
  } catch (error) {
    throw asQuizRefusal(error);
  }
}

// New Quizzes ----------------------------------------------------------------

/** `GET /api/v1/courses/:id/assignments`, the fields that mark a New Quiz. */
type CanvasQuizLtiAssignment = {
  id: string;
  name: string;
  html_url: string;
  due_at: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible: number | null;
  is_quiz_lti_assignment?: boolean;
  locked_for_user?: boolean;
  lock_explanation?: string | null;
  published?: boolean;
};

export type NewQuiz = {
  assignmentId: string;
  title: string;
  htmlUrl: string;
  dueAt: Date | null;
  unlockAt: Date | null;
  points: number | null;
  locked: boolean;
  lockExplanation: string | null;
};

/** New Quizzes are assignments backed by the Quizzes LTI tool; the quizzes API doesn't list them. */
export async function fetchNewQuizzes(client: CanvasClient, courseId: string, signal?: AbortSignal) {
  const assignments = await client.getAll<CanvasQuizLtiAssignment>(
    `/api/v1/courses/${courseId}/assignments`,
    { order_by: 'due_at' },
    { signal },
  );
  return assignments
    .filter((a) => a.is_quiz_lti_assignment)
    .map((a): NewQuiz => ({
      assignmentId: String(a.id),
      title: a.name,
      htmlUrl: a.html_url,
      dueAt: toDate(a.due_at),
      unlockAt: toDate(a.unlock_at),
      points: a.points_possible,
      locked: a.locked_for_user ?? false,
      lockExplanation: a.lock_explanation ? htmlToText(a.lock_explanation) : null,
    }));
}

export function useNewQuizzes(courseId: string) {
  return useCanvasQuery(['courses', courseId, 'quizzes', 'new'], (client, signal) =>
    fetchNewQuizzes(client, courseId, signal),
  );
}
