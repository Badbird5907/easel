import { useQueryClient } from '@tanstack/react-query';

import { consumeDraft } from '@/features/submissions/draftState';

import { type CanvasClient, CanvasError } from '../client';
import { htmlToText } from '../html';
import { useAccountKey, useCanvasMutation, useCanvasQuery } from '../query';
import { fetchMediaService } from '../uploads';
import {
  assignmentKeys,
  type CanvasSubmission,
  type SubmissionDetail,
  toSubmissionDetail,
} from './assignments';

/**
 * Turning in work and talking about it (ASSIGN-3 to ASSIGN-5, ASSIGN-11).
 * Shapes follow app/controllers/submissions_controller.rb#create and
 * submissions_api_controller.rb#update; files go through Canvas's three-step
 * upload (`uploadToCanvas`) with the preflight paths below.
 */

/** Submission types Easel can turn in natively, in the order the submit screen offers them. */
export const nativeSubmissionTypes = [
  'online_text_entry',
  'online_url',
  'online_upload',
  'media_recording',
  'student_annotation',
] as const;
export type NativeSubmissionType = (typeof nativeSubmissionTypes)[number];

export const isNativeSubmissionType = (type: string): type is NativeSubmissionType =>
  (nativeSubmissionTypes as readonly string[]).includes(type);

/** Preflight for files the student is about to submit. */
export const submissionFilesPath = (courseId: string, assignmentId: string) =>
  `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self/files`;

/** Preflight for files attached to a submission comment. */
export const commentFilesPath = (courseId: string, assignmentId: string) =>
  `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self/comments/files`;

export type SubmitInput =
  | { type: 'online_text_entry'; body: string }
  | { type: 'online_url'; url: string }
  | { type: 'online_upload'; fileIds: string[] }
  /** A Kaltura media entry, after `uploadMediaToKaltura` (ASSIGN-6). */
  | { type: 'media_recording'; mediaId: string; mediaType: 'audio' | 'video' }
  /** The student's annotations on the assignment's document, made in DocViewer (ASSIGN-7). */
  | { type: 'student_annotation'; annotatableAttachmentId: string }
  /** A link a tool returned from its `homework_submission` picker (ASSIGN-9). */
  | { type: 'basic_lti_launch'; url: string; resourceLinkLookupUuid?: string | null };

export type SubmitRequest = SubmitInput & {
  /** Optional note to the instructor, sent as `comment[text_comment]`. */
  comment?: string;
};

function submissionBody(input: SubmitInput) {
  switch (input.type) {
    case 'online_text_entry':
      return { submission_type: input.type, body: input.body };
    case 'online_url':
      return { submission_type: input.type, url: input.url };
    case 'online_upload':
      return { submission_type: input.type, file_ids: input.fileIds };
    case 'media_recording':
      return {
        submission_type: input.type,
        media_comment_id: input.mediaId,
        media_comment_type: input.mediaType,
      };
    case 'student_annotation':
      return { submission_type: input.type, annotatable_attachment_id: input.annotatableAttachmentId };
    case 'basic_lti_launch':
      return {
        submission_type: input.type,
        url: input.url,
        ...(input.resourceLinkLookupUuid && { resource_link_lookup_uuid: input.resourceLinkLookupUuid }),
      };
  }
}

/** `POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions`. */
export async function submitAssignment(
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  request: SubmitRequest,
): Promise<SubmissionDetail> {
  const comment = request.comment?.trim();
  const raw = await client.post<CanvasSubmission>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
    {
      submission: submissionBody(request),
      ...(comment ? { comment: { text_comment: comment } } : {}),
    },
  );
  return toSubmissionDetail(raw);
}

export type CommentInput = {
  text?: string;
  fileIds?: string[];
  /** The attempt the comment is about. Canvas shows comments per attempt. */
  attempt?: number | null;
};

