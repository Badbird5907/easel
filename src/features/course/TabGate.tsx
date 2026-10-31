import { router } from 'expo-router';
import { EyeOff } from 'lucide-react-native';
import { useTranslation } from '@/i18n';

import { useCourseTabs } from '@/canvas/api/tabs';
import { Card, EmptyState } from '@/design';

export type TabGate = 'pending' | 'open' | 'hidden';

/**
 * Whether a course tab's screen is available (COURSE-5). Canvas leaves hidden
 * tabs out of a student's tab list, or marks them hidden; either way the screen
 * is off, as the web says ("That page has been disabled for this course").
 * Pages, assignments, and quizzes linked from elsewhere still open; only the
 * lists are blocked. Failing to load the tabs never blocks anything.
 */
export function useTabGate(courseId: string, tabId: string, bypass = false): TabGate {
  const tabs = useCourseTabs(courseId);
  if (bypass || tabs.isError) return 'open';
  if (tabs.isPending) return 'pending';
  const tab = tabs.data.find((t) => t.id === tabId);
  return tab && !tab.hidden ? 'open' : 'hidden';
}

/** Shown in place of a list whose tab the instructor turned off. */
export function TabDisabled({ courseId, label }: { courseId: string; label: string }) {
  const { t } = useTranslation();
  const leave = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/course/[courseId]', params: { courseId } } as never);
  return (
    <Card padding="none">
      <EmptyState
        icon={EyeOff}
        title={t('course.tabDisabled')}
        description={t('course.tabDisabledHelp', { label })}
        action={{ label: t('course.goBack'), onPress: leave }}
      />
    </Card>
  );
}
