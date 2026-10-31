import { useTranslation } from '@/i18n';
import { usePeerRetry } from '@/features/submissions/peerReviewPresentation';
import { useLocalSearchParams } from 'expo-router';
import { Users } from 'lucide-react-native';

import { useAssignment } from '@/canvas/api/assignments';
import { usePeerReviews } from '@/canvas/api/peerReviews';
import { Card, EmptyState, Screen, Text } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { DetailSkeleton, LoadError, useRefreshControl } from '@/features/course/states';
import { PeerReviewList, PeerReviewSummary } from '@/features/submissions/PeerReviews';

/** Every review the student was assigned on one assignment (ASSIGN-12), from a Canvas peer reviews link. */
export default function PeerReviewsScreen() {
  const { courseId, assignmentId } = useLocalSearchParams<{ courseId: string; assignmentId: string }>();
  const { t } = useTranslation();
  const assignment = useAssignment(courseId, assignmentId);
  const reviews = usePeerReviews(courseId, assignmentId);
  const refreshControl = useRefreshControl([['courses', courseId, 'assignments', assignmentId]]);

  const retry = usePeerRetry(JSON.stringify([courseId, assignmentId]), [assignment.refetch, reviews.refetch]);

  let body;
  const failed = assignment.error ?? reviews.error;
  if (failed) {
    body = <LoadError title={t('peerReviews.loadList')} error={failed} onRetry={retry} />;
  } else if (assignment.isPending || reviews.isPending) {
    body = <DetailSkeleton />;
  } else if (!reviews.data!.reviews.length) {
    body = (
      <Card padding="none">
        <EmptyState
          icon={Users}
          title={t('peerReviews.emptyTitle')}
          description={t('peerReviews.emptyHelp')}
        />
      </Card>
    );
  } else {
    body = (
      <>
        <Text variant="title2" accessibilityRole="header">
          {assignment.data!.name}
        </Text>
        <PeerReviewSummary set={reviews.data!} />
        <PeerReviewList a={assignment.data!} />
      </>
    );
  }

  return (
    <CourseScope courseId={courseId} title={t('peerReviews.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {body}
      </Screen>
    </CourseScope>
  );
}
