import { Stack, useLocalSearchParams } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, type ListViewToken, useWindowDimensions, View } from 'react-native';

import { useDashboardCourses } from '@/canvas/api/courses';
import type { FileItem } from '@/canvas/api/files';
import { AccentScope, IconButton, useTheme } from '@/design';
import { FileDetailsSheet } from '@/features/files/FileDetailsSheet';
import { FileViewer } from '@/features/files/FileViewer';
import { formatNumber, useTranslation } from '@/i18n';

type Params = { fileId: string; courseId?: string; canvasUrl?: string; ids?: string };

/**
 * The one file viewer (FILE-1). Opened by `openFile()` and by Canvas file links.
 * With `ids`, swipes between the files of one message, post, or folder (FILE-8).
 */
export default function FileScreen() {
  const { t, locale } = useTranslation();
  const { fileId, courseId, canvasUrl, ids } = useLocalSearchParams<Params>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const list = useMemo(() => {
    const all = ids ? ids.split(',').filter(Boolean) : [];
    return all.includes(fileId) ? all : [fileId];
  }, [ids, fileId]);
  const [index, setIndex] = useState(() => Math.max(0, list.indexOf(fileId)));
  const [files, setFiles] = useState<Record<string, FileItem | undefined>>({});
  const [zoomed, setZoomed] = useState(false);
  const [details, setDetails] = useState(false);

  const currentId = list[index] ?? fileId;
  const current = files[currentId];
  const contextCourse = current?.context?.type === 'course' ? current.context.id : courseId;
  const color = useDashboardCourses().data?.find((c) => c.id === contextCourse)?.color ?? null;

  // FlatList requires this callback to never change.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index !== null && first?.index !== undefined) setIndex(first.index);
  }, []);

  const remember = useCallback(
    (id: string) => (file: FileItem | undefined) =>
      setFiles((all) => (all[id] === file ? all : { ...all, [id]: file })),
    [],
  );

  const title = current?.name ?? t('file.generic.file');

  return (
    <AccentScope color={color} className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title,
          headerRight: () =>
            current ? (
              <IconButton
                icon={Info}
                accessibilityLabel={t('files.viewer.details')}
                iconColor={colors.accentFg}
                onPress={() => setDetails(true)}
              />
            ) : null,
        }}
      />
      {list.length === 1 ? (
        <FileViewer fileId={fileId} courseId={courseId} canvasUrl={canvasUrl} onFile={remember(fileId)} />
      ) : (
        <View className="flex-1">
          <FlatList
            data={list}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(id) => id}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item, index: i }) => (
              <View style={{ width }} className="flex-1">
                <FileViewer
                  fileId={item}
                  courseId={courseId}
                  active={i === index}
                  onFile={remember(item)}
                  onZoomChange={setZoomed}
                  position={t('files.viewer.position', {
                    current: formatNumber(i + 1, undefined, locale),
                    total: formatNumber(list.length, undefined, locale),
                  })}
                />
              </View>
            )}
          />
        </View>
      )}
      <FileDetailsSheet
        file={current}
        courseId={courseId}
        canvasUrl={list.length === 1 ? canvasUrl : undefined}
        visible={details}
        onClose={() => setDetails(false)}
      />
    </AccentScope>
  );
}
