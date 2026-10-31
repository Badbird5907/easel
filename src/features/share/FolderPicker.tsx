import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useIsFocused, useNavigation } from 'expo-router';
import { clearSharedPayloads } from 'expo-sharing';
import { CircleCheck, Folder, FolderOpen, Lock, RotateCw, Upload } from 'lucide-react-native';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { AccessibilityInfo, RefreshControl, View } from 'react-native';

import { type FolderItem, useFolder, useFolderContents, useRootFolder } from '@/canvas/api/files';
import { useAccountKey } from '@/canvas/query';
import { useCanvas } from '@/canvas/session';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  haptics,
  Icon,
  IconButton,
  IconTile,
  ListGroup,
  ListItem,
  ProgressBar,
  Screen,
  Text,
  useTheme,
} from '@/design';
import { ListSkeleton, LoadError } from '@/features/course/states';
import { FileThumbnail } from '@/features/files/FileThumbnail';
import { formatSize } from '@/features/files/kinds';
import { useOnline } from '@/features/offline/useOnline';

import { createTranslator, getLocaleState, useTranslation, type Translate } from '@/i18n';

import { getSharedContentSnapshot, useSharedContentSnapshot } from './content';
import { ShareFoldersOwner, type ShareFoldersRow } from './shareFoldersOwner';
import { leaveShare } from './ShareScreen';

const SORT = { by: 'name', order: 'asc' } as const;

// Compare permission values, not query timestamps: a successful invalidation or
// locale redraw must not discard accepted files or restart work.
function permissionSource(data: FolderItem | undefined, failed: boolean, pending: boolean) {
  return JSON.stringify([
    data?.id,
    data?.canUpload,
    data?.lockedForUser,
    data?.forSubmissions,
    failed,
    pending,
  ]);
}

function statusText(item: ShareFoldersRow, t: Translate, locale: string) {
  switch (item.status) {
    case 'waiting':
      return t('shareFolders.waiting');
    case 'uploading':
      return item.fraction && item.fraction < 1
        ? t('shareFolders.progress', {
            percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
              item.fraction,
            ),
          })
        : item.fraction === 1
          ? t('shareFolders.finishing')
          : t('shareFolders.uploading');
    case 'done': {
      const size = formatSize(item.file.size, locale);
      return size ? t('shareFolders.uploadedSize', { size }) : t('shareFolders.uploaded');
    }
    case 'error':
      return t(`shareFolders.error.${item.error ?? 'upload'}`, { name: item.file.name });
  }
}

/**
 * "Upload to My Files" (ASSIGN-16): browse to a folder, then upload everything
 * that was shared into it, with progress, retry, and a way to the folder after.
 * Each subfolder is its own pushed screen, like the Files browser.
 */
