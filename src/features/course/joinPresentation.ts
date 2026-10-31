import { JoinError } from '@/canvas/api/enrollments';
import type { Translate } from '@/i18n';

/** Only tagged Easel fallbacks are translated; legacy and server errors stay verbatim. */
export function joinErrorMessage(error: Error, t: Translate): string {
  const meta = error instanceof JoinError ? error.presentation : undefined;
  if (!meta) return error.message;
  const message = meta.reason === 'status'
    ? t('courses.joinError.status', { status: meta.status ?? '' })
    : t(`courses.joinError.${meta.reason}`);
  return meta.detail ? `${message} ${meta.detail}` : message;
}
