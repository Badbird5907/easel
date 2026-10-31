import { useQueryClient } from '@tanstack/react-query';

import { type CanvasClient, CanvasError } from '../client';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import {
  assignmentKeys,
  type CanvasSubmission,
  type SubmissionAttempt,
  type SubmissionComment,
  toSubmissionDetail,
} from './assignments';

/**
 * Peer reviews the student was assigned (ASSIGN-12). Canvas only tells a
 * student which reviews are theirs, and which rubric association to assess
 * with, through GraphQL (`assessmentRequestsForCurrentUser`, `rubricAssociation`;
 * the REST peer reviews API lists reviews *of* the student). The classmate's
 * work comes from the submissions API, comments from the `createSubmissionComment`
 * mutation with `reviewerSubmissionId` (which completes a review without a
 * rubric), and rubric assessments from
 * `POST /api/v1/courses/:id/rubric_associations/:id/rubric_assessments`.
 *
 * canvas-lms: app/graphql/types/assessment_request_type.rb,
 * app/graphql/mutations/create_submission_comment.rb,
 * app/controllers/rubric_assessments_controller.rb, app/models/assessment_request.rb.
 */

// Raw GraphQL shapes

type GraphQLResponse<T> = { data?: T | null; errors?: { message: string }[] };

type GqlRubricAssessment = {
  _id: string;
  score: number | null;
  assessmentRatings?:
    | {
        _id: string | null;
        points: number | null;
        comments: string | null;
        criterion: { _id: string } | null;
      }[]
    | null;
};

type GqlAssessmentRequest = {
  _id: string;
  workflowState: string;
  available: boolean | null;
  anonymousId: string | null;
  anonymizedUser: { _id: string; name: string } | null;
  submission: { _id: string; attempt: number; submittedAt: string | null } | null;
  rubricAssessment: GqlRubricAssessment | null;
};

type GqlPeerReviews = {
  assignment: {
    _id: string;
    peerReviews: { enabled: boolean | null; anonymousReviews: boolean | null; dueAt: string | null } | null;
    rubricAssociation: { _id: string; hidePoints: boolean; hideScoreTotal: boolean } | null;
    assessmentRequestsForCurrentUser: GqlAssessmentRequest[] | null;
  } | null;
};

const PEER_REVIEWS_QUERY = `query EaselPeerReviews($assignmentId: ID!) {
  assignment(id: $assignmentId) {
    _id
    peerReviews { enabled anonymousReviews dueAt }
    rubricAssociation { _id hidePoints hideScoreTotal }
    assessmentRequestsForCurrentUser {
      _id
      workflowState
      available
      anonymousId
      anonymizedUser { _id name }
      submission { _id attempt submittedAt }
      rubricAssessment {
        _id
        score
        assessmentRatings { _id points comments criterion { _id } }
      }
    }
  }
}`;

const COMMENT_MUTATION = `mutation EaselPeerReviewComment($submissionId: ID!, $reviewerSubmissionId: ID, $comment: String!) {
  createSubmissionComment(input: { submissionId: $submissionId, reviewerSubmissionId: $reviewerSubmissionId, comment: $comment }) {
    submissionComment { _id }
    errors { attribute message }
  }
}`;

async function graphql<T>(
  client: CanvasClient,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await client.request<GraphQLResponse<T>>('/api/graphql', {
    method: 'POST',
    body: { operationName, query, variables },
    signal,
  });
  if (response?.errors?.length) throw new CanvasError(response.errors[0].message, 400, '/api/graphql');
  if (!response?.data) throw new CanvasError('Canvas didn’t answer. Try again.', 400, '/api/graphql');
  return response.data;
}

// Models

/** Who's being reviewed: a classmate by user ID, or anonymously by their submission's anonymous ID. */
export type Reviewee = { kind: 'user'; id: string } | { kind: 'anonymous'; id: string };

/** `user-2001` or `anon-aSam3`, the route segment for one review. */
export const revieweeKey = (r: Reviewee) => `${r.kind === 'user' ? 'user' : 'anon'}-${r.id}`;

export function parseReviewee(key: string | undefined): Reviewee | null {
  const match = key?.match(/^(user|anon)-(.+)$/);
  if (!match) return null;
  return { kind: match[1] === 'user' ? 'user' : 'anonymous', id: match[2] };
}

export type PeerRubricAssessment = {
  id: string;
  score: number | null;
  ratings: Record<string, { ratingId: string | null; points: number | null; comments: string | null }>;
};

