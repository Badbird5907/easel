import { router, useLocalSearchParams } from 'expo-router';
import { Upload } from 'lucide-react-native';
import { type ComponentRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keyboard, type ScrollView, View } from 'react-native';

import {
  type Assignment,
  type SubmissionDetail,
  useAssignment,
  useSubmission,
} from '@/canvas/api/assignments';
import { useCanvas } from '@/canvas/session';
import { Badge, Button, Card, EmptyState, Screen, Section, Text } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import {
  useAssignmentPresentation,
  useAssignmentOwner,
  useAssignmentAction,
  assignmentActionKey,
  canEnterSubmission,
  type AssignmentPresentation,
} from '@/features/course/assignmentPresentation';
import { pushRoute } from '@/features/course/navigation';
import { ChipRow } from '@/features/course/Pickers';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { AttemptContent, CommentList, RubricView } from '@/features/course/SubmissionParts';
import { CommentComposer } from '@/features/submissions/CommentComposer';
import { PeerReviewList } from '@/features/submissions/PeerReviews';
import { submitBlocker, submitOptions } from '@/features/submissions/rules';
import { useSubmissionCommentsViewed } from '@/features/submissions/useSubmissionCommentsViewed';

function gradeSummary(
  a: Assignment,
  s: SubmissionDetail,
  p: AssignmentPresentation,
): { text: string; tone: 'default' | 'danger' | 'muted' } {
  const { t } = p;
  if (s.excused) return { text: t('assignmentPresentation.excused'), tone: 'default' };
  const score = p.grade(s.score, s.grade, a);
  if (a.status === 'graded' && score)
    return {
      text: t('assignmentPresentation.grade', { score }),
      tone: 'default',
    };
  if (a.status === 'submitted')
    return {
      text: score
        ? t('assignmentPresentation.earlierGrade', { score })
        : t('assignmentPresentation.submittedWaiting'),
      tone: 'muted',
    };
  if (a.status === 'missing') return { text: t('assignmentPresentation.missing'), tone: 'danger' };
  return { text: t('assignmentPresentation.notSubmittedYet'), tone: 'muted' };
}

/** A Canvas link to a classmate's submission is a peer review (ASSIGN-12). */
function peerUserId(canvasUrl: string | undefined, selfId: string, submissionUserId?: string): string | null {
  const id = submissionUserId ?? canvasUrl?.match(/\/submissions\/(\d+)/)?.[1];
  return id && id !== 'self' && id !== selfId ? id : null;
}

