import {
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Lock,
  type LucideIcon,
  MessageSquare,
  PenLine,
  Puzzle,
  Upload,
} from 'lucide-react-native';
import { View } from 'react-native';

import { type Assignment, type AssignmentKind, useAssignment } from '@/canvas/api/assignments';
import { useCanvas } from '@/canvas/session';
import {
  Badge,
  type BadgeTone,
  Button,
  Callout,
  Card,
  Icon,
  IconTile,
  ListGroup,
  Section,
  Text,
} from '@/design';
import { RichContent } from '@/features/content/RichContent';
import { useLaunchTool } from '@/features/lti/launch';
import { ReminderControl } from '@/features/reminders/ReminderControl';
import { GroupCard } from '@/features/submissions/GroupCard';
import { PeerReviewList } from '@/features/submissions/PeerReviews';
import { attemptsLeft, submitBlocker, submitOptions } from '@/features/submissions/rules';
import { mediaSlot, submissionSlot, summarize, useUploads } from '@/features/submissions/uploadStore';

import { type Fact, FactList } from './FactList';
import {
  useAssignmentPresentation,
  useAssignmentAction,
  useAssignmentOwner,
  assignmentActionKey,
  canEnterSubmission,
  type AssignmentPresentation,
} from './assignmentPresentation';
import type { Translate } from '@/i18n';
import { assignmentTarget, pushRoute } from './navigation';
import { DetailSkeleton, LoadError } from './states';

export { attemptsLeft };

export const assignmentKindIcon: Record<AssignmentKind, LucideIcon> = {
  assignment: FileText,
  quiz: ClipboardCheck,
  discussion: MessageSquare,
  external_tool: Puzzle,
  offline: PenLine,
};

/** The status badge for an assignment, or null when there's nothing to flag. */
export function assignmentBadge(
  a: Assignment,
  presentation?: { t: Translate } | number,
): { label: string; tone: BadgeTone } | null {
  // Array.map passes its index as the second argument; it is not presentation.
  const t = typeof presentation === 'object' ? presentation.t : undefined;
  const s = a.submission;
  if (s?.excused)
    return {
      label: t ? t('assignmentPresentation.excused') : 'Excused',
      tone: 'neutral',
    };
  switch (a.status) {
    case 'missing':
      return {
        label: t ? t('assignmentPresentation.missing') : 'Missing',
        tone: 'danger',
      };
    case 'graded':
      return {
        label: t ? t('assignmentPresentation.graded') : 'Graded',
        tone: 'success',
      };
    case 'submitted':
      return s?.late
        ? {
            label: t ? t('assignmentPresentation.submittedLate') : 'Submitted late',
            tone: 'warning',
          }
        : {
            label: t ? t('assignmentPresentation.submitted') : 'Submitted',
            tone: 'neutral',
          };
    default:
      return a.locked
        ? {
            label: t ? t('assignmentPresentation.locked') : 'Locked',
            tone: 'neutral',
          }
        : null;
  }
}

function attemptsFact(a: Assignment, p: AssignmentPresentation): string {
  const used = a.submission?.attempt ?? 0;
  if (a.allowedAttempts === null)
    return used > 0
      ? p.t('assignmentPresentation.usedUnlimited', { used: p.number(used) })
      : p.t('assignmentPresentation.unlimited');
  const allowed = a.allowedAttempts + (a.submission?.extraAttempts ?? 0);
  return p.t('assignmentPresentation.usedAllowed', {
    used: p.number(used),
    allowed: p.number(allowed),
  });
}

function pointsFact(a: Assignment, p: AssignmentPresentation): string | null {
  if (a.restricted) return a.gradingType === 'not_graded' ? p.t('assignmentPresentation.notGraded') : null;
  if (a.gradingType === 'not_graded') return p.t('assignmentPresentation.notGraded');
  if (a.gradingType === 'pass_fail') return p.t('assignmentPresentation.passFail');
  return p.points(a.points) ?? p.t('assignmentPresentation.notGraded');
}

