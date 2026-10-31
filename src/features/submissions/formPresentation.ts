import type { Assignment } from '@/canvas/api/assignments';
import type { SubmitInput, SubmissionGroup } from '@/canvas/api/submissions';
import { CanvasNetworkError } from '@/canvas/client';
import type { Translate } from '@/i18n';
import type { DateContext } from '@/lib/dates';
import { groupPhrase } from './GroupCard';
import type { RulePresentation } from './rules';

export function formRules(t: Translate, dates: DateContext): RulePresentation {
  const number = (n: number) => new Intl.NumberFormat(dates.locale).format(n);
  return {
    locked: () => t('submissionForm.locked'),
    attempts: (allowed) =>
      allowed === 1
        ? t('submissionForm.onlyAttempt')
        : t('submissionForm.usedAttempts', { count: allowed }),
    closed: (date, now) => t('submissionForm.closed', { date: formDate(date, dates, now) }),
    notAccepting: () => t('submissionForm.notAccepting'),
    attempt: (next, allowed, last) =>
      t(last ? 'submissionForm.lastAttempt' : 'submissionForm.nextAttempt', {
        next: number(next),
        allowed: number(allowed),
      }),
  };
}

/** Same civil-year/date policy as the legacy course formatter, with explicit locale/zone. */
export function formDate(date: Date, dates: DateContext, now = new Date()) {
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(dates.locale, {
      calendar: 'gregory',
      ...options,
      timeZone: dates.timeZone,
    });
  const sameYear = fmt({ year: 'numeric' }).format(date) === fmt({ year: 'numeric' }).format(now);
  return dates.t('date.at', {
    day: fmt({
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(!sameYear && { year: 'numeric' }),
    }).format(date),
    time: dates.formatTime(date),
  });
}

export type FormFailure =
  { reason: 'network' | 'attempts' | 'generic' } | { reason: 'detail'; detail: string };
/** Compatibility: these two English-pattern classifications existed in failureMessage.
 * Do not extend them or treat arbitrary matching text as a local error origin. */
export function formFailure(error: unknown): FormFailure {
  if (error instanceof CanvasNetworkError) return { reason: 'network' };
  const message = error instanceof Error ? error.message : '';
  if (/maximum number of allowed attempts/i.test(message)) return { reason: 'attempts' };
  if (!message || /^Canvas returned an error/.test(message)) return { reason: 'generic' };
  return { reason: 'detail', detail: message.replace(/\.$/, '') };
}
export function failureText(failure: FormFailure, t: Translate) {
  switch (failure.reason) {
    case 'network':
      return t('submissionForm.networkFailure');
    case 'attempts':
      return t('submissionForm.attemptsFailure');
    case 'generic':
      return t('submissionForm.genericFailure');
    case 'detail':
      return t('submissionForm.detailFailure', { detail: failure.detail });
  }
}

export function confirmation(
  request: SubmitInput,
  a: Assignment,
  group: SubmissionGroup | null,
  recording: boolean,
  tool: { title: string | null; toolName: string } | null,
  t: Translate,
) {
  const params = { name: a.name, group: group ? groupPhrase(group, t) : '' };
  switch (request.type) {
    case 'online_text_entry':
      return t(group ? 'submissionForm.confirmTextGroup' : 'submissionForm.confirmText', params);
    case 'online_url':
      return t(group ? 'submissionForm.confirmUrlGroup' : 'submissionForm.confirmUrl', {
        ...params,
        url: request.url,
      });
    case 'online_upload':
      return recording
        ? t(
            group
              ? 'submissionForm.confirmRecordingFileGroup'
              : 'submissionForm.confirmRecordingFile',
            params,
          )
        : t(group ? 'submissionForm.confirmFileGroup' : 'submissionForm.confirmFile', {
            ...params,
            count: request.fileIds.length,
          });
    case 'media_recording':
      return request.mediaType === 'audio'
        ? t(group ? 'submissionForm.confirmAudioGroup' : 'submissionForm.confirmAudio', params)
        : t(group ? 'submissionForm.confirmVideoGroup' : 'submissionForm.confirmVideo', params);
    case 'student_annotation':
      return t(
        group ? 'submissionForm.confirmAnnotationGroup' : 'submissionForm.confirmAnnotation',
        params,
      );
    case 'basic_lti_launch':
      return tool?.title != null
        ? t(group ? 'submissionForm.confirmToolGroup' : 'submissionForm.confirmTool', {
            ...params,
            title: tool.title,
            tool: tool.toolName,
          })
        : t(group ? 'submissionForm.confirmToolPickGroup' : 'submissionForm.confirmToolPick', {
            ...params,
            tool: tool?.toolName ?? '',
          });
  }
}
const knownTypes = [
  'online_upload',
  'online_text_entry',
  'online_url',
  'media_recording',
  'student_annotation',
  'online_quiz',
  'discussion_topic',
  'external_tool',
  'on_paper',
  'none',
  'not_graded',
  'wiki_page',
] as const;
export function formTypeLabel(type: string, t: Translate): string {
  const known = knownTypes.find(
    (v) => v === (type === 'basic_lti_launch' ? 'external_tool' : type),
  );
  return known ? t(`submissionForm.type.${known}`) : type.replace(/_/g, ' ');
}
