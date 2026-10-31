import { useTranslation } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';

import { FolderBrowser, openFolder } from '@/features/files/FolderBrowser';

/** A group's files. */
export default function GroupFilesScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return (
    <FolderBrowser
      context={{ type: 'groups', id: groupId }}
      rootTitle={t('files.group')}
      onOpenFolder={openFolder}
    />
  );
}
