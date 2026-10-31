import type { Assignment } from '@/canvas/api/assignments';
import { isNativeSubmissionType, type NativeSubmissionType } from '@/canvas/api/submissions';
import type { LocalFile } from '@/canvas/uploads';
import { formatDateTime, joinList } from '@/features/course/format';
import { extensionOf } from '@/features/files/kinds';

/** Attempts left, or null when unlimited. */
export function attemptsLeft(a: Assignment): number | null {
  if (a.allowedAttempts === null) return null;
  const allowed = a.allowedAttempts + (a.submission?.extraAttempts ?? 0);
  return Math.max(0, allowed - (a.submission?.attempt ?? 0));
}

/** Types that can be turned in online at all, native or not. */
const ONLINE_TYPES = [
  'online_text_entry',
  'online_url',
  'online_upload',
  'media_recording',
  'student_annotation',
];

export type SubmitOptions = {
  /** What Easel can submit natively, in Canvas's order. */
  native: NativeSubmissionType[];
  /** Online types Easel hands to the browser (media recording, annotation). */
  browser: string[];
};

export function submitOptions(a: Assignment): SubmitOptions {
  const online = a.submissionTypes.filter((t) => ONLINE_TYPES.includes(t));
  return {
    native: online.filter(isNativeSubmissionType),
    browser: online.filter((t) => !isNativeSubmissionType(t)),
  };
}

/** Optional presentation only. Omitted callbacks retain the exact legacy English path. */
export type RulePresentation = {
  locked: () => string;
  attempts: (allowed: number) => string;
  closed: (date: Date, now: Date) => string;
  notAccepting: () => string;
  attempt: (next: number, allowed: number, last: boolean) => string;
};

/**
 * Why the student can't turn this in right now, or null when they can. Canvas's
 * `can_submit` decides when the API sent it; the lock and attempts explain why.
 */
export function submitBlocker(a: Assignment, now = new Date(), presentation?: RulePresentation): string | null {
  if (a.kind !== 'assignment') return null;
  if (a.locked) return a.lockExplanation ?? (presentation ? presentation.locked() : 'This assignment is locked.');
  const left = attemptsLeft(a);
  if (left === 0) {
    const allowed = (a.allowedAttempts ?? 0) + (a.submission?.extraAttempts ?? 0);
    return presentation ? presentation.attempts(allowed) : allowed === 1 ? 'You’ve used your only attempt.' : `You’ve used all ${allowed} attempts.`;
  }
  if (a.lockAt && a.lockAt < now) return presentation ? presentation.closed(a.lockAt, now) : `Submissions closed ${formatDateTime(a.lockAt, now)}.`;
  if (a.canSubmit === false) return presentation ? presentation.notAccepting() : 'Canvas isn’t accepting submissions for this assignment right now.';
  return null;
}

/** "This is attempt 2 of 3." for the confirmation, or null when attempts are unlimited. */
export function attemptNote(a: Assignment, presentation?: RulePresentation): string | null {
  if (a.allowedAttempts === null) return null;
  const allowed = a.allowedAttempts + (a.submission?.extraAttempts ?? 0);
  const next = (a.submission?.attempt ?? 0) + 1;
  const left = allowed - next;
  return presentation ? presentation.attempt(next, allowed, left === 0) : left === 0
    ? `This is your last attempt (${next} of ${allowed}).`
    : `This is attempt ${next} of ${allowed}.`;
}

/** "PDF or DOCX", for messages about allowed file types. */
export function extensionList(extensions: string[], locale?: string): string {
  if (locale !== undefined)
    return new Intl.ListFormat(locale, { style: 'long', type: 'disjunction' }).format(
      extensions.map((e) => e.toUpperCase()),
    );
  return joinList(extensions.map((e) => e.toUpperCase()))
    .replace(/, and /, ', or ')
    .replace(/ and /, ' or ');
}

/** Splits picked files into those the assignment accepts and those it doesn't. */
export function checkExtensions(files: LocalFile[], allowed: string[]) {
  if (!allowed.length) return { accepted: files, rejected: [] as LocalFile[] };
  const set = new Set(allowed.map((e) => e.toLowerCase().replace(/^\./, '')));
  // JPEG files often arrive as .jpeg when the assignment says jpg, and the other way around.
  const ok = (ext: string) =>
    set.has(ext) || (ext === 'jpeg' && set.has('jpg')) || (ext === 'jpg' && set.has('jpeg'));
  const accepted: LocalFile[] = [];
  const rejected: LocalFile[] = [];
  for (const file of files) (ok(extensionOf(file.name)) ? accepted : rejected).push(file);
  return { accepted, rejected };
}

/** Whether a scanned PDF or photos can be submitted, given the allowed types. */
export function acceptsExtension(allowed: string[], extension: string): boolean {
  return checkExtensions([{ uri: '', name: `x.${extension}` }], allowed).accepted.length > 0;
}

/** Canvas accepts http and https URLs, and adds http:// when there's no scheme. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}
