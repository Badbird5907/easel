import { router } from 'expo-router';

import type { Assignment } from '@/canvas/api/assignments';
import { submissionFilesPath } from '@/canvas/api/submissions';
import type { CanvasClient } from '@/canvas/client';
import { textToHtml } from '@/features/editor/RichEditor';
import { saveDraft } from '@/features/submissions/drafts';
import { checkExtensions, extensionList, submitBlocker } from '@/features/submissions/rules';
import { addUploads, submissionSlot } from '@/features/submissions/uploadStore';
import type { Translate } from '@/i18n/types';

import { kindOf, type SharedContent } from './content';

/** The submission type that takes what was shared. */
const typeFor = {
  files: 'online_upload',
  url: 'online_url',
  text: 'online_text_entry',
} as const;

export type AssignmentFit = {
  assignment: Assignment;
  /** Null when it takes everything that was shared; otherwise why it doesn't. */
  problem: string | null;
};

/**
 * Open assignments in a course that could take the shared content (ASSIGN-16):
 * they accept its submission type and aren't locked, closed, or out of attempts.
 * Upload assignments that refuse some of the files are listed with the reason,
 * so the student knows why their assignment isn't offered.
 * Optional presentation translates only generated problems; omitted context
 * retains the exact legacy strings, restrictions and ordering.
 */
export function assignmentFits(
  assignments: Assignment[],
  content: SharedContent,
  presentation?: { t: Translate },
): AssignmentFit[] {
  const kind = kindOf(content);
  if (kind === 'none') return [];
  const type = typeFor[kind];
  return assignments
    .filter((a) => a.kind === 'assignment' && a.submissionTypes.includes(type) && !submitBlocker(a))
    .map((a) => {
      if (kind !== 'files') return { assignment: a, problem: null };
      const { rejected } = checkExtensions(content.files, a.allowedExtensions);
      if (!rejected.length) return { assignment: a, problem: null };
      if (presentation) {
        return {
          assignment: a,
          problem: presentation.t(
            content.files.length === 1 ? 'shareAssignments.onlyFiles' : 'shareAssignments.rejectedFiles',
            { extensions: extensionList(a.allowedExtensions), names: rejected.map((f) => f.name).join(', ') },
          ),
        };
      }
      const only = `Only takes ${extensionList(a.allowedExtensions)} files`;
      return {
        assignment: a,
        problem: content.files.length === 1 ? only : `${only}, so not ${rejected.map((f) => f.name).join(', ')}`,
      };
    })
    .sort((x, y) => {
      // Soonest due first; undated work last.
      const a = x.assignment.dueAt?.getTime() ?? Infinity;
      const b = y.assignment.dueAt?.getTime() ?? Infinity;
      return a === b ? x.assignment.name.localeCompare(y.assignment.name) : a - b;
    });
}

/**
 * Puts the shared content into the assignment's submission (files start
 * uploading; a link or text becomes the draft), then opens the submit screen,
 * which confirms before turning anything in.
 */
export function startSubmission(
  { accountId, client }: { accountId: string; client: CanvasClient },
  assignment: Assignment,
  content: SharedContent,
) {
  const kind = kindOf(content);
  if (kind === 'none') return;
  const { courseId, id: assignmentId } = assignment;
  if (kind === 'files') {
    addUploads(
      submissionSlot(accountId, courseId, assignmentId),
      { client, preflightPath: submissionFilesPath(courseId, assignmentId) },
      content.files.map(({ uri, name, size, mimeType }) => ({ uri, name, size, mimeType })),
    );
  } else if (kind === 'url') {
    saveDraft(accountId, courseId, assignmentId, 'url', content.url!);
  } else {
    saveDraft(accountId, courseId, assignmentId, 'text', textToHtml(content.text!));
  }
  router.push({
    pathname: '/course/[courseId]/assignment/[assignmentId]/submit',
    params: { courseId, assignmentId, type: typeFor[kind] },
  } as never);
}
