import { quizFilePreflightPath } from '@/canvas/api/quizzes';
import type { CanvasClient } from '@/canvas/client';
import { type LocalFile, uploadToCanvas } from '@/canvas/uploads';

/**
 * Uploads a file for a file-upload question (QUIZ-3) through Canvas's
 * three-step upload. The quiz preflight answers `{ attachments: [preflight] }`
 * (`api_attachment_preflight_json`) rather than a bare preflight, so the client
 * handed to `uploadToCanvas` unwraps it. Drop the wrapper once `uploadToCanvas`
 * unwraps `attachments` itself (integration request in the wave report).
 */
export async function uploadQuizFile(
  client: CanvasClient,
  courseId: string,
  quizId: string,
  file: LocalFile,
  onProgress?: (fraction: number | null) => void,
) {
  const preflight = quizFilePreflightPath(courseId, quizId);
  const unwrapping = Object.create(client) as CanvasClient;
  unwrapping.post = async <T>(path: string, body?: unknown, query?: Parameters<CanvasClient['post']>[2]) => {
    const result = await client.post<T & { attachments?: unknown[] }>(path, body, query);
    if (path === preflight && Array.isArray(result?.attachments) && result.attachments[0])
      return result.attachments[0] as T;
    return result as T;
  };
  return uploadToCanvas(unwrapping, preflight, file, { onProgress });
}