/** The student's submission: every attempt, the rubric, and comments (ASSIGN-10, ASSIGN-11). */
export default function SubmissionScreen() {
  const { courseId, assignmentId, canvasUrl, submissionUserId } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    canvasUrl?: string;
    submissionUserId?: string;
  }>();
  const { account } = useCanvas();
  const p = useAssignmentPresentation();
  const { t } = p;
  const resource = JSON.stringify([courseId, assignmentId]);
  const owner = useAssignmentOwner(resource);
  const peer = peerUserId(canvasUrl, account.user.id, submissionUserId);
  useEffect(() => {
    if (peer && owner.active)
      router.replace({
        pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
        params: { courseId, assignmentId, reviewee: `user-${peer}` },
      } as never);
  }, [peer, courseId, assignmentId, owner]);
  const assignment = useAssignment(courseId, assignmentId);
  const submission = useSubmission(courseId, assignmentId);
  useSubmissionCommentsViewed(
    courseId,
    !peer && !assignment.isError && !submission.isError && assignment.data ? submission.data : undefined,
  );
  const [choice, setChoice] = useState<{
    owner: typeof owner;
    value: string;
  } | null>(null);
  const chosen = choice?.owner === owner ? choice.value : null;
  const selectedAttempt =
    submission.data?.attempts.find((x) => String(x.attempt) === chosen) ?? submission.data?.attempts[0];
  const attemptOwner = useAssignmentOwner(JSON.stringify([resource, selectedAttempt?.attempt, peer]));
  const action = useAssignmentAction(
    JSON.stringify([
      resource,
      selectedAttempt?.attempt,
      peer,
      assignment.data ? assignmentActionKey(assignment.data) : null,
    ]),
  );
  const refreshControl = useRefreshControl([['courses', courseId, 'assignments', assignmentId]]);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Screen hands every prop, ref included, to its ScrollView; ScreenProps doesn't declare ref yet.
  const scrollProps = { ref: scrollRef } as object;
  // The composer is the last thing on screen: once the keyboard is up, show all of it, Send included.
  const keyboardCleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(
    () => () => {
      keyboardCleanup.current?.();
      keyboardCleanup.current = null;
    },
    [attemptOwner],
  );
  const revealComposer = () => {
    if (!attemptOwner.active) return;
    keyboardCleanup.current?.();
    let listening = true;
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      if (!listening) return;
      cleanup();
      if (attemptOwner.active) scrollRef.current?.scrollToEnd({ animated: true });
    });
    const timer = setTimeout(() => cleanup(), 1500);
    const cleanup = () => {
      listening = false;
      shown.remove();
      clearTimeout(timer);
    };
    keyboardCleanup.current = cleanup;
  };

  const failed = assignment.error ?? submission.error;
  const retry = () =>
    action.run(async (valid) => {
      // Settle both so one rejection cannot release the duplicate claim early.
      await Promise.allSettled([
        Promise.resolve().then(() => (valid() ? assignment.refetch() : undefined)),
        Promise.resolve().then(() => (valid() ? submission.refetch() : undefined)),
      ]);
    });

  let body;
  if (assignment.isPending || submission.isPending) {
    body = failed ? (
      <LoadError title={t('assignmentPresentation.loadSubmission')} error={failed} onRetry={retry} />
    ) : (
      <DetailSkeleton />
    );
  } else if (failed) {
    body = <LoadError title={t('assignmentPresentation.loadSubmission')} error={failed} onRetry={retry} />;
  } else {
    const a = assignment.data!;
    const s = submission.data!;
    const selected = selectedAttempt;
    const summary = gradeSummary(a, s, p);
    const options = submitOptions(a);
    const canSubmit =
      a.kind === 'assignment' &&
      submitBlocker(a, new Date(), p.rules) === null &&
      options.native.length + options.browser.length > 0;
    const submitNatively = options.native.length > 0;
    const startSubmit = () => {
      if (!action.owner.active || !canEnterSubmission(a) || !canSubmit) return;
      return submitNatively
        ? pushRoute({
            pathname: '/course/[courseId]/assignment/[assignmentId]/submit',
            params: { courseId: a.courseId, assignmentId: a.id },
          })
        : action.browser(a.htmlUrl, () => canEnterSubmission(a));
    };

    body = (
      <>
        {action.failed ? <Text tone="danger">{t('assignmentPresentation.actionFailed')}</Text> : null}
        <View className="gap-1.5">
          <Text variant="title2" accessibilityRole="header">
            {a.name}
          </Text>
          <Text variant="body" weight="medium" tone={summary.tone} tabular>
            {summary.text}
          </Text>
        </View>

        {s.attempts.length > 1 ? (
          <ChipRow
            options={s.attempts.map((x, i) => ({
              value: String(x.attempt),
              label:
                i === 0
                  ? t('assignmentPresentation.latestAttempt', {
                      count: x.attempt,
                    })
                  : t('assignmentPresentation.attempt', { count: x.attempt }),
            }))}
            value={String(selected?.attempt)}
            onChange={(value) => {
              if (attemptOwner.active) setChoice({ owner, value });
            }}
            accessibilityLabel={t('assignmentPresentation.chooseAttempt')}
          />
        ) : null}

        {selected ? (
          <Section title={t('assignmentPresentation.yourSubmission')}>
            <View className="flex-row flex-wrap items-center gap-2 px-1">
              <Text variant="footnote" tone="muted">
                {selected.submittedAt
                  ? t('assignmentPresentation.attemptDate', {
                      count: selected.attempt,
                      date: p.date(selected.submittedAt),
                    })
                  : t('assignmentPresentation.attempt', {
                      count: selected.attempt,
                    })}
              </Text>
              {selected.late ? (
                <Badge tone="warning" size="sm">
                  {t('assignmentPresentation.late')}
                </Badge>
              ) : null}
            </View>
            <AttemptContent attempt={selected} assignment={a} />
            {canSubmit ? (
              <Button variant="tonal" onPress={startSubmit}>
                {submitNatively
                  ? t('assignmentPresentation.resubmit')
                  : t('assignmentPresentation.resubmitBrowser')}
              </Button>
            ) : null}
          </Section>
        ) : (
          <Card padding="none">
            <EmptyState
              icon={Upload}
              title={t('assignmentPresentation.nothingSubmitted')}
              description={
                canSubmit
                  ? t('assignmentPresentation.submissionHelp')
                  : t('assignmentPresentation.feedbackHelp')
              }
              action={
                canSubmit
                  ? {
                      label: submitNatively
                        ? t('assignmentPresentation.submit')
                        : t('assignmentPresentation.submitBrowser'),
                      onPress: startSubmit,
                    }
                  : undefined
              }
            />
          </Card>
        )}

        {a.rubric?.length ? (
          <Section title={t('assignmentPresentation.rubric')}>
            <RubricView
              criteria={a.rubric}
              assessment={s.rubricAssessment}
              hidePoints={a.rubricHidesPoints || a.restricted}
              hideTotal={a.rubricHidesTotal}
            />
          </Section>
        ) : null}

        <PeerReviewList a={a} />

        <Section title={t('assignmentPresentation.comments')}>
          {s.comments.length ? (
            <CommentList
              comments={s.comments}
              courseId={courseId}
              showAttempt={s.attempts.length > 1}
              selfId={account.user.id}
            />
          ) : (
            <Text variant="subhead" tone="muted" className="px-1">
              {t('assignmentPresentation.noComments')}
            </Text>
          )}
          <CommentComposer
            courseId={courseId}
            assignmentId={assignmentId}
            attempt={selected?.attempt ?? null}
            onFocus={revealComposer}
          />
        </Section>
      </>
    );
  }

  return (
    <CourseScope courseId={courseId} title={t('assignmentPresentation.submission')}>
      <Screen
        {...scrollProps}
        refreshControl={refreshControl}
        automaticallyAdjustKeyboardInsets
        contentClassName="gap-6"
      >
        {body}
      </Screen>
    </CourseScope>
  );
}