export function FolderPicker({ folderId }: { folderId?: string }) {
  const { account, client } = useCanvas();
  const queryClient = useQueryClient();
  const accountKey = useAccountKey();
  const online = useOnline();
  const shared = useSharedContentSnapshot();
  const content = shared.content;
  const { t, locale } = useTranslation();
  const { colors } = useTheme();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const root = useRootFolder({ type: 'users', id: 'self' });
  const sub = useFolder(folderId);
  const folder = folderId ? sub : root;
  const id = folder.data?.id;
  const contents = useFolderContents(id, SORT);
  const title = folderId ? (folder.data?.name ?? t('shareFolders.folder')) : t('shareFolders.myFiles');
  const files = content.files;
  const canUpload =
    !!folder.data &&
    folder.data.canUpload === true &&
    !folder.data.lockedForUser &&
    !folder.data.forSubmissions &&
    !folder.isError &&
    !folder.isPending;
  const contentSource = JSON.stringify(content);
  const permission = permissionSource(folder.data, folder.isError, folder.isPending);
  const folderData = folder.data;
  const owner = useMemo(
    () =>
      new ShareFoldersOwner(
        client,
        id,
        files,
        () => getSharedContentSnapshot() === shared && JSON.stringify(content) === contentSource,
        () => queryClient.invalidateQueries({ queryKey: [accountKey, 'files'] }),
      ),
    // Presentation and permission changes keep accepted results in this owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountKey, account.user.id, account.baseUrl, client, folderId, id, shared, contentSource, queryClient],
  );
  useLayoutEffect(() => {
    const queryKey = folderId
      ? [accountKey, 'files', 'folder', folderId]
      : [accountKey, 'files', 'root', 'users', 'self'];
    owner.activate(() => {
      const cached = queryClient.getQueryState<FolderItem>(queryKey);
      // useCanvasQuery presents an offline paused initial read as an error.
      const offlinePending = cached?.status === 'pending' && cached.fetchStatus === 'paused';
      return (
        focused &&
        navigation.isFocused() &&
        !!cached &&
        permissionSource(
          cached.data,
          cached.status === 'error' || offlinePending,
          cached.status === 'pending' && !offlinePending,
        ) === permission
      );
    }, canUpload && online);
    return () => owner.retire();
  }, [owner, focused, navigation, permission, canUpload, online, queryClient, accountKey, folderId]);
  const { epoch, uploads, busy, refreshing, refreshFailed } = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
  );
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      tintColor={colors.fgMuted}
      onRefresh={() =>
        owner.refresh(epoch, () =>
          queryClient.refetchQueries({ queryKey: [accountKey, 'files'], type: 'active' }),
        )
      }
    />
  );
  const feedback = (ok: boolean, owns: () => boolean) => {
    if (!owns()) return;
    if (ok) {
      haptics.success();
      if (!owns()) return;
      clearSharedPayloads();
      if (!owns()) return;
      const currentT = createTranslator(getLocaleState().locale);
      const currentTitle = folderId
        ? (folderData?.name ?? currentT('shareFolders.folder'))
        : currentT('shareFolders.myFiles');
      AccessibilityInfo.announceForAccessibility(
        currentT('shareFolders.completed', { folder: currentTitle }),
      );
    } else haptics.error();
  };
  const start = () => owner.run(epoch, feedback);
  const retry = (index: number) => owner.run(epoch, feedback, index);
  const done = !!uploads?.length && uploads.every((u) => u.status === 'done');
  const subfolders = contents.data?.folders ?? [];

  let folderList;
  if (folder.isError || contents.isError) {
    const error = (folder.error ?? contents.error)!;
    folderList = (
      <LoadError
        title={t('shareFolders.loadError')}
        error={error}
        onRetry={() => owner.refresh(epoch, () => (folder.isError ? folder.refetch() : contents.refetch()))}
      />
    );
  } else if (folder.isPending || contents.isPending) {
    folderList = <ListSkeleton rows={4} />;
  } else if (subfolders.length) {
    folderList = (
      <ListGroup>
        {subfolders.map((f: FolderItem) => {
          const locked = f.lockedForUser || !f.canUpload || f.forSubmissions;
          return (
            <ListItem
              key={f.id}
              leading={<IconTile icon={Folder} tone={locked ? 'neutral' : 'accent'} />}
              title={f.name}
              subtitle={
                f.forSubmissions
                  ? t('shareFolders.submissions')
                  : f.foldersCount
                    ? t('shareFolders.folders', { count: f.foldersCount })
                    : undefined
              }
              trailing={locked ? <Icon icon={Lock} size={16} tone="subtle" /> : undefined}
              onPress={() =>
                owner.action(epoch, () =>
                  router.push({ pathname: '/share/folder', params: { folderId: f.id } } as never),
                )
              }
              accessibilityHint={locked ? t('shareFolders.lockedHint') : t('shareFolders.folderHint')}
            />
          );
        })}
      </ListGroup>
    );
  } else {
    folderList = (
      <Text variant="subhead" tone="muted" className="px-1">
        {t('shareFolders.noFolders')}
      </Text>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen refreshControl={refreshControl} contentClassName="gap-6">
        {!files.length ? (
          <Card padding="none">
            <EmptyState
              icon={FolderOpen}
              title={t('shareFolders.empty')}
              description={t('shareFolders.emptyHelp')}
            />
          </Card>
        ) : uploads ? (
          <View className="gap-3">
            <Card padding="none">
              {uploads.map((item, index) => (
                <View
                  key={`${item.file.uri}-${index}`}
                  className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-2"
                  accessible={item.status !== 'error'}
                  accessibilityLabel={t('shareFolders.rowLabel', {
                    name: item.file.name,
                    status: statusText(item, t, locale),
                  })}
                  accessibilityValue={
                    item.status === 'uploading' && item.fraction !== null
                      ? { min: 0, max: 100, now: Math.round(item.fraction * 100) }
                      : undefined
                  }
                >
                  <FileThumbnail
                    file={{
                      name: item.file.name,
                      filename: item.file.name,
                      contentType: item.file.mimeType ?? '',
                      thumbnailUrl: item.file.isImage ? item.file.uri : null,
                    }}
                  />
                  <View className="flex-1 gap-1">
                    <Text variant="body" weight="medium" numberOfLines={1}>
                      {item.file.name}
                    </Text>
                    <View className="flex-row items-center gap-1.5">
                      {item.status === 'done' ? <Icon icon={CircleCheck} size={14} tone="success" /> : null}
                      <Text
                        variant="footnote"
                        tone={item.status === 'error' ? 'danger' : 'muted'}
                        numberOfLines={2}
                        className="flex-1"
                        tabular
                      >
                        {statusText(item, t, locale)}
                      </Text>
                    </View>
                    {item.status === 'uploading' ? (
                      <ProgressBar value={item.fraction ?? 0.04} size="sm" className="mt-0.5" />
                    ) : null}
                  </View>
                  {item.status === 'error' ? (
                    <IconButton
                      icon={RotateCw}
                      accessibilityLabel={t('shareFolders.retry', { name: item.file.name })}
                      onPress={() => retry(index)}
                      disabled={busy || !online || !canUpload || refreshing}
                    />
                  ) : null}
                </View>
              ))}
            </Card>
            {done ? (
              <>
                <Callout tone="success" title={t('shareFolders.completed', { folder: title })}>
                  {uploads.length === 1
                    ? t('shareFolders.singleComplete', { name: uploads[0].file.name })
                    : t('shareFolders.allComplete', { count: uploads.length })}
                </Callout>
                <View className="gap-2.5">
                  <Button
                    onPress={() =>
                      owner.action(
                        epoch,
                        () => {
                          router.dismissAll();
                          router.push({
                            pathname: '/files/folder/[folderId]',
                            params: { folderId: id! },
                          } as never);
                        },
                        true,
                      )
                    }
                  >
                    {t('shareFolders.openFiles')}
                  </Button>
                  <Button variant="secondary" onPress={() => owner.action(epoch, leaveShare, true)}>
                    {t('shareFolders.done')}
                  </Button>
                </View>
              </>
            ) : null}
          </View>
        ) : (
          <Card className="gap-3">
            <Text variant="headline">
              {files.length === 1
                ? t('shareFolders.singlePrompt', { name: files[0].name })
                : t('shareFolders.prompt', { count: files.length })}
            </Text>
            <Text variant="subhead" tone="muted">
              {canUpload || folder.isPending
                ? t('shareFolders.destination', { folder: title })
                : t('shareFolders.refused')}
            </Text>
            <Button
              leadingIcon={Upload}
              onPress={start}
              disabled={!canUpload || !online || busy || refreshing}
              loading={folder.isPending}
              accessibilityHint={!online ? t('shareFolders.offlineHint') : undefined}
            >
              {t('shareFolders.uploadHere')}
            </Button>
            {!online ? (
              <Text variant="footnote" tone="muted" align="center">
                {t('shareFolders.offline')}
              </Text>
            ) : null}
          </Card>
        )}
        {refreshFailed ? <Callout tone="warning">{t('shareFolders.refreshError')}</Callout> : null}
        {!uploads ? folderList : null}
      </Screen>
    </>
  );
}
