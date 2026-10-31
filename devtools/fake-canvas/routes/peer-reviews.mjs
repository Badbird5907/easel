/**
 * Peer reviews (owned by the assignments, sharing, and links workstream; ASSIGN-12).
 *
 * A student only sees the reviews assigned to them, and the rubric association to assess
 * with, through GraphQL (`assignment.assessmentRequestsForCurrentUser`,
 * `assignment.rubricAssociation`); REST hides both from students. Shapes follow canvas-lms:
 *   app/graphql/types/assessment_request_type.rb, rubric_assessment_type.rb,
 *   assignment_type.rb (AssignmentPeerReviews, rubricAssociation)
 *   app/graphql/mutations/create_submission_comment.rb (reviewerSubmissionId completes a
 *     review that has no rubric, AbstractAssignment#update_submission_runner)
 *   app/controllers/rubric_assessments_controller.rb#update (POST rubric_assessments)
 *   app/controllers/submissions_api_controller.rb#show and #show_anonymous
 *   app/models/assessment_request.rb (available?, comment_added, complete)
 *
 * routes/graphql.mjs forwards operations to `POST /fake/graphql/peer-reviews`, which answers
 * 404 for ones it doesn't know. course-content.mjs hands classmates' submissions here
 * (`submissionFor`). Reviews, comments, and assessments live on globalThis and survive
 * reloads; `POST /fake/peer-reviews/reset` forgets what the student did.
 *
 * Cases:
 *   assignment 9144 (CS 225)  design doc with the "design" rubric: review Maya Chen (2001)
 *                             and Jordan Alvarez (2002). Submitting the rubric completes one.
 *   assignment 9145 (CS 225)  anonymous, no rubric: review one classmate (anonymous ID
 *                             "aSam3"). A comment completes it.
 */
import { Buffer } from 'node:buffer';

import { at, BASE, user } from '../data.mjs';

const submissions = globalThis.__easelFakeSubmissions;

const fixtures = [
  { id: '9601', assignment: '9144', course: '225', assessee: '2001', anonymousId: 'aMaya1' },
  { id: '9602', assignment: '9144', course: '225', assessee: '2002', anonymousId: 'aJord2' },
  { id: '9603', assignment: '9145', course: '225', assessee: '2003', anonymousId: 'aSam3' },
];

/** What each classmate turned in. */
const work = {
  '9144:2001': {
    submitted: at(-4, 18, 2),
    body: '<h2>MP1 design: Maya Chen</h2><p>I keep the image as a 2D vector of <code>HSLAPixel</code>, indexed <code>[y][x]</code>, so rows stay contiguous.</p><p>Flood fill uses an explicit stack instead of recursion, which avoids stack overflow on large images. Each pixel is pushed at most once because I mark it visited before pushing.</p><p>Cost: every operation is O(width × height) time and space.</p>',
  },
  '9144:2002': {
    submitted: at(-3, 22, 41),
    body: '<h2>MP1 design: Jordan Alvarez</h2><p>The canvas is a flat array. I wrote helper functions for neighbors.</p><p>I used a queue for the fill. It works on the provided images.</p>',
  },
  '9145:2003': {
    submitted: at(-2, 19, 15),
    body: '<p>Lab 7 made me realize I had been memorizing rotation cases instead of understanding them. Once I wrote out the heights before and after each rotation, the four cases reduced to two mirror images.</p><p>Next time I want to test my insert on sorted input first, since that is where my tree went wrong.</p>',
  },
};

const state = (globalThis.__easelFakePeerReviews ??= {
  /** request id -> 'assigned' | 'completed' */
  workflow: {},
  /** request id -> comments the student left */
  comments: {},
  /** request id -> { score, ratings: { criterionId: { rating_id, points, comments } }, at } */
  assessments: {},
  nextId: 1,
});

function reset() {
  Object.assign(state, { workflow: {}, comments: {}, assessments: {} });
  return { ok: true };
}

const course = () => submissions?.course;
const assignmentOf = (r) => course()?.assignmentById(r.course, r.assignment);
const workflowOf = (r) => state.workflow[r.id] ?? 'assigned';
const workOf = (r) => work[`${r.assignment}:${r.assessee}`];
const peerSubmissionId = (r) => `ps${r.assignment}-${r.assessee}`;
const nameOf = (r) => course()?.personById(r.course, r.assessee)?.name ?? 'Classmate';
/** AssessmentRequest#available?: the classmate submitted, and so did the reviewer. */
const available = (r) => !!workOf(r) && (course()?.attemptsOf(assignmentOf(r)).length ?? 0) > 0;

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});
const unauthorized = () => ({
  status: 401,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});

