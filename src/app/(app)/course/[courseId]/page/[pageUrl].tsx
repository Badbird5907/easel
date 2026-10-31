import { useLocalSearchParams } from 'expo-router';

import { FRONT_PAGE } from '@/canvas/api/pages';
import { Screen } from '@/design';
import { CourseScope } from '@/features/course/CourseScope';
import { PageContent } from '@/features/course/PageContent';
import { useRefreshControl } from '@/features/course/states';
import { useTranslation } from '@/i18n';

/** One page, or the course's front page when `pageUrl` is `front_page` (CONTENT-8). */
export default function PageScreen() {
  const { t } = useTranslation();
  const { courseId, pageUrl } = useLocalSearchParams<{ courseId: string; pageUrl: string }>();
  const refreshControl = useRefreshControl([['courses', courseId, 'pages', pageUrl]]);
  return (
    <CourseScope courseId={courseId} title={pageUrl === FRONT_PAGE ? t('pages.frontPage') : t('pages.page')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <PageContent courseId={courseId} pageUrl={pageUrl} />
      </Screen>
    </CourseScope>
  );
}
