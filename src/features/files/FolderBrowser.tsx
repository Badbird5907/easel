import { router, Stack } from 'expo-router';
import {
  ArrowUpDown,
  Check,
  EyeOff,
  Folder,
  FolderLock,
  FolderOpen,
  Lock,
  SearchX,
  Upload,
} from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import {
  type FileItem,
  type FilesContext,
  type FileSort,
  type FolderItem,
  MIN_SEARCH_LENGTH,
  type SortOrder,
  useFileSearch,
  useFolder,
  useFolderContents,
  useRootFolder,
} from '@/canvas/api/files';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Icon,
  IconTile,
  ListGroup,
  ListItem,
  PressableScale,
  ProgressBar,
  Screen,
  SearchField,
  Skeleton,
  Text,
  useTheme,
} from '@/design';

import { formatNumber, useTranslation } from '@/i18n';
import { createDateContext, useDisplayTimeZone } from '@/lib/dates';

import {
  browserCount,
  browserFileSummary,
  folderSummary,
  sortIds,
  sortLabel,
  sortPresentation,
} from './browserPresentation';
import { useActionSheet } from './ActionSheet';
import { FileThumbnail } from './FileThumbnail';
import { availabilityOf } from './kinds';
import { openFile } from './open';
import { useUploadToFolder } from './upload';
import { folderUploadError } from './uploadPresentation';

const defaultOrder: Record<FileSort, SortOrder> = {
  name: 'asc',
  updated_at: 'desc',
  size: 'desc',
  content_type: 'asc',
};

function FolderRow({ folder, onPress }: { folder: FolderItem; onPress: () => void }) {
  const { t, locale } = useTranslation();
  const locked = folder.lockedForUser;
  const summary = locked ? t('files.folderLocked') : folderSummary(folder, locale);
  return (
    <ListItem
      leading={<IconTile icon={locked ? FolderLock : Folder} tone={locked ? 'neutral' : 'accent'} />}
      title={folder.name}
      subtitle={summary}
      subtitleLines={1}
      accessibilityLabel={t(folder.hidden ? 'files.folderRowHidden' : 'files.folderRow', {
        name: folder.name,
        summary,
      })}
      trailing={
        folder.hidden ? (
          <Badge size="sm" icon={EyeOff}>
            {t('files.hidden')}
          </Badge>
        ) : null
      }
      disabled={locked}
      onPress={onPress}
    />
  );
}

function FileRow({ file, onPress }: { file: FileItem; onPress: () => void }) {
  const { t, locale } = useTranslation();
  const zone = useDisplayTimeZone();
  const availability = availabilityOf(file, new Date(), createDateContext(locale, zone));
  const summary = browserFileSummary(file, locale, zone);
  return (
    <ListItem
      leading={<FileThumbnail file={file} />}
      title={file.name}
      subtitle={summary}
      subtitleLines={1}
      accessibilityLabel={
        availability
          ? t('file.rowAvailabilityLabel', {
              name: file.name,
              summary,
              availability: availability.short,
            })
          : t('file.rowLabel', { name: file.name, summary })
      }
      trailing={
        availability ? (
          <Badge
            size="sm"
            tone={availability.tone === 'warning' ? 'warning' : 'neutral'}
            icon={availability.tone === 'warning' ? Lock : file.hidden ? EyeOff : undefined}
          >
            {availability.tone === 'warning' ? t('file.locked') : availability.short}
          </Badge>
        ) : null
      }
      chevron={false}
      onPress={onPress}
    />
  );
}

function LoadingRows() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityLabel={t('files.loading')}>
      <Card padding="none" className="overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} className="flex-row items-center gap-3 px-4 py-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export type FolderBrowserProps = {
  context: FilesContext;
  /** Omit for the context's root folder. */
  folderId?: string;
  /** Title for the root ("Files", "My Files"). Subfolders use their own name. */
  rootTitle: string;
  /** Pushes a subfolder; each browser decides which route that is. */
  onOpenFolder: (folder: FolderItem) => void;
  /** Course color for the header tint, when browsing a course. */
  headerTint?: string;
  /** Extra rows above the list, such as My Files' downloads. */
  header?: ReactNode;
};

