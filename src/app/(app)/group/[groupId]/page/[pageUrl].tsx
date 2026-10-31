import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { Screen } from '@/design';
import { PageContent } from '@/features/course/PageContent';
import { useRefreshControl } from '@/features/course/states';
import { GroupScope } from '@/features/groups/GroupScope';
import { useTranslation } from '@/i18n';

/** One group page, or the group's front page (COURSE-7, CONTENT-8). */
export default function GroupPageScreen() {
  const { t } = useTranslation();
  const { groupId, pageUrl } = useLocalSearchParams<{ groupId: string; pageUrl: string }>();
  const context = useMemo(() => ({ type: 'group' as const, id: groupId }), [groupId]);
  const refreshControl = useRefreshControl([['groups', groupId, 'pages', pageUrl]]);
  return (
    <GroupScope groupId={groupId} title={pageUrl === 'front_page' ? t('pages.frontPage') : t('pages.page')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <PageContent context={context} pageUrl={pageUrl} />
      </Screen>
    </GroupScope>
  );
}
