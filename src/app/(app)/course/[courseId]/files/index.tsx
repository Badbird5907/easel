import { useTranslation } from '@/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useDashboardCourses } from '@/canvas/api/courses';
import { fetchFolderByPath } from '@/canvas/api/files';
import { useCanvas } from '@/canvas/session';
import { AccentScope, deriveAccent, useTheme } from '@/design';
import { folderRoute, FolderBrowser, openFolder } from '@/features/files/FolderBrowser';

type Params = { courseId: string; canvasUrl?: string; path?: string };

/**
 * A course's files (FILE-9). Canvas links land here too: `/courses/1/files?preview=5`
 * opens that file, and `/courses/1/files/folder/Labs` opens that folder.
 */
export default function CourseFilesScreen() {
  const { t } = useTranslation();
  const { courseId, canvasUrl, path } = useLocalSearchParams<Params>();
  const { client } = useCanvas();
  const { scheme } = useTheme();
  const color = useDashboardCourses().data?.find((c) => c.id === courseId)?.color ?? null;

  useEffect(() => {
    let preview: string | null = null;
    try {
      preview = canvasUrl ? new URL(canvasUrl).searchParams.get('preview') : null;
    } catch {
      preview = null;
    }
    if (preview && /^\d+$/.test(preview)) {
      router.replace({
        pathname: '/file/[fileId]',
        params: { fileId: preview, courseId, canvasUrl },
      } as never);
      return;
    }
    if (!path) return;
    let alive = true;
    fetchFolderByPath(client, { type: 'courses', id: courseId }, path)
      .then((folder) => {
        if (alive && folder.parentId) router.replace(folderRoute(folder) as never);
      })
      .catch(() => {
        // Unknown path: the course's top folder is the next best place.
      });
    return () => {
      alive = false;
    };
  }, [canvasUrl, courseId, path, client]);

  return (
    <AccentScope color={color} className="flex-1">
      <FolderBrowser
        context={{ type: 'courses', id: courseId }}
        rootTitle={t('files.title')}
        onOpenFolder={openFolder}
        headerTint={color ? deriveAccent(color, scheme).accentFg : undefined}
      />
    </AccentScope>
  );
}