export type PeerReview = {
  /** The assessment request. */
  id: string;
  reviewee: Reviewee;
  key: string;
  /** Null on anonymous reviews. */
  name: string | null;
  /** "Maya Chen", or "Classmate 1" when anonymous. */
  label: string;
  /** Additive presentation provenance; absent in legacy cached models. */
  labelOrigin?: 'raw' | 'generated';
  labelOrdinal?: number;
  completed: boolean;
  /** Canvas lets the student see the work: the classmate submitted, and so did the student. */
  available: boolean;
  peerSubmissionId: string | null;
  submittedAt: Date | null;
  assessment: PeerRubricAssessment | null;
};

export type PeerReviewSet = {
  assignmentId: string;
  anonymous: boolean;
  dueAt: Date | null;
  /** Null when the assignment has no rubric to fill in. */
  rubricAssociationId: string | null;
  hidePoints: boolean;
  hideTotal: boolean;
  reviews: PeerReview[];
};

const toDate = (value?: string | null) => (value ? new Date(value) : null);

function toPeerReview(r: GqlAssessmentRequest, index: number): PeerReview | null {
  const reviewee: Reviewee | null = r.anonymizedUser
    ? { kind: 'user', id: String(r.anonymizedUser._id) }
    : r.anonymousId
      ? { kind: 'anonymous', id: r.anonymousId }
      : null;
  if (!reviewee) return null;
  const assessment = r.rubricAssessment;
  return {
    id: String(r._id),
    reviewee,
    key: revieweeKey(reviewee),
    name: r.anonymizedUser?.name ?? null,
    label: r.anonymizedUser?.name ?? `Classmate ${index + 1}`,
    labelOrigin: r.anonymizedUser?.name != null ? 'raw' : 'generated',
    ...(r.anonymizedUser?.name == null ? { labelOrdinal: index + 1 } : {}),
    completed: r.workflowState === 'completed',
    available: r.available !== false,
    peerSubmissionId: r.submission?._id ? String(r.submission._id) : null,
    submittedAt: toDate(r.submission?.submittedAt),
    assessment: assessment
      ? {
          id: String(assessment._id),
          score: assessment.score ?? null,
          ratings: Object.fromEntries(
            (assessment.assessmentRatings ?? [])
              .filter((x) => x.criterion?._id)
              .map((x) => [
                String(x.criterion!._id),
                {
                  ratingId: x._id ? String(x._id) : null,
                  points: x.points ?? null,
                  comments: x.comments || null,
                },
              ]),
          ),
        }
      : null,
  };
}

// Fetchers and hooks

export async function fetchPeerReviews(
  client: CanvasClient,
  assignmentId: string,
  signal?: AbortSignal,
): Promise<PeerReviewSet> {
  const data = await graphql<GqlPeerReviews>(
    client,
    'EaselPeerReviews',
    PEER_REVIEWS_QUERY,
    { assignmentId },
    signal,
  );
  const a = data.assignment;
  if (!a) throw new CanvasError('Canvas couldn’t find this assignment.', 404, '/api/graphql');
  return {
    assignmentId: String(a._id),
    anonymous: a.peerReviews?.anonymousReviews ?? false,
    dueAt: toDate(a.peerReviews?.dueAt),
    rubricAssociationId: a.rubricAssociation?._id ? String(a.rubricAssociation._id) : null,
    hidePoints: a.rubricAssociation?.hidePoints ?? false,
    hideTotal: a.rubricAssociation?.hideScoreTotal ?? false,
    reviews: (a.assessmentRequestsForCurrentUser ?? []).map(toPeerReview).filter((r): r is PeerReview => !!r),
  };
}

export const peerReviewKeys = {
  set: (courseId: string, assignmentId: string) =>
    ['courses', courseId, 'assignments', assignmentId, 'peer_reviews'] as const,
  work: (courseId: string, assignmentId: string, key: string) =>
    ['courses', courseId, 'assignments', assignmentId, 'peer_reviews', key] as const,
};

/** The reviews assigned to the student on one assignment. Pass `enabled: false` when peer reviews are off. */
export function usePeerReviews(courseId: string, assignmentId: string, enabled = true) {
  return useCanvasQuery(
    peerReviewKeys.set(courseId, assignmentId),
    (client, signal) => fetchPeerReviews(client, assignmentId, signal),
    { enabled },
  );
}