/** Folders and files with search, sort, availability, and pull to refresh (FILE-9). */
export function FolderBrowser({
  context,
  folderId,
  rootTitle,
  onOpenFolder,
  headerTint,
  header,
}: FolderBrowserProps) {
  const { t, locale } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ by: FileSort; order: SortOrder }>({
    by: 'name',
    order: 'asc',
  });
  const [refreshing, setRefreshing] = useState(false);
  const { show: showSheet, sheet } = useActionSheet();

  const root = useRootFolder(context);
  const sub = useFolder(folderId);
  const folder = folderId ? sub : root;
  const id = folder.data?.id;
  const contents = useFolderContents(id, sort);
  const term = query.trim();
  const searching = term.length >= MIN_SEARCH_LENGTH;
  const search = useFileSearch(context, searching ? term : '', sort);
  const shown = searching ? search : contents;
  const upload = useUploadToFolder(
    context.type === 'users' && folder.data?.canUpload !== false ? id : undefined,
  );
  const canUpload = context.type === 'users' && folder.data?.canUpload !== false && !!id && !searching;

  const title = folderId ? (folder.data?.name ?? t('files.folder')) : rootTitle;
  const folders = shown.data?.folders ?? [];
  const files = shown.data?.files ?? [];

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([folder.refetch(), searching ? search.refetch() : contents.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const chooseSort = () =>
    showSheet({
      title: t('files.sort.title'),
      presentation: (translate) => sortPresentation(sort, translate),
      options: sortIds.map((by) => ({
        key: by,
        label: sortLabel(by, t, sort.by === by ? (sort.order === 'asc' ? 'desc' : 'asc') : undefined),
        icon: sort.by === by ? Check : undefined,
        onPress: () =>
          setSort((current) =>
            current.by === by
              ? { by, order: current.order === 'asc' ? 'desc' : 'asc' }
              : { by, order: defaultOrder[by] },
          ),
      })),
    });

  const open = (file: FileItem) =>
    openFile(file.id, {
      courseId: context.type === 'courses' ? context.id : undefined,
      // Swipe between the files in this folder or these results.
      files: files.length <= 100 ? files : [file],
    });

  const error = folder.error ?? shown.error;
  const loading =
    folder.isPending || (!!id && shown.isPending && !shown.data && (!searching || search.isFetching));
  const total = folders.length + files.length;

  let body;
  if (error && !shown.data) {
    body = (
      <Callout
        tone="danger"
        title={t(searching ? 'files.searchError' : 'files.folderError')}
        action={{
          label: t('common.retry'),
          onPress: () => (folder.isError ? folder.refetch() : shown.refetch()),
        }}
      >
        {error.message}
      </Callout>
    );
  } else if (loading) {
    body = <LoadingRows />;
  } else if (total === 0) {
    body = (
      <Card padding="none">
        {searching ? (
          <EmptyState
            icon={SearchX}
            title={t('files.noMatches')}
            description={t('files.noMatchesDetail', { term })}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title={t('files.emptyFolder')}
            description={canUpload ? t('files.emptyUpload') : t('files.emptyInstructor')}
          />
        )}
      </Card>
    );
  } else {
    body = (
      <View className="gap-3">
        <View className="flex-row items-center justify-between px-1">
          <Text variant="footnote" tone="muted">
            {browserCount(searching ? 'results' : 'items', total, locale)}
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('files.sort.accessibility', {
              value: sortLabel(sort.by, t, sort.order),
            })}
            hitSlop={12}
            onPress={chooseSort}
            className="flex-row items-center gap-1.5"
          >
            <Text variant="footnote" weight="semibold" tone="accent">
              {sortLabel(sort.by, t, sort.order)}
            </Text>
            <Icon icon={ArrowUpDown} size={14} tone="accent" strokeWidth={2} />
          </PressableScale>
        </View>
        {folders.length ? (
          <ListGroup>
            {folders.map((f) => (
              <FolderRow key={f.id} folder={f} onPress={() => onOpenFolder(f)} />
            ))}
          </ListGroup>
        ) : null}
        {files.length ? (
          <ListGroup>
            {files.map((f) => (
              <FileRow key={f.id} file={f} onPress={() => open(f)} />
            ))}
          </ListGroup>
        ) : null}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title, ...(headerTint && { headerTintColor: headerTint }) }} />
      <Screen
        contentClassName="gap-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />
        }
      >
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t(context.type === 'users' ? 'files.searchMy' : 'files.searchAll')}
        />
        {query.trim().length > 0 && !searching ? (
          <Text variant="footnote" tone="muted" className="-mt-2 px-1">
            {t('files.searchHint', {
              minimum: formatNumber(MIN_SEARCH_LENGTH, undefined, locale),
            })}
          </Text>
        ) : null}
        {header}
        {canUpload ? (
          upload.state.status === 'uploading' ? (
            <Card className="gap-2">
              <Text variant="subhead" weight="medium" numberOfLines={1}>
                {t('files.uploading', { name: upload.state.name })}
              </Text>
              <ProgressBar
                value={upload.state.fraction ?? 0}
                accessibilityLabel={t('files.uploadingLabel', {
                  name: upload.state.name,
                })}
              />
            </Card>
          ) : upload.state.status === 'error' ? (
            <Callout
              tone="danger"
              title={t('files.uploadFailed')}
              action={{
                label: t('common.retry'),
                onPress: upload.pickAndUpload,
              }}
            >
              {folderUploadError(upload.state, t)}
            </Callout>
          ) : (
            <Button
              variant="tonal"
              leadingIcon={Upload}
              onPress={upload.pickAndUpload}
              className="self-start"
            >
              {t('files.upload')}
            </Button>
          )
        ) : null}
        {upload.state.status === 'done' ? (
          <Callout tone="success" title={t('files.uploaded')}>
            {t('files.uploadedDetail', { name: upload.state.file.name })}
          </Callout>
        ) : null}
        {body}
      </Screen>
      {sheet}
    </>
  );
}

/** Where a folder opens: course folders keep the course route (and color). */
export function folderRoute(folder: FolderItem) {
  if (folder.context.type === 'courses')
    return {
      pathname: '/course/[courseId]/files/folder/[folderId]',
      params: { courseId: folder.context.id, folderId: folder.id },
    } as const;
  return {
    pathname: '/files/folder/[folderId]',
    params: { folderId: folder.id },
  } as const;
}

export function openFolder(folder: FolderItem) {
  router.push(folderRoute(folder) as never);
}
