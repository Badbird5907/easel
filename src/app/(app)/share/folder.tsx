import { useLocalSearchParams } from 'expo-router';

import { FolderPicker } from '@/features/share/FolderPicker';

/** "Upload to My Files": a folder, then the upload (ASSIGN-16). Omit `folderId` for the root. */
export default function ShareFolderRoute() {
  const { folderId } = useLocalSearchParams<{ folderId?: string }>();
  return <FolderPicker folderId={folderId} />;
}
