import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { Screen } from '@/design';
import { PageList } from '@/features/course/PageContent';
import { useRefreshControl } from '@/features/course/states';
import { GroupScope } from '@/features/groups/GroupScope';
import { useTranslation } from '@/i18n';

/** A group's pages (COURSE-7). */
export default function GroupPagesScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const context = useMemo(() => ({ type: 'group' as const, id: groupId }), [groupId]);
  const refreshControl = useRefreshControl([['groups', groupId, 'pages']]);
  return (
    <GroupScope groupId={groupId} title={t('pages.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-4">
        <PageList context={context} />
      </Screen>
    </GroupScope>
  );
}