/** The latest submission and grade. Opens attempts, comments, and the rubric (ASSIGN-10). */
function SubmissionCard({ a }: { a: Assignment }) {
  const p = useAssignmentPresentation();
  const { t } = p;
  const owner = useAssignmentOwner(JSON.stringify([a.courseId, a.id]));
  const s = a.submission;
  const hasSubmission = !!s && (s.attempt > 0 || s.submittedAt !== null);
  const graded = a.status === 'graded';
  if (!s || (!hasSubmission && !graded)) return null;

  const score = s.excused ? t('assignmentPresentation.excused') : p.grade(s.score, s.grade, a);
  const title = graded
    ? (score ?? t('assignmentPresentation.graded'))
    : s.late
      ? t('assignmentPresentation.submittedLate')
      : t('assignmentPresentation.submitted');
  const detail = [
    hasSubmission ? t('assignmentPresentation.attempt', { count: Math.max(s.attempt, 1) }) : null,
    s.submittedAt ? p.shortDate(s.submittedAt) : null,
    graded ? null : t('assignmentPresentation.waiting'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card
      onPress={() =>
        owner.active &&
        pushRoute({
          pathname: '/course/[courseId]/assignment/[assignmentId]/submission',
          params: { courseId: a.courseId, assignmentId: a.id },
        })
      }
      accessibilityLabel={t('assignmentPresentation.cardLabel', {
        title: graded ? t('assignmentPresentation.grade', { score: title }) : title,
        detail,
      })}
      className="flex-row items-center gap-3"
    >
      <IconTile icon={graded ? CircleCheck : Upload} tone={graded ? 'success' : 'accent'} />
      <View className="flex-1 gap-0.5">
        <Text variant="headline" tabular>
          {title}
        </Text>
        <Text variant="subhead" tone="muted">
          {detail || t('assignmentPresentation.feedback')}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={18} tone="subtle" flipInRTL />
    </Card>
  );
}

/** Opens the assignment on the Canvas web, signed in, for types Easel can't submit natively. */
function SignedInButton({ label, a, note }: { label: string; a: Assignment; note: string }) {
  const { t } = useAssignmentPresentation();
  const action = useAssignmentAction(assignmentActionKey(a));
  return (
    <View className="gap-2">
      <Button
        variant="secondary"
        trailingIcon={ExternalLink}
        loading={action.pending}
        onPress={() => action.browser(a.htmlUrl, () => canEnterSubmission(a))}
      >
        {label}
      </Button>
      <Text variant="footnote" tone="muted" align="center">
        {note}
      </Text>
      {action.failed ? <Text tone="danger">{t('assignmentPresentation.actionFailed')}</Text> : null}
    </View>
  );
}

/** External tool assignments launch through the LTI flow (ASSIGN-8, LTI-1). */
function OpenToolButton({ a }: { a: Assignment }) {
  const launchTool = useLaunchTool();
  const { t } = useAssignmentPresentation();
  const { account } = useCanvas();
  const action = useAssignmentAction(JSON.stringify([account.baseUrl, assignmentActionKey(a)]));
  const open = () =>
    action.run(
      (valid) =>
        launchTool(
          {
            courseId: a.courseId,
            assignmentId: a.id,
            launchType: 'assessment',
            title: a.name,
            fallbackUrl: a.htmlUrl,
          },
          { isCurrent: valid },
        ),
      () => !a.locked && a.kind === 'external_tool',
    );
  return (
    <View className="gap-2">
      <Button leadingIcon={Puzzle} loading={action.pending} onPress={open}>
        {t('assignmentPresentation.openTool')}
      </Button>
      {action.failed ? <Text tone="danger">{t('assignmentPresentation.actionFailed')}</Text> : null}
    </View>
  );
}

function SubmitAction({ a }: { a: Assignment }) {
  const p = useAssignmentPresentation();
  const { t } = p;
  const owner = useAssignmentOwner(assignmentActionKey(a));
  const { account } = useCanvas();
  const files = useUploads(submissionSlot(account.id, a.courseId, a.id));
  const recording = useUploads(mediaSlot(account.id, a.courseId, a.id));
  const uploads = summarize([...files, ...recording]);
  if (a.locked) return null;
  switch (a.kind) {
    case 'quiz':
      return (
        <Button onPress={() => owner.active && !a.locked && pushRoute(assignmentTarget(a))}>
          {t('assignmentPresentation.openQuiz')}
        </Button>
      );
    case 'discussion':
      return (
        <Button onPress={() => owner.active && !a.locked && pushRoute(assignmentTarget(a))}>
          {t('assignmentPresentation.openDiscussion')}
        </Button>
      );
    case 'external_tool':
      return <OpenToolButton a={a} />;
    case 'offline':
      return (
        <Text variant="subhead" tone="muted">
          {a.submissionTypes.includes('on_paper')
            ? t('assignmentPresentation.paper')
            : t('assignmentPresentation.offline')}
        </Text>
      );
    case 'assignment': {
      const blocker = submitBlocker(a, new Date(), p.rules);
      if (blocker !== null) {
        // A graded assignment with nothing left to do doesn't need a note.
        if (a.status === 'graded' && attemptsLeft(a) === 0) return null;
        return (
          <Text variant="subhead" tone="muted">
            {blocker}
          </Text>
        );
      }
      const options = submitOptions(a);
      const resubmit = (a.submission?.attempt ?? 0) > 0;
      if (!options.native.length) {
        return (
          <SignedInButton
            label={
              resubmit
                ? t('assignmentPresentation.resubmitBrowser')
                : t('assignmentPresentation.submitBrowser')
            }
            a={a}
            note={t('assignmentPresentation.browserNote')}
          />
        );
      }
      const inProgress =
        uploads.uploading > 0 || uploads.fileIds.length > 0 || uploads.failed > 0 || !!uploads.media;
      return (
        <View className="gap-2">
          <Button
            onPress={() =>
              owner.active &&
              canEnterSubmission(a) &&
              pushRoute({
                pathname: '/course/[courseId]/assignment/[assignmentId]/submit',
                params: { courseId: a.courseId, assignmentId: a.id },
              })
            }
          >
            {inProgress
              ? t('assignmentPresentation.continue')
              : resubmit
                ? t(
                    a.groupCategoryId
                      ? 'assignmentPresentation.resubmitGroup'
                      : 'assignmentPresentation.resubmit',
                  )
                : t(
                    a.groupCategoryId
                      ? 'assignmentPresentation.submitGroup'
                      : 'assignmentPresentation.submit',
                  )}
          </Button>
          {inProgress ? (
            <Text variant="footnote" tone="muted" align="center">
              {uploads.uploading
                ? t('assignmentPresentation.uploading', {
                    count: uploads.uploading,
                  })
                : uploads.media
                  ? t('assignmentPresentation.recordingReady')
                  : t('assignmentPresentation.filesReady')}
            </Text>
          ) : null}
        </View>
      );
    }
  }
}

/** Header, lock, submission, dates, and description for one assignment (ASSIGN-2). */
export function AssignmentBody({ a }: { a: Assignment }) {
  const p = useAssignmentPresentation();
  const { t } = p;
  const badge = assignmentBadge(a, p);
  const submittable = a.kind === 'assignment' || a.kind === 'external_tool';

  const facts: (Fact | null)[] = [
    {
      label: t('assignmentPresentation.due'),
      value: a.dueAt ? p.date(a.dueAt) : t('assignmentPresentation.noDue'),
      tone: a.status === 'missing' ? 'danger' : 'default',
    },
    a.unlockAt
      ? {
          label: t('assignmentPresentation.availableFrom'),
          value: p.date(a.unlockAt),
        }
      : null,
    a.lockAt
      ? {
          label: t('assignmentPresentation.availableUntil'),
          value: p.date(a.lockAt),
        }
      : null,
    pointsFact(a, p) ? { label: t('assignmentPresentation.points'), value: pointsFact(a, p)! } : null,
    submittable
      ? {
          label: t('assignmentPresentation.attempts'),
          value: attemptsFact(a, p),
        }
      : null,
    a.kind === 'assignment'
      ? {
          label: t('assignmentPresentation.submitAs'),
          value: p.list(a.submissionTypes.map((type) => p.type(type))),
        }
      : null,
    a.allowedExtensions.length
      ? {
          label: t('assignmentPresentation.fileTypes'),
          value: p.list(a.allowedExtensions),
        }
      : null,
  ];

  return (
    <>
      <View className="gap-2.5">
        <Text variant="title2" accessibilityRole="header">
          {a.name}
        </Text>
        {badge ? (
          <View className="flex-row">
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </View>
        ) : null}
      </View>

      {a.locked ? (
        <Callout tone="warning" icon={Lock} title={t('assignmentPresentation.locked')}>
          {a.lockExplanation ?? t('assignmentPresentation.lockedHelp')}
        </Callout>
      ) : null}

      <GroupCard a={a} />
      <SubmissionCard a={a} />
      <SubmitAction a={a} />
      <PeerReviewList a={a} />
      <FactList facts={facts} />
      {a.dueAt && !a.locked && a.kind !== 'offline' ? (
        <ListGroup>
          <ReminderControl
            item={{
              id: `assignment_${a.id}`,
              title: a.name,
              dueAt: a.dueAt,
              courseId: a.courseId,
              url: a.htmlUrl,
            }}
          />
        </ListGroup>
      ) : null}

      {a.html ? (
        <Section title={t('assignmentPresentation.instructions')}>
          <RichContent html={a.html} />
        </Section>
      ) : null}
    </>
  );
}

/** Loads and renders an assignment. Used by the assignment screen and module items. */
export function AssignmentDetails({ courseId, assignmentId }: { courseId: string; assignmentId: string }) {
  const { t } = useAssignmentPresentation();
  const action = useAssignmentAction(JSON.stringify([courseId, assignmentId]));
  const query = useAssignment(courseId, assignmentId);
  if (query.isPending) return <DetailSkeleton />;
  if (query.isError && !query.data)
    return (
      <LoadError
        title={t('assignmentPresentation.loadAssignment')}
        error={query.error}
        onRetry={() => action.run(() => query.refetch())}
      />
    );
  return <>
    <AssignmentBody a={query.data} />
    {query.isPlaceholderData && !query.data.html ? <DetailSkeleton /> : null}
  </>;
}
