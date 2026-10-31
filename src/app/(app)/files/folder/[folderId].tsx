import { useTranslation } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';

import { useFolder } from '@/canvas/api/files';
import { Screen, Skeleton } from '@/design';
import { FolderBrowser, openFolder } from '@/features/files/FolderBrowser';

/** A folder in My Files or a group's files. Course folders use the course route. */
export default function FolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const folder = useFolder(folderId);
  // The folder says whose it is; until then, assume the student's own.
  const context = folder.data?.context ?? {
    type: 'users' as const,
    id: 'self',
  };
  if (folder.isPending)
    return (
      <Screen accessibilityLabel={t('files.loading')}>
        <Skeleton className="h-11 rounded-full" />
      </Screen>
    );
  return (
    <FolderBrowser
      context={context}
      folderId={folderId}
      rootTitle={t('files.title')}
      onOpenFolder={openFolder}
    />
  );
}
