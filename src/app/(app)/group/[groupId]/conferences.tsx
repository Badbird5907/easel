import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from '@/i18n';

import { Screen } from '@/design';
import { ConferenceList } from '@/features/conferences/ConferenceList';
import { useRefreshControl } from '@/features/course/states';
import { GroupScope } from '@/features/groups/GroupScope';

/** A group's conferences, with Join and recordings (CONTENT-11). */
export default function GroupConferencesScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const context = useMemo(() => ({ type: 'group' as const, id: groupId }), [groupId]);
  const refreshControl = useRefreshControl([['conferences', 'group', groupId]]);
  return (
    <GroupScope groupId={groupId} title={t('conferences.title')}>
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        <ConferenceList context={context} />
      </Screen>
    </GroupScope>
  );
}