function commentJson(c) {
  return {
    id: c.id,
    author_id: user.id,
    author_name: user.name,
    created_at: c.at,
    edited_at: null,
    comment: c.text,
    attempt: 1,
    avatar_path: null,
    author: {
      id: user.id,
      anonymous_id: user.id,
      display_name: user.name,
      avatar_image_url: null,
      html_url: `${BASE}/users/${user.id}`,
    },
  };
}

/** submissions_api_controller.rb#show for a reviewer: the classmate's work and the reviewer's own comments. */
function peerSubmissionJson(r, { anonymous }) {
  const a = assignmentOf(r);
  const w = workOf(r);
  if (!a || !w) return null;
  return {
    id: peerSubmissionId(r),
    assignment_id: a.id,
    user_id: anonymous ? null : r.assessee,
    ...(anonymous && { anonymous_id: r.anonymousId }),
    attempt: 1,
    body: w.body,
    url: null,
    submission_type: 'online_text_entry',
    submitted_at: w.submitted,
    score: null,
    grade: null,
    graded_at: null,
    workflow_state: 'submitted',
    late: false,
    missing: false,
    excused: false,
    preview_url: null,
    submission_comments: (state.comments[r.id] ?? []).map(commentJson),
  };
}

const findRequest = (assignmentId, test) =>
  fixtures.find((r) => r.assignment === String(assignmentId) && test(r));

// Hook for course-content.mjs's `GET …/submissions/:user_id`.
state.submissionFor = (a, userId) => {
  const r = findRequest(a.id, (x) => x.assessee === String(userId));
  if (!r || !a.peerReviews || a.peerReviews.anonymous) return unauthorized();
  if (!available(r)) return unauthorized();
  return peerSubmissionJson(r, { anonymous: false });
};

function anonymousSubmission({ params }) {
  const r = findRequest(params.assignmentId, (x) => x.anonymousId === params.anonymousId);
  if (!r) return notFound();
  if (!available(r)) return unauthorized();
  return peerSubmissionJson(r, { anonymous: !!assignmentOf(r)?.peerReviews?.anonymous });
}

const associationId = (a) => `rua${a.id}`;

function rubricAssessmentGraphql(r) {
  const saved = state.assessments[r.id];
  if (!saved) return null;
  return {
    _id: saved.id,
    score: saved.score,
    assessmentType: 'peer_review',
    assessmentRatings: Object.entries(saved.ratings).map(([criterionId, x]) => ({
      _id: x.rating_id ?? null,
      points: x.points ?? null,
      comments: x.comments ?? null,
      criterion: { _id: criterionId },
    })),
  };
}

function peerReviewsQuery(variables) {
  const id = String(variables.assignmentId ?? '');
  const a = ['225', '201', '241', '110', '150', '101']
    .map((c) => course()?.assignmentById(c, id))
    .find(Boolean);
  if (!a) return { data: { assignment: null } };
  const requests = a.peerReviews ? fixtures.filter((r) => r.assignment === a.id) : [];
  const anonymous = !!a.peerReviews?.anonymous;
  return {
    data: {
      assignment: {
        _id: a.id,
        name: a.name,
        peerReviews: {
          enabled: !!a.peerReviews,
          anonymousReviews: anonymous,
          dueAt: a.peerReviews?.due ?? null,
        },
        rubricAssociation: a.rubric
          ? { _id: associationId(a), hidePoints: false, hideScoreTotal: false, useForGrading: true }
          : null,
        assessmentRequestsForCurrentUser: requests.map((r) => ({
          _id: r.id,
          createdAt: at(-1, 0),
          workflowState: workflowOf(r),
          available: available(r),
          // AssessmentRequestType hides who it is on anonymous reviews.
          anonymousId: anonymous ? r.anonymousId : null,
          anonymizedUser: anonymous ? null : { _id: r.assessee, name: nameOf(r) },
          submission: workOf(r)
            ? { _id: peerSubmissionId(r), attempt: 1, submittedAt: workOf(r).submitted }
            : null,
          rubricAssessment: rubricAssessmentGraphql(r),
        })),
      },
    },
  };
}

