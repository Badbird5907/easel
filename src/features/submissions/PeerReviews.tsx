import { router } from 'expo-router';
import { CircleCheck, Clock, Eye, EyeOff, Lock, MessageSquare, UserRound } from 'lucide-react-native';
import { useLayoutEffect, useState } from 'react';
import { AccessibilityInfo, Alert, Pressable, View } from 'react-native';

import type { Assignment, RubricCriterion } from '@/canvas/api/assignments';
import {
  type PeerReview,
  type PeerReviewSet,
  type RubricRatingInput,
  usePeerReviews,
  usePeerWork,
  useSubmitPeerReview,
} from '@/canvas/api/peerReviews';
import { isOnline } from '@/features/offline/connectivity';
import { useAssignmentPresentation } from '@/features/course/assignmentPresentation';
import { feedbackNumber } from './feedbackPresentation';
import { peerLabel, peerFailure, usePeerOwner, usePeerRetry } from './peerReviewPresentation';
import type { Translate } from '@/i18n';
import { useCanvas } from '@/canvas/session';
import {
  Badge,
  Button,
  Callout,
  Card,
  Divider,
  haptics,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  Section,
  Skeleton,
  Text,
  TextField,
} from '@/design';
import { AttemptContent, CommentList } from '@/features/course/SubmissionParts';
import { useOnline } from '@/features/offline/useOnline';

export function peerReviewRoute(courseId: string, assignmentId: string, review: PeerReview) {
  return {
    pathname: '/peer-review/[courseId]/[assignmentId]/[reviewee]',
    params: { courseId, assignmentId, reviewee: review.key },
  } as const;
}

function reviewStatus(
  review: PeerReview,
  t: Translate,
): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (review.completed) return { label: t('peerReviews.done'), tone: 'success' };
  if (!review.available) return { label: t('peerReviews.notReady'), tone: 'neutral' };
  return { label: t('peerReviews.todo'), tone: 'warning' };
}

/**
 * The reviews assigned to the student on an assignment (ASSIGN-12), for the
 * assignment and submission screens. Each opens the review.
 */
export function PeerReviewList({ a }: { a: Assignment }) {
  const query = usePeerReviews(a.courseId, a.id, !!a.peerReviews);
  const { t, date: formatDateTime, shortDate: formatShortDateTime } = useAssignmentPresentation();
  const owner = usePeerOwner(JSON.stringify([a.courseId, a.id, !!a.peerReviews]), query.data ?? null);
  const retry = usePeerRetry(JSON.stringify([a.courseId, a.id]), [query.refetch]);
  if (!a.peerReviews) return null;
  if (query.isPending)
    return (
      <Section title={t('peerReviews.title')}>
        <Skeleton className="h-16 rounded-2xl" />
      </Section>
    );
  if (query.isError)
    return (
      <Section title={t('peerReviews.title')}>
        <Callout
          tone="warning"
          title={t('peerReviews.loadList')}
          action={{ label: t('peerReviews.retry'), onPress: retry }}
        >
          {t('peerReviews.listHelp')}
        </Callout>
      </Section>
    );
  const set = query.data;
  if (!set.reviews.length) return null;
  const left = set.reviews.filter((r) => !r.completed).length;
  const footer = [
    set.dueAt ? t('peerReviews.dueSentence', { date: formatDateTime(set.dueAt) }) : null,
    set.anonymous ? t('peerReviews.anonymousHelp') : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Section title={left ? t('peerReviews.leftTitle', { count: left }) : t('peerReviews.title')}>
      <ListGroup footer={footer || undefined}>
        {set.reviews.map((review) => {
          const status = reviewStatus(review, t);
          return (
            <ListItem
              key={review.id}
              leading={
                <IconTile
                  icon={review.completed ? CircleCheck : set.anonymous ? EyeOff : UserRound}
                  tone={review.completed ? 'success' : 'accent'}
                />
              }
              title={t('peerReviews.reviewName', { name: peerLabel(review, set.anonymous, t) })}
              subtitle={
                review.completed
                  ? t('peerReviews.finished')
                  : !review.available
                    ? t('peerReviews.workNotReady')
                    : review.submittedAt
                      ? t('peerReviews.submitted', { date: formatShortDateTime(review.submittedAt) })
                      : t('peerReviews.ready')
              }
              subtitleLines={1}
              trailing={
                <Badge tone={status.tone} size="sm">
                  {status.label}
                </Badge>
              }
              accessibilityLabel={t(
                set.anonymous || review.reviewee.kind === 'anonymous'
                  ? 'peerReviews.anonymousRow'
                  : 'peerReviews.rowLabel',
                { name: peerLabel(review, set.anonymous, t), status: status.label },
              )}
              onPress={() => {
                if (
                  owner.active &&
                  owner.current?.reviews.some((r) => r.id === review.id && r.key === review.key)
                )
                  router.push(peerReviewRoute(a.courseId, a.id, review) as never);
              }}
            />
          );
        })}
      </ListGroup>
    </Section>
  );
}

