/** Draft-only GraphQL fixture, matching Canvas SubmissionDraft and mutation payloads.
 * State is shared with submissions.mjs; saving a draft never creates an attempt/comment. */
const state = () => (globalThis.__easelFakeSubmissionDrafts ??= { drafts: {}, receipts: [] });
const error = (message) => ({ status: 200, body: { data: null, errors: [{ message }] } });
function findSubmission(id) {
  const course = globalThis.__easelFakeSubmissions?.course;
  if (!course) return null;
  // Same seeded courses as data.mjs; IDs come from submissionAttemptJson (s<assignmentId>).
  for (const courseId of ['201', '202', '203', '204', '205', '206']) {
    const a = course.assignmentById(courseId, String(id).replace(/^s/, ''));
    if (a) return { a, course, submission: course.submissionJson(a) };
  }
  return null;
}
export const routes = [{ method: 'POST', path: '/fake/graphql/submission-drafts', handler: ({ body }) => {
  const { operationName, variables = {} } = body;
  if (!['EaselSubmissionDraft', 'EaselSaveSubmissionDraft', 'EaselDeleteSubmissionDraft'].includes(operationName))
    return { status: 404, body: {} };
  const input = variables.input ?? {}, id = input.submissionId ?? variables.id;
  const found = findSubmission(id);
  if (!found) return error('not found');
  const { submission, a, course } = found;
  const attempt = submission.attempt ?? 0;
  const store = state(), key = `${id}:${input.attempt ?? attempt + 1}`;
  if (operationName === 'EaselSubmissionDraft') return { status: 200, body: { data: { submission: {
    _id: id, attempt, submissionDraft: store.drafts[`${id}:${attempt + 1}`] ?? null,
  } } } };
  if (course.lockFor(a).locked_for_user) return error('not authorized');
  if (operationName === 'EaselDeleteSubmissionDraft') {
    const keys = Object.keys(store.drafts).filter((k) => k.startsWith(`${id}:`));
    if (!keys.length) return error('no drafts found');
    const submissionDraftIds = keys.map((k) => store.drafts[k]._id);
    keys.forEach((k) => { delete store.drafts[k]; });
    return { status: 200, body: { data: { deleteSubmissionDraft: { submissionDraftIds, errors: null } } } };
  }
  const types = ['online_text_entry', 'online_url', 'online_upload', 'media_recording', 'basic_lti_launch', 'student_annotation'];
  if (!types.includes(input.activeSubmissionType) || !Number.isInteger(input.attempt) || input.attempt < 1)
    return error('invalid draft input');
  const draft = { _id: `draft-${key}`, submissionAttempt: input.attempt, activeSubmissionType: input.activeSubmissionType,
    body: null, url: null, attachments: [], mediaObject: null, externalTool: null, ltiLaunchUrl: null, resourceLinkLookupUuid: null,
    ...store.drafts[key], activeSubmissionType: input.activeSubmissionType };
  if (input.activeSubmissionType === 'online_text_entry') draft.body = input.body ?? null;
  if (input.activeSubmissionType === 'online_url') draft.url = input.url ?? null;
  if (input.activeSubmissionType === 'online_upload') {
    const ids = input.fileIds ?? [];
    if (ids.some((id) => !globalThis.__easelFakeSubmissions.files.has(id)))
      return { status: 200, body: { data: { createSubmissionDraft: { submissionDraft: null, errors: [{ attribute: 'fileIds', message: 'No attachments found' }] } } } };
    draft.attachments = ids.map((id) => ({ _id: id, displayName: globalThis.__easelFakeSubmissions.files.get(id).name }));
  }
  if (input.activeSubmissionType === 'media_recording') draft.mediaObject = input.mediaId ? { _id: input.mediaId } : null;
  if (input.activeSubmissionType === 'basic_lti_launch') {
    if (!input.externalToolId || !input.ltiLaunchUrl) return error('no matching external tool found');
    draft.externalTool = { _id: input.externalToolId }; draft.ltiLaunchUrl = input.ltiLaunchUrl;
    draft.resourceLinkLookupUuid = input.resourceLinkLookupUuid ?? null;
  }
  store.drafts[key] = draft;
  store.receipts.push({ operationName, submissionId: id, attempt: input.attempt, before: submission.workflow_state, after: course.submissionJson(a).workflow_state });
  return { status: 200, body: { data: { createSubmissionDraft: { submissionDraft: draft, errors: null } } } };
} }];
