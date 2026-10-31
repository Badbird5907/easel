import { useTranslation } from '@/i18n';
import { router } from 'expo-router';
import { HardDriveDownload } from 'lucide-react-native';

import { IconTile, ListGroup, ListItem } from '@/design';
import { FolderBrowser, openFolder } from '@/features/files/FolderBrowser';

/** My Files: the student's own Canvas files (FILE-9), and what's downloaded (FILE-10). */
export default function MyFilesScreen() {
  const { t } = useTranslation();
  return (
    <FolderBrowser
      context={{ type: 'users', id: 'self' }}
      rootTitle={t('files.my')}
      onOpenFolder={openFolder}
      header={
        <ListGroup>
          <ListItem
            leading={<IconTile icon={HardDriveDownload} tone="neutral" />}
            title={t('files.downloaded')}
            subtitle={t('files.offline')}
            onPress={() => router.push('/files/downloads' as never)}
          />
        </ListGroup>
      }
    />
  );
}