function createComment(variables) {
  const r = fixtures.find((x) => peerSubmissionId(x) === String(variables.submissionId ?? ''));
  if (!r) return { data: null, errors: [{ message: 'not found' }] };
  if (!available(r)) return { data: null, errors: [{ message: 'not found' }] };
  const text = String(variables.comment ?? '').trim();
  if (!text)
    return {
      data: {
        createSubmissionComment: {
          submissionComment: null,
          errors: [{ attribute: 'comment', message: "can't be blank" }],
        },
      },
    };
  const comment = { id: `prc${state.nextId++}`, at: new Date().toISOString(), text };
  (state.comments[r.id] ??= []).push(comment);
  // A review without a rubric is complete once the reviewer comments (reviewerSubmissionId).
  const a = assignmentOf(r);
  if (variables.reviewerSubmissionId === `s${a.id}` && !a.rubric) state.workflow[r.id] = 'completed';
  return { data: { createSubmissionComment: { submissionComment: { _id: comment.id }, errors: null } } };
}

function graphqlResolver({ body }) {
  const request = body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {};
  switch (request.operationName) {
    case 'EaselPeerReviews':
      return peerReviewsQuery(request.variables ?? {});
    case 'EaselPeerReviewComment':
      return createComment(request.variables ?? {});
    default:
      return { status: 404, body: { errors: [{ message: 'Unknown operation' }] } };
  }
}

/** rubric_assessments_controller.rb#update via POST: a peer review's rubric assessment. */
function assessRubric({ params, body }) {
  const a = ['225', '201', '241', '110', '150', '101']
    .map((c) => course()?.assignmentById(c, params.associationId.replace(/^rua/, '')))
    .find(Boolean);
  if (!a || !a.rubric || params.courseId !== a.course) return notFound();
  const input = (body && !Buffer.isBuffer(body) && body.rubric_assessment) || {};
  const r = findRequest(a.id, (x) =>
    input.anonymous_id
      ? x.anonymousId === String(input.anonymous_id)
      : x.assessee === String(input.user_id ?? ''),
  );
  if (!r) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
  if (input.assessment_type !== 'peer_review' || !available(r)) return unauthorized();
  const criteria = course().rubrics[a.rubric] ?? [];
  const ratings = {};
  for (const criterion of criteria) {
    const given = input[`criterion_${criterion.id}`];
    if (!given) continue;
    const rating = criterion.ratings.find((x) => x.id === given.rating_id);
    const points =
      given.points === '' || given.points == null ? (rating?.points ?? null) : Number(given.points);
    ratings[criterion.id] = { rating_id: rating?.id ?? null, points, comments: given.comments ?? '' };
  }
  if (!Object.keys(ratings).length)
    return { status: 400, body: { errors: { base: 'Rate at least one criterion.' } } };
  const id = state.assessments[r.id]?.id ?? `pra${state.nextId++}`;
  const score = Object.values(ratings).reduce((sum, x) => sum + (x.points ?? 0), 0);
  state.assessments[r.id] = { id, score, ratings, at: new Date().toISOString() };
  state.workflow[r.id] = 'completed';
  return {
    id,
    rubric_id: `rub_${a.rubric}`,
    rubric_association_id: associationId(a),
    score,
    artifact_type: 'Submission',
    artifact_id: peerSubmissionId(r),
    artifact_attempt: 1,
    assessment_type: 'peer_review',
    assessor_id: user.id,
    assessor_name: user.name,
    data: Object.entries(ratings).map(([criterionId, x]) => ({
      id: x.rating_id,
      criterion_id: criterionId,
      points: x.points,
      comments: x.comments,
      comments_enabled: true,
    })),
    artifact: peerSubmissionJson(r, { anonymous: !!a.peerReviews?.anonymous }),
  };
}

export const routes = [
  { path: '/fake/graphql/peer-reviews', method: 'POST', handler: graphqlResolver },
  {
    path: '/api/v1/courses/:courseId/assignments/:assignmentId/anonymous_submissions/:anonymousId',
    handler: anonymousSubmission,
  },
  {
    path: '/api/v1/courses/:courseId/rubric_associations/:associationId/rubric_assessments',
    method: 'POST',
    handler: assessRubric,
  },
  { path: '/fake/peer-reviews/reset', method: 'POST', public: true, handler: reset },
];