export type PeerWork = {
  submissionId: string;
  attempt: SubmissionAttempt | null;
  /** The student's own comments on this classmate's work. */
  comments: SubmissionComment[];
};

/** The classmate's submission, as Canvas shows it to a reviewer (anonymized when the reviews are). */
export async function fetchPeerWork(
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  reviewee: Reviewee,
  signal?: AbortSignal,
): Promise<PeerWork> {
  const base = `/api/v1/courses/${courseId}/assignments/${assignmentId}`;
  const path =
    reviewee.kind === 'user'
      ? `${base}/submissions/${reviewee.id}`
      : `${base}/anonymous_submissions/${encodeURIComponent(reviewee.id)}`;
  const raw = await client.get<CanvasSubmission>(path, { include: ['submission_comments'] }, signal);
  const detail = toSubmissionDetail(raw);
  return { submissionId: String(raw.id), attempt: detail.attempts[0] ?? null, comments: detail.comments };
}

export function usePeerWork(
  courseId: string,
  assignmentId: string,
  reviewee: Reviewee | null,
  enabled = true,
) {
  return useCanvasQuery(
    peerReviewKeys.work(courseId, assignmentId, reviewee ? revieweeKey(reviewee) : ''),
    (client, signal) => fetchPeerWork(client, courseId, assignmentId, reviewee!, signal),
    { enabled: enabled && !!reviewee },
  );
}

export type RubricRatingInput = { ratingId: string | null; points: number | null; comments: string };

/** `POST /api/v1/courses/:id/rubric_associations/:id/rubric_assessments` as a peer review. Completes the review. */
export async function submitPeerAssessment(
  client: CanvasClient,
  courseId: string,
  rubricAssociationId: string,
  reviewee: Reviewee,
  ratings: Record<string, RubricRatingInput>,
) {
  const assessment: Record<string, unknown> = {
    assessment_type: 'peer_review',
    ...(reviewee.kind === 'user' ? { user_id: reviewee.id } : { anonymous_id: reviewee.id }),
  };
  for (const [criterionId, r] of Object.entries(ratings)) {
    assessment[`criterion_${criterionId}`] = {
      ...(r.ratingId ? { rating_id: r.ratingId } : {}),
      points: r.points ?? '',
      comments: r.comments,
    };
  }
  await client.post<unknown>(
    `/api/v1/courses/${courseId}/rubric_associations/${rubricAssociationId}/rubric_assessments`,
    { rubric_assessment: assessment },
  );
}

/** Comments on the classmate's work. With `reviewerSubmissionId`, Canvas counts it toward the review. */
export async function postPeerComment(
  client: CanvasClient,
  peerSubmissionId: string,
  reviewerSubmissionId: string | null,
  comment: string,
) {
  const data = await graphql<{
    createSubmissionComment: { errors: { attribute?: string; message: string }[] | null } | null;
  }>(client, 'EaselPeerReviewComment', COMMENT_MUTATION, {
    submissionId: peerSubmissionId,
    reviewerSubmissionId,
    comment,
  });
  const errors = data.createSubmissionComment?.errors;
  if (errors?.length) throw new CanvasError(errors[0].message, 400, '/api/graphql');
}

function useInvalidatePeerReview(courseId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return () =>
    Promise.all(
      [
        peerReviewKeys.set(courseId, assignmentId),
        assignmentKeys.detail(courseId, assignmentId),
        ['planner'],
      ].map((key) => queryClient.invalidateQueries({ queryKey: [accountKey, ...key] })),
    );
}

export type PeerReviewSubmit = {
  reviewee: Reviewee;
  peerSubmissionId: string;
  reviewerSubmissionId: string | null;
  rubricAssociationId: string | null;
  ratings: Record<string, RubricRatingInput> | null;
  comment: string;
};

/**
 * Finishes a review: the rubric assessment when there's a rubric, then the
 * comment. Without a rubric the comment is what completes it.
 */
export function useSubmitPeerReview(courseId: string, assignmentId: string) {
  const invalidate = useInvalidatePeerReview(courseId, assignmentId);
  return useCanvasMutation(
    async (client, input: PeerReviewSubmit) => {
      if (input.rubricAssociationId && input.ratings)
        await submitPeerAssessment(
          client,
          courseId,
          input.rubricAssociationId,
          input.reviewee,
          input.ratings,
        );
      const comment = input.comment.trim();
      if (comment) await postPeerComment(client, input.peerSubmissionId, input.reviewerSubmissionId, comment);
    },
    { onSuccess: () => invalidate() },
  );
}
