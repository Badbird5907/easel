import { type CanvasClient, CanvasError } from '../client';

/** Canvas schema.graphql + assignments/graphql/student/{Queries,Mutations,SubmissionDraft}.
 * Deliberately contains no submission/comment/message mutation. */
export type DraftContent =
  | { activeSubmissionType: 'online_text_entry'; body: string }
  | { activeSubmissionType: 'online_url'; url: string }
  | { activeSubmissionType: 'online_upload'; fileIds: string[] }
  | { activeSubmissionType: 'media_recording'; mediaId: string | null }
  | { activeSubmissionType: 'basic_lti_launch'; externalToolId: string; ltiLaunchUrl: string; resourceLinkLookupUuid?: string };

export type ServerDraft = {
  _id: string;
  submissionAttempt: number;
  activeSubmissionType: string;
  body: string | null;
  url: string | null;
};
export type DraftSubmission = { _id: string; attempt: number | null; submissionDraft: ServerDraft | null };
const fields = '_id submissionAttempt activeSubmissionType body(rewriteUrls: false) url';
type Errors = { message: string }[] | null;
async function graphql<T>(client: CanvasClient, operationName: string, query: string, variables: object) {
  const response = await client.post<{ data?: T; errors?: Errors }>('/api/graphql', { operationName, query, variables });
  if (response.errors?.length || !response.data)
    throw new CanvasError(response.errors?.map((e) => e.message).join('; ') || 'Canvas draft sync is unavailable.', 400, '/api/graphql');
  return response.data;
}
export async function fetchSubmissionDraft(client: CanvasClient, submissionId: string): Promise<DraftSubmission> {
  const data = await graphql<{ submission: DraftSubmission | null }>(client, 'EaselSubmissionDraft',
    `query EaselSubmissionDraft($id: ID!) { submission(id: $id) { _id attempt submissionDraft { ${fields} } } }`, { id: submissionId });
  if (!data.submission) throw new CanvasError('Canvas did not return this submission.', 403, '/api/graphql');
  return data.submission;
}
export async function saveSubmissionDraft(client: CanvasClient, submissionId: string, attempt: number, content: DraftContent) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('A draft needs an explicit next attempt.');
  const data = await graphql<{ createSubmissionDraft: { submissionDraft: ServerDraft | null; errors: Errors } }>(client,
    'EaselSaveSubmissionDraft', `mutation EaselSaveSubmissionDraft($input: CreateSubmissionDraftInput!) {
      createSubmissionDraft(input: $input) { submissionDraft { ${fields} } errors { attribute message } }
    }`, { input: { ...content, submissionId, attempt } });
  const result = data.createSubmissionDraft;
  if (result.errors?.length || !result.submissionDraft)
    throw new CanvasError(result.errors?.map((e) => e.message).join('; ') || 'Canvas did not save the draft.', 400, '/api/graphql');
  return result.submissionDraft;
}
export async function deleteSubmissionDraft(client: CanvasClient, submissionId: string) {
  try {
    const data = await graphql<{ deleteSubmissionDraft: { errors: Errors } }>(client, 'EaselDeleteSubmissionDraft',
      `mutation EaselDeleteSubmissionDraft($input: DeleteSubmissionDraftInput!) {
        deleteSubmissionDraft(input: $input) { submissionDraftIds errors { attribute message } }
      }`, { input: { submissionId } });
    if (data.deleteSubmissionDraft.errors?.length)
      throw new CanvasError(data.deleteSubmissionDraft.errors.map((e) => e.message).join('; '), 400, '/api/graphql');
  } catch (error) {
    if (!(error instanceof CanvasError && error.message === 'no drafts found')) throw error;
  }
}
