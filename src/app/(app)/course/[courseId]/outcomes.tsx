import { useTranslation } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { ListSkeleton } from '@/features/course/states';
import { TabDisabled, useTabGate } from '@/features/course/TabGate';
import { OutcomeList } from '@/features/outcomes/OutcomeList';

export default function CourseOutcomesScreen() {
  const { t } = useTranslation();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const gate = useTabGate(courseId, 'outcomes');
  return (
    <CourseScope courseId={courseId} title={t('outcomes.title')}>
      {gate === 'open' ? <OutcomeList courseId={courseId} /> : (
        <Screen>{gate === 'hidden' ? <TabDisabled courseId={courseId} label={t('outcomes.title')} /> : <ListSkeleton />}</Screen>
      )}
    </CourseScope>
  );
}