/** `PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/self` with `comment[...]`. */
export async function addSubmissionComment(
  client: CanvasClient,
  courseId: string,
  assignmentId: string,
  input: CommentInput,
): Promise<SubmissionDetail> {
  const text = input.text?.trim();
  const raw = await client.put<CanvasSubmission>(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self`,
    {
      comment: {
        ...(text ? { text_comment: text } : {}),
        ...(input.fileIds?.length ? { file_ids: input.fileIds } : {}),
        ...(input.attempt ? { attempt: input.attempt } : {}),
      },
    },
    { include: ['submission_comments'] },
  );
  return toSubmissionDetail(raw);
}

/**
 * Everything a submission changes: the assignment and its submission, course
 * lists and grades, module requirements, and the planner (To Do and Home).
 */
function useInvalidateAfterSubmit(courseId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return () =>
    Promise.all(
      [
        assignmentKeys.detail(courseId, assignmentId),
        assignmentKeys.groups(courseId),
        ['courses', courseId, 'modules'],
        ['courses', courseId, 'syllabus'],
        ['grades', courseId],
        ['planner'],
      ].map((key) => queryClient.invalidateQueries({ queryKey: [accountKey, ...key] })),
    );
}

export function useSubmitAssignment(courseId: string, assignmentId: string, draftAttempt?: number) {
  const invalidate = useInvalidateAfterSubmit(courseId, assignmentId);
  const accountId = useAccountKey();
  return useCanvasMutation(
    async (client, request: SubmitRequest) => {
      const owner = accountId;
      const detail = await submitAssignment(client, courseId, assignmentId, request);
      consumeDraft({ accountId: owner, courseId, assignmentId, attempt: detail.attempt });
      if (draftAttempt !== undefined && draftAttempt !== detail.attempt)
        consumeDraft({ accountId: owner, courseId, assignmentId, attempt: draftAttempt });
      return detail;
    },
    { onSuccess: () => invalidate() },
  );
}

export function useAddSubmissionComment(courseId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  return useCanvasMutation(
    (client, input: CommentInput) => addSubmissionComment(client, courseId, assignmentId, input),
    {
      onSuccess: (detail) => {
        // Show the new comment right away; the refetch fills in anything the PUT left out.
        const key = [accountKey, ...assignmentKeys.submission(courseId, assignmentId)];
        queryClient.setQueryData<SubmissionDetail>(key, (old) =>
          old ? { ...old, comments: detail.comments } : old,
        );
        return queryClient.invalidateQueries({ queryKey: key });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Media recordings (ASSIGN-6)

/** Whether the school's Canvas takes audio and video recordings (Kaltura). Cached for the session. */
export function useMediaService() {
  return useCanvasQuery(['services', 'kaltura'], (client, signal) => fetchMediaService(client, signal), {
    staleTime: 30 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Student annotation (ASSIGN-7): canvadoc_sessions_controller.rb#create

export type AnnotationSession = {
  /** DocViewer, signed for this student and this submission's annotations. */
  url: string;
  launchId: string | null;
};

/**
 * `POST /api/v1/canvadoc_session` for the student's own annotations on the
 * assignment's document. `draft` is the attempt in progress; a number reopens a
 * submitted attempt read-only.
 */
export async function createAnnotationSession(
  client: CanvasClient,
  submissionId: string,
  attempt: 'draft' | number,
): Promise<AnnotationSession> {
  const data = await client.post<{ canvadocs_session_url?: string; annotation_context_launch_id?: string }>(
    '/api/v1/canvadoc_session',
    { submission_attempt: attempt === 'draft' ? 'draft' : String(attempt), submission_id: submissionId },
  );
  if (!data?.canvadocs_session_url)
    throw new CanvasError('Canvas didn’t open DocViewer for this document.', 400, '/api/v1/canvadoc_session');
  return {
    url: new URL(data.canvadocs_session_url, client.baseUrl).toString(),
    launchId: data.annotation_context_launch_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tool pickers (ASSIGN-9): lti_apps_controller.rb#launch_definitions, the
// `homework_submission` placement, and external_tools_controller.rb#resource_selection.

type CanvasLaunchDefinition = {
  definition_type: string;
  definition_id: string;
  name: string;
  description?: string | null;
  domain?: string | null;
  url?: string | null;
  placements?: {
    homework_submission?: { title?: string | null; url?: string | null; message_type?: string };
  };
};

export type HomeworkTool = {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
};

/** Tools in the course that can hand back work to submit: Google Drive, OneDrive, Studio, and others. */
export async function fetchHomeworkTools(
  client: CanvasClient,
  courseId: string,
  signal?: AbortSignal,
): Promise<HomeworkTool[]> {
  const list = await client.getAll<CanvasLaunchDefinition>(
    `/api/v1/courses/${courseId}/lti_apps/launch_definitions`,
    { placements: ['homework_submission'] },
    { signal },
  );
  return list
    .filter((d) => d.definition_type === 'ContextExternalTool' && d.placements?.homework_submission)
    .map((d) => ({
      id: String(d.definition_id),
      name: d.placements?.homework_submission?.title || d.name,
      description: d.description ? htmlToText(d.description) : null,
      domain: d.domain ?? null,
    }));
}

export function useHomeworkTools(courseId: string, enabled = true) {
  return useCanvasQuery(
    ['courses', courseId, 'homework_tools'],
    (client, signal) => fetchHomeworkTools(client, courseId, signal),
    { enabled, staleTime: 10 * 60_000 },
  );
}

/** Canvas's own page that launches a tool's picker for this assignment, as the web does. */
export const homeworkPickerPath = (courseId: string, toolId: string, assignmentId: string) =>
  `/courses/${courseId}/external_tools/${toolId}/resource_selection?launch_type=homework_submission&assignment_id=${assignmentId}`;

// ---------------------------------------------------------------------------
// Group assignments (ASSIGN-13)

type CanvasGroup = {
  id: string;
  name: string;
  course_id?: string | null;
  group_category_id?: string | null;
  members_count?: number;
};

type CanvasGroupMember = { id: string; name: string; short_name?: string; avatar_url?: string | null };

export type SubmissionGroup = {
  /** Absent on legacy caches; an empty legacy roster has unknown availability. */
  membersStatus?: 'loaded' | 'unavailable';
  id: string;
  name: string;
  members: { id: string; name: string; avatarUrl: string | null }[];
};

/**
 * The student's group in the assignment's group set, with its members, or null
 * when they aren't in one yet (Canvas then takes the submission for them alone).
 */
export async function fetchSubmissionGroup(
  client: CanvasClient,
  courseId: string,
  groupCategoryId: string,
  signal?: AbortSignal,
): Promise<SubmissionGroup | null> {
  const groups = await client.getAll<CanvasGroup>(
    '/api/v1/users/self/groups',
    { context_type: 'Course' },
    { signal },
  );
  const group = groups.find(
    (g) => String(g.course_id) === courseId && String(g.group_category_id) === groupCategoryId,
  );
  if (!group) return null;
  let membersStatus: NonNullable<SubmissionGroup['membersStatus']> = 'loaded';
  const members = await client
    .getAll<CanvasGroupMember>(`/api/v1/groups/${group.id}/users`, { include: ['avatar_url'] }, { signal })
    .catch((error: unknown) => {
      // Cancellation and expired credentials must still reach the query/session layer.
      if (
        signal?.aborted ||
        (error as Error | null)?.name === 'AbortError' ||
        (error instanceof CanvasError && error.status === 401)
      ) {
        throw error;
      }
      membersStatus = 'unavailable';
      return [] as CanvasGroupMember[];
    });
  signal?.throwIfAborted();
  return {
    id: String(group.id),
    name: group.name,
    membersStatus,
    members: members.map((m) => ({ id: String(m.id), name: m.name, avatarUrl: m.avatar_url ?? null })),
  };
}

export function useSubmissionGroup(courseId: string, groupCategoryId: string | null) {
  return useCanvasQuery(
    ['courses', courseId, 'submission_group', groupCategoryId ?? ''],
    (client, signal) => fetchSubmissionGroup(client, courseId, groupCategoryId!, signal),
    { enabled: !!groupCategoryId },
  );
}
