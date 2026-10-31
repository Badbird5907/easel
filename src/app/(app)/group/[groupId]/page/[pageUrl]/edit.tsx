import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { PageEditor } from '@/features/course/PageContent';
import { GroupScope } from '@/features/groups/GroupScope';
import { useTranslation } from '@/i18n';

/** Edit a group page (CONTENT-8). Group pages are usually open to every member. */
export default function EditGroupPageScreen() {
  const { t } = useTranslation();
  const { groupId, pageUrl } = useLocalSearchParams<{ groupId: string; pageUrl: string }>();
  const context = useMemo(() => ({ type: 'group' as const, id: groupId }), [groupId]);
  return (
    <GroupScope groupId={groupId} title={t('pages.edit')}>
      <PageEditor context={context} pageUrl={pageUrl} />
    </GroupScope>
  );
}
