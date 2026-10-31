import { useTranslation } from '@/i18n';
import { useLocalSearchParams } from 'expo-router';

import { useDashboardCourses } from '@/canvas/api/courses';
import { AccentScope, deriveAccent, useTheme } from '@/design';
import { FolderBrowser, openFolder } from '@/features/files/FolderBrowser';

/** A folder inside a course's files. */
export default function CourseFolderScreen() {
  const { t } = useTranslation();
  const { courseId, folderId } = useLocalSearchParams<{
    courseId: string;
    folderId: string;
  }>();
  const { scheme } = useTheme();
  const color = useDashboardCourses().data?.find((c) => c.id === courseId)?.color ?? null;
  return (
    <AccentScope color={color} className="flex-1">
      <FolderBrowser
        context={{ type: 'courses', id: courseId }}
        folderId={folderId}
        rootTitle={t('files.title')}
        onOpenFolder={openFolder}
        headerTint={color ? deriveAccent(color, scheme).accentFg : undefined}
      />
    </AccentScope>
  );
}
