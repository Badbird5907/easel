import { useTranslation } from '@/i18n';
import { usePeerRetry } from '@/features/submissions/peerReviewPresentation';
import { useLocalSearchParams } from 'expo-router';
import { UserRoundX } from 'lucide-react-native';

import { useAssignment } from '@/canvas/api/assignments';
import { parseReviewee, revieweeKey, usePeerReviews } from '@/canvas/api/peerReviews';
import { Card, EmptyState, Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { PeerReviewBody } from '@/features/submissions/PeerReviews';

/**
 * One peer review (ASSIGN-12), from the assignment, the submission screen, or a
 * To Do item. `reviewee` is `user-<id>` or `anon-<anonymous id>`.
 */
export default function PeerReviewScreen() {
  const { courseId, assignmentId, reviewee } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    reviewee: string;
  }>();
  const { t } = useTranslation();
  const assignment = useAssignment(courseId, assignmentId);
  const reviews = usePeerReviews(courseId, assignmentId);
  const refreshControl = useRefreshControl([['courses', courseId, 'assignments', assignmentId]]);
  const target = parseReviewee(reviewee);
  const key = target ? revieweeKey(target) : null;

  const retry = usePeerRetry(JSON.stringify([courseId, assignmentId, reviewee]), [
    assignment.refetch,
    reviews.refetch,
  ]);

  let body;
  const failed = assignment.error ?? reviews.error;
  if (failed && (!assignment.data || !reviews.data)) {
    body = <LoadError title={t('peerReviews.loadReview')} error={failed} onRetry={retry} />;
  } else if (assignment.isPending || reviews.isPending) {
    body = <DetailSkeleton />;
  } else {
    const review = reviews.data!.reviews.find((r) => r.key === key);
    body = review ? (
      <>
        {failed ? <LoadError title={t('peerReviews.loadReview')} error={failed} onRetry={retry} /> : null}
        <PeerReviewBody
          a={assignment.data!}
          set={reviews.data!}
          review={review}
          ready={!assignment.isError && !reviews.isError}
        />
      </>
    ) : (
      <Card padding="none">
        <EmptyState
          icon={UserRoundX}
          title={t('peerReviews.missingTitle')}
          description={t('peerReviews.missingHelp')}
        />
      </Card>
    );
  }

  return (
    <CourseScope courseId={courseId} title={t('peerReviews.single')}>
      <Screen
        refreshControl={refreshControl}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentClassName="gap-6"
      >
        {body}
      </Screen>
    </CourseScope>
  );
}
