import { useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useRef } from 'react';
import type { ScrollView } from 'react-native';

import { useAssignment } from '@/canvas/api/assignments';
import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { DetailSkeleton, LoadError } from '@/features/course/states';
import { SubmitForm } from '@/features/submissions/SubmitForm';

/** Turn in an assignment natively: text, URL, or files (ASSIGN-3, ASSIGN-4, ASSIGN-5). */
export default function SubmitScreen() {
  const { courseId, assignmentId, type } = useLocalSearchParams<{
    courseId: string;
    assignmentId: string;
    type?: string;
  }>();
  const query = useAssignment(courseId, assignmentId);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Screen hands every prop, ref included, to its ScrollView; ScreenProps doesn't declare ref yet.
  const scrollProps = { ref: scrollRef } as object;

  let body;
  if (query.isPending) body = <DetailSkeleton />;
  else if (query.isError)
    body = <LoadError title="Couldn’t load this assignment" error={query.error} onRetry={() => query.refetch()} />;
  else body = <SubmitForm a={query.data} initialType={type} scrollViewRef={scrollRef} />;

  return (
    <CourseScope courseId={courseId} title="Submit">
      <Screen {...scrollProps} automaticallyAdjustKeyboardInsets contentClassName="gap-6">
        {body}
      </Screen>
    </CourseScope>
  );
}
