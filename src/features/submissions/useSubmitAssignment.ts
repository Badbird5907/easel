import { useQueryClient } from '@tanstack/react-query';
import { assignmentKeys } from '@/canvas/api/assignments';
import { submitAssignment, type SubmitRequest } from '@/canvas/api/submissions';
import { useAccountKey, useCanvasMutation } from '@/canvas/query';
import { markSubmittedWork } from '@/features/planner/submissionCache';
import { consumeDraft } from './draftState';

/** Publish accepted submissions before any reconciliation reads finish. */
export function useSubmitAssignment(courseId: string, assignmentId: string, draftAttempt?: number) {
  const queryClient = useQueryClient();
  const accountId = useAccountKey();
  return useCanvasMutation(
    async (client, request: SubmitRequest) => {
      const detail = await submitAssignment(client, courseId, assignmentId, request);
      markSubmittedWork(queryClient, accountId, { courseId, assignmentId });
      const key = [accountId, ...assignmentKeys.submission(courseId, assignmentId)];
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, detail);
      consumeDraft({ accountId, courseId, assignmentId, attempt: detail.attempt });
      if (draftAttempt !== undefined && draftAttempt !== detail.attempt)
        consumeDraft({ accountId, courseId, assignmentId, attempt: draftAttempt });
      return detail;
    },
    {
      onSuccess: () =>
        Promise.all(
          [
            assignmentKeys.detail(courseId, assignmentId),
            assignmentKeys.groups(courseId),
            ['courses', courseId, 'modules'],
            ['courses', courseId, 'syllabus'],
            ['grades', courseId],
          ].map((key) => queryClient.invalidateQueries({ queryKey: [accountId, ...key] })),
        ),
    },
  );
}