/** A rubric the reviewer fills in: one rating per criterion, with an optional comment. */
function RubricForm({
  criteria,
  value,
  onChange,
  hidePoints,
  hideTotal,
  disabled,
}: {
  criteria: RubricCriterion[];
  value: Record<string, RubricRatingInput>;
  onChange: (
    update: (current: Record<string, RubricRatingInput>) => Record<string, RubricRatingInput>,
    selection?: boolean,
  ) => void;
  hidePoints: boolean;
  hideTotal: boolean;
  disabled?: boolean;
}) {
  const { t, locale, points: formatPoints } = useAssignmentPresentation();
  const formatNumber = (n: number) => feedbackNumber(n, locale);
  const total = criteria.filter((c) => !c.ignoreForScoring).reduce((sum, c) => sum + c.points, 0);
  const earned = criteria.reduce((sum, c) => sum + (c.ignoreForScoring ? 0 : (value[c.id]?.points ?? 0)), 0);
  const rated = criteria.filter((c) => value[c.id]?.ratingId).length;
  return (
    <Card padding="none">
      {criteria.map((c, index) => {
        const current = value[c.id];
        return (
          <View key={c.id}>
            {index > 0 ? <Divider /> : null}
            <View className="gap-2.5 p-4">
              <View className="flex-row items-start gap-3" accessible accessibilityRole="header">
                <Text variant="headline" className="flex-1">
                  {c.description}
                </Text>
                {!hidePoints ? (
                  <Text variant="subhead" weight="semibold" tone={current ? 'default' : 'muted'} tabular>
                    {current?.points != null
                      ? `${formatNumber(current.points)}/${formatNumber(c.points)}`
                      : formatPoints(c.points)}
                  </Text>
                ) : null}
              </View>
              {c.longDescription ? (
                <Text variant="subhead" tone="muted">
                  {c.longDescription}
                </Text>
              ) : null}
              <View
                className="gap-1.5"
                accessibilityRole="radiogroup"
                accessibilityLabel={t('peerReviews.rating', { name: c.description })}
              >
                {c.ratings.map((r) => {
                  const chosen = current?.ratingId === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: chosen, disabled }}
                      accessibilityLabel={(() => {
                        const rating = hidePoints
                          ? r.description
                          : t('peerReviews.ratingPoints', {
                              name: r.description,
                              points: formatPoints(r.points) ?? '',
                            });
                        return r.longDescription
                          ? t('peerReviews.ratingDetail', { rating, detail: r.longDescription })
                          : rating;
                      })()}
                      disabled={disabled}
                      onPress={() => {
                        onChange(
                          (latest) => ({
                            ...latest,
                            [c.id]: {
                              ratingId: r.id,
                              points: r.points,
                              comments: latest[c.id]?.comments ?? '',
                            },
                          }),
                          true,
                        );
                      }}
                      className={
                        chosen
                          ? 'min-h-11 justify-center gap-0.5 rounded-xl border-[1.5px] border-accent bg-accent-soft px-3 py-2 active:opacity-80'
                          : 'min-h-11 justify-center gap-0.5 rounded-xl border-[1.5px] border-transparent bg-surface-sunken px-3 py-2 active:opacity-80'
                      }
                      style={{ borderCurve: 'continuous' }}
                    >
                      <View className="flex-row items-center gap-2">
                        <Text
                          variant="subhead"
                          weight={chosen ? 'semibold' : 'medium'}
                          tone={chosen ? 'accent' : 'default'}
                          className="flex-1"
                        >
                          {r.description}
                        </Text>
                        {!hidePoints ? (
                          <Text variant="footnote" tone={chosen ? 'accent' : 'muted'} tabular>
                            {formatPoints(r.points)}
                          </Text>
                        ) : null}
                      </View>
                      {r.longDescription ? (
                        <Text variant="footnote" tone="muted">
                          {r.longDescription}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <TextField
                placeholder={t('peerReviews.criterionPlaceholder')}
                accessibilityLabel={t('peerReviews.criterionLabel', { name: c.description })}
                value={current?.comments ?? ''}
                onChangeText={(comments) =>
                  onChange((latest) => ({
                    ...latest,
                    [c.id]: {
                      ratingId: latest[c.id]?.ratingId ?? null,
                      points: latest[c.id]?.points ?? null,
                      comments,
                    },
                  }))
                }
                multiline
                editable={!disabled}
              />
            </View>
          </View>
        );
      })}
      <Divider />
      <View
        className="flex-row items-center px-4 py-3"
        accessible
        accessibilityLabel={
          hidePoints || hideTotal
            ? t('peerReviews.ratedLabel', {
                rated: formatNumber(rated),
                total: formatNumber(criteria.length),
              })
            : t('peerReviews.scoreLabel', {
                rated: formatNumber(rated),
                total: formatNumber(criteria.length),
                earned: formatNumber(earned),
                points: formatNumber(total),
              })
        }
      >
        <Text variant="headline" className="flex-1">
          {t('peerReviews.rated', { rated: formatNumber(rated), total: formatNumber(criteria.length) })}
        </Text>
        {!hidePoints && !hideTotal ? (
          <Text variant="headline" tabular>
            {`${formatNumber(earned)}/${formatNumber(total)}`}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * One peer review (ASSIGN-12): the classmate's work (anonymized when the
 * assignment says so), the rubric to fill in when there is one, comments, and
 * "Submit review", which completes it in Canvas.
 */
export function PeerReviewBody({
  a,
  set,
  review,
  ready = true,
}: {
  a: Assignment;
  set: PeerReviewSet;
  review: PeerReview;
  ready?: boolean;
}) {
  const { account } = useCanvas();
  const { t, date: formatDateTime, shortDate: formatShortDateTime } = useAssignmentPresentation();
  const online = useOnline();
  const work = usePeerWork(a.courseId, a.id, review.reviewee, review.available);
  const submit = useSubmitPeerReview(a.courseId, a.id);
  const hasRubric = !!set.rubricAssociationId && !!a.rubric?.length;
  const hidePoints = set.hidePoints || a.restricted;
  const anonymous = set.anonymous || review.reviewee.kind === 'anonymous';
  const name = peerLabel(review, anonymous, t);
  // Completion/assessment refetches must not replace this resource's local work.
  const resource = JSON.stringify([
    a.courseId,
    a.id,
    set.assignmentId,
    review.id,
    review.key,
    review.reviewee.kind,
    review.reviewee.id,
  ]);
  const policy = JSON.stringify([
    a.peerReviews,
    review.available,
    set.rubricAssociationId,
    a.rubric?.map((criterion) => [
      criterion.id,
      criterion.description,
      criterion.longDescription,
      criterion.points,
      criterion.ignoreForScoring,
      criterion.ratings.map((rating) => [
        rating.id,
        rating.description,
        rating.longDescription,
        rating.points,
      ]),
    ]),
    set.hidePoints,
    set.hideTotal,
    a.restricted,
    anonymous,
    a.submission?.id,
    review.peerSubmissionId,
    work.data?.submissionId,
  ]);
  const initialRatings = Object.fromEntries(
    Object.entries(review.assessment?.ratings ?? {}).map(([id, r]) => [
      id,
      { ratingId: r.ratingId, points: r.points, comments: r.comments ?? '' },
    ]),
  );
  type Draft = { ratings: Record<string, RubricRatingInput>; comment: string };
  type Snapshot = Draft & { policy: string; eligible: boolean; revision: number };
  const owner = usePeerOwner<Snapshot>(resource);
  const [local, setLocal] = useState<{ owner: typeof owner; draft: Draft } | null>(null);
  const draft = local?.owner === owner ? local.draft : { ratings: initialRatings, comment: '' };
  if (local?.owner !== owner) setLocal({ owner, draft });
  const { ratings, comment } = draft;
  const [result, setResult] = useState<{
    owner: typeof owner;
    failure?: ReturnType<typeof peerFailure>;
    done?: boolean;
    pending?: boolean;
  } | null>(null);
  const failure = result?.owner === owner ? result.failure : undefined;
  const done = result?.owner === owner && result.done;
  const posting = result?.owner === owner && result.pending;
  const ratedAll = !hasRubric || a.rubric!.every((c) => !!ratings[c.id]?.ratingId);
  const ratedAny = !hasRubric || a.rubric!.some((c) => !!ratings[c.id]?.ratingId);
  const blocker = !online
    ? t('peerReviews.offline')
    : !ready || work.isError
      ? t('peerReviews.failedWork')
      : !work.data?.submissionId || !work.data.attempt || work.isPending
        ? t('peerReviews.loadingWork')
        : !review.available || !a.peerReviews
          ? t('peerReviews.unavailable')
          : hasRubric
            ? ratedAny
              ? null
              : t('peerReviews.chooseRating')
            : comment.trim()
              ? null
              : t('peerReviews.writeComment');
  const snapshot = { ...draft, policy, eligible: !blocker, revision: owner.revision };
  // Publish after commit, never from render. This follows the owner activation effect.
  useLayoutEffect(() => {
    if (owner.current?.policy !== policy || owner.current?.eligible !== snapshot.eligible)
      owner.confirm(null);
    owner.publish(snapshot);
  });
  const edit = (update: (draft: Draft) => Draft) => {
    if (!owner.active || owner.current?.policy !== policy) return false;
    const next = update(owner.current);
    owner.revise();
    owner.confirm(null);
    owner.publish({ ...owner.current, ...next, revision: owner.revision });
    setLocal({ owner, draft: next });
    if (!owner.operation) setResult(null);
    return true;
  };
  const retry = usePeerRetry(resource, [work.refetch]);
  const confirm = () => {
    const current = owner.current;
    if (
      !owner.active ||
      !current?.eligible ||
      !isOnline() ||
      owner.operation ||
      owner.confirmation ||
      current.policy !== policy ||
      owner.revision !== snapshot.revision
    )
      return;
    const claim = {};
    owner.confirm(claim);
    const revision = owner.revision;
    const request = {
      reviewee: { ...review.reviewee },
      peerSubmissionId: work.data!.submissionId,
      reviewerSubmissionId: a.submission?.id ?? null,
      rubricAssociationId: hasRubric ? set.rubricAssociationId : null,
      ratings: hasRubric
        ? Object.fromEntries(Object.entries(current.ratings).map(([id, r]) => [id, { ...r }]))
        : null,
      comment: current.comment,
    };
    const cancel = () => {
      if (owner.confirmation === claim) owner.confirm(null);
    };
    const send = async () => {
      if (!owner.active || owner.confirmation !== claim || owner.operation) return;
      cancel();
      if (
        owner.current?.policy !== policy ||
        !owner.current.eligible ||
        !isOnline() ||
        owner.revision !== revision
      )
        return;
      owner.send(claim);
      setResult({ owner, pending: true });
      const owns = () => owner.active && owner.operation === claim;
      try {
        const pending = submit.mutateAsync(request);
        // Installed MutationObserver.reset detaches synchronously, retaining this
        // mutation's original client and hook-level invalidation callbacks.
        submit.reset();
        await pending;
        if (!owns()) return;
        if (owner.current?.policy === policy && owner.revision === revision) {
          const next = { ratings: owner.current.ratings, comment: '' };
          owner.revise();
          owner.publish({ ...owner.current, ...next, revision: owner.revision });
          setLocal({ owner, draft: next });
          setResult({ owner, done: true });
          haptics.success();
          AccessibilityInfo.announceForAccessibility(t('peerReviews.announced'));
        } else setResult(null);
      } catch (error) {
        if (owns()) {
          if (owner.current?.policy === policy && owner.revision === revision) {
            setResult({ owner, failure: peerFailure(error) });
            haptics.error();
          } else setResult(null);
        }
      } finally {
        if (owns()) owner.send(null);
      }
    };
    Alert.alert(
      t(review.completed ? 'peerReviews.confirmUpdate' : 'peerReviews.confirmSubmit'),
      [
        t(
          hasRubric
            ? anonymous
              ? 'peerReviews.confirmRubricAnonymous'
              : 'peerReviews.confirmRubricName'
            : anonymous
              ? 'peerReviews.confirmCommentAnonymous'
              : 'peerReviews.confirmCommentName',
          { name },
        ),
        hasRubric && !ratedAll ? t('peerReviews.partial') : null,
        review.completed ? null : t('peerReviews.marksDone'),
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: t('peerReviews.cancel'), style: 'cancel', onPress: cancel },
        { text: t(review.completed ? 'peerReviews.update' : 'peerReviews.submit'), onPress: send },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  };
  const header = (
    <View className="gap-2">
      <Text variant="title2" accessibilityRole="header">
        {t(anonymous ? 'peerReviews.headerAnonymous' : 'peerReviews.headerName', { name })}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge tone={reviewStatus(review, t).tone}>
          {review.completed ? t('peerReviews.reviewDone') : reviewStatus(review, t).label}
        </Badge>
        <Text variant="subhead" tone="muted">
          {[a.name, set.dueAt ? t('peerReviews.due', { date: formatShortDateTime(set.dueAt) }) : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {anonymous ? (
        <View className="flex-row items-center gap-1.5">
          <Icon icon={EyeOff} size={14} tone="muted" />
          <Text variant="footnote" tone="muted">
            {t('peerReviews.bodyAnonymous')}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!review.available)
    return (
      <>
        {header}
        <Callout tone="info" icon={Lock} title={t('peerReviews.unavailable')}>
          {(a.submission?.attempt ?? 0) === 0
            ? t('peerReviews.submitOwn')
            : t(anonymous ? 'peerReviews.waitAnonymous' : 'peerReviews.waitName', { name })}
        </Callout>
      </>
    );

  return (
    <>
      {header}

      {done ? (
        <Callout tone="success" icon={CircleCheck} title={t('peerReviews.sent')}>
          {t(anonymous ? 'peerReviews.thanksAnonymous' : 'peerReviews.thanksName', { name })}
        </Callout>
      ) : null}

      <Section title={t(anonymous ? 'peerReviews.theirWork' : 'peerReviews.nameWork', { name })}>
        {work.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : work.isError ? (
          <Callout
            tone="warning"
            title={t('peerReviews.loadWork')}
            action={{ label: t('peerReviews.retry'), onPress: retry }}
          >
            {t('peerReviews.connectionHelp')}
          </Callout>
        ) : work.data?.attempt ? (
          <>
            {work.data.attempt.submittedAt ? (
              <View className="flex-row items-center gap-1.5 px-1">
                <Icon icon={Clock} size={14} tone="muted" />
                <Text variant="footnote" tone="muted">
                  {t('peerReviews.submitted', { date: formatDateTime(work.data.attempt.submittedAt) })}
                </Text>
              </View>
            ) : null}
            <AttemptContent attempt={work.data.attempt} assignment={a} />
          </>
        ) : (
          <Text variant="subhead" tone="muted" className="px-1">
            {t('peerReviews.nothing')}
          </Text>
        )}
      </Section>

      {hasRubric ? (
        <Section title={t('peerReviews.rubric')}>
          <RubricForm
            criteria={a.rubric!}
            value={ratings}
            onChange={(update, selection) => {
              if (edit((latest) => ({ ...latest, ratings: update(latest.ratings) })) && selection)
                haptics.selection();
            }}
            hidePoints={hidePoints}
            hideTotal={set.hideTotal}
          />
        </Section>
      ) : null}

      <Section title={t('peerReviews.comments')}>
        {work.data?.comments.length ? (
          <CommentList
            comments={work.data.comments}
            courseId={a.courseId}
            showAttempt={false}
            selfId={account.user.id}
          />
        ) : null}
        <TextField
          label={hasRubric ? t('peerReviews.optionalComment') : t('peerReviews.feedback')}
          placeholder={
            hasRubric
              ? t('peerReviews.rubricPlaceholder')
              : t(anonymous ? 'peerReviews.commentAnonymous' : 'peerReviews.commentName', { name })
          }
          value={comment}
          onChangeText={(v) => edit((latest) => ({ ...latest, comment: v }))}
          multiline
          editable
          helperText={hasRubric ? undefined : t('peerReviews.commentHelp')}
        />
      </Section>

      {failure ? (
        <Callout tone="danger" title={t('peerReviews.notSent')}>
          {t(`peerReviews.${failure.reason}`, { detail: 'detail' in failure ? (failure.detail ?? '') : '' })}
        </Callout>
      ) : null}

      <View className="gap-2">
        <Button
          size="lg"
          leadingIcon={hasRubric ? undefined : MessageSquare}
          onPress={confirm}
          loading={posting}
          disabled={!!blocker || posting}
          accessibilityHint={blocker ?? undefined}
        >
          {review.completed || done
            ? hasRubric
              ? t('peerReviews.updateReview')
              : t('peerReviews.anotherComment')
            : t('peerReviews.submit')}
        </Button>
        <Text variant="footnote" tone="muted" align="center">
          {blocker ?? t(anonymous ? 'peerReviews.reviewingAnonymous' : 'peerReviews.reviewingName', { name })}
        </Text>
      </View>
    </>
  );
}

/** The assignment's reviews, with what's left, for the peer review list screen. */
export function PeerReviewSummary({ set }: { set: PeerReviewSet }) {
  const { t, number, date: formatDateTime } = useAssignmentPresentation();
  const left = set.reviews.filter((r) => !r.completed).length;
  return (
    <Card className="flex-row items-center gap-3">
      <IconTile icon={left ? Eye : CircleCheck} tone={left ? 'accent' : 'success'} />
      <View className="flex-1 gap-0.5">
        <Text variant="headline">
          {left
            ? t('peerReviews.summary', { left: number(left), total: number(set.reviews.length) })
            : t('peerReviews.allDone')}
        </Text>
        <Text variant="subhead" tone="muted">
          {set.dueAt ? t('peerReviews.due', { date: formatDateTime(set.dueAt) }) : t('peerReviews.noDue')}
        </Text>
      </View>
    </Card>
  );
}
